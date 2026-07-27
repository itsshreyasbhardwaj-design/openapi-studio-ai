import "server-only";
import { stringifySpec } from "@/lib/core/openapi/document";
import type { Diagnostic } from "@/lib/core/openapi/diagnostics";
import { logger } from "@/lib/server/logger";
import { extractAndValidate } from "./extract";
import { synthesiseSpec } from "./offline";
import {
  IMPROVE_SYSTEM_PROMPT,
  SPEC_SYSTEM_PROMPT,
  buildGeneratePrompt,
  buildImprovePrompt,
  buildRepairPrompt,
  type GeneratePromptInput,
} from "./prompts";
import {
  ProviderError,
  complete,
  isProviderConfigured,
  streamCompletion,
  type ChatMessage,
} from "./openrouter";

export * from "./prompts";
export { extractSpecSource, extractAndValidate } from "./extract";
export { synthesiseSpec } from "./offline";
export { isProviderConfigured } from "./openrouter";

export type AiEngine = "openrouter" | "offline";

export interface SpecGenerationResult {
  readonly source: string;
  readonly engine: AiEngine;
  /** Human-readable notes shown in the assistant transcript. */
  readonly notes: readonly string[];
  readonly repaired: boolean;
}

/** Events emitted while generating, consumed by the streaming API route. */
export type GenerationEvent =
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "done"; readonly result: SpecGenerationResult }
  | { readonly type: "error"; readonly message: string };

const MAX_REPAIR_ROUNDS = 1;

/**
 * Generate a specification from a natural-language brief.
 *
 * Strategy:
 *  1. Stream from OpenRouter when a key is configured.
 *  2. Validate the result; on structural errors, ask the model to repair once.
 *  3. If the provider is unavailable or the output is still unusable, fall back
 *     to the deterministic offline synthesiser so the feature always works.
 */
export async function* generateSpec(
  input: GeneratePromptInput,
  signal?: AbortSignal,
): AsyncGenerator<GenerationEvent, void, undefined> {
  if (!isProviderConfigured()) {
    yield {
      type: "status",
      message: "Using the offline design engine (no provider key configured).",
    };
    const offline = synthesiseSpec(input.request, {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
    });
    const source = stringifySpec(offline.document, "yaml");
    yield { type: "delta", text: source };
    yield {
      type: "done",
      result: { source, engine: "offline", notes: offline.notes, repaired: false },
    };
    return;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SPEC_SYSTEM_PROMPT },
    { role: "user", content: buildGeneratePrompt(input) },
  ];

  let raw = "";
  try {
    yield { type: "status", message: "Designing the specification…" };
    for await (const delta of streamCompletion(messages, signal ? { signal } : {})) {
      raw += delta;
      yield { type: "delta", text: delta };
    }
  } catch (error) {
    const message = error instanceof ProviderError ? error.message : String(error);
    logger.warn("ai.generation_failed", { error: message });
    yield {
      type: "status",
      message: "The provider was unavailable — falling back to the offline engine.",
    };
    const offline = synthesiseSpec(input.request, {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
    });
    const source = stringifySpec(offline.document, "yaml");
    yield { type: "delta", text: source };
    yield {
      type: "done",
      result: {
        source,
        engine: "offline",
        notes: [`Provider error: ${message}`, ...offline.notes],
        repaired: false,
      },
    };
    return;
  }

  let extracted = extractAndValidate(raw);
  let repaired = false;

  for (let round = 0; round < MAX_REPAIR_ROUNDS; round += 1) {
    const errors = extracted.ok ? extracted.value.errors : [extracted.error.message];
    if (errors.length === 0) break;

    yield { type: "status", message: `Repairing ${errors.length} validation problem(s)…` };
    try {
      const repairedRaw = await complete(
        [
          { role: "system", content: SPEC_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildRepairPrompt({
              source: extracted.ok ? extracted.value.source : raw,
              errors,
            }),
          },
        ],
        signal ? { signal } : {},
      );
      extracted = extractAndValidate(repairedRaw);
      repaired = true;
    } catch (error) {
      logger.warn("ai.repair_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }

  if (!extracted.ok || extracted.value.errors.length > 0) {
    const reason = extracted.ok
      ? `${extracted.value.errors.length} validation error(s) remained`
      : extracted.error.message;
    yield {
      type: "status",
      message: `Model output unusable (${reason}) — using the offline engine.`,
    };
    const offline = synthesiseSpec(input.request, {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
    });
    const source = stringifySpec(offline.document, "yaml");
    yield {
      type: "done",
      result: { source, engine: "offline", notes: [reason, ...offline.notes], repaired },
    };
    return;
  }

  yield {
    type: "done",
    result: {
      source: extracted.value.source,
      engine: "openrouter",
      notes: [
        repaired
          ? "The first draft was repaired after validation."
          : "The document validated on the first pass.",
      ],
      repaired,
    },
  };
}

/**
 * Apply the linter's findings to an existing document.
 *
 * With no provider key this applies every machine-applicable fix carried by the
 * diagnostics themselves, which covers the majority of quality findings.
 */
export async function improveSpec(
  source: string,
  diagnostics: readonly Diagnostic[],
  signal?: AbortSignal,
): Promise<SpecGenerationResult> {
  if (!isProviderConfigured()) {
    const { applyFixes } = await import("./autofix");
    const result = applyFixes(source, diagnostics);
    return {
      source: result.source,
      engine: "offline",
      notes: result.applied.length
        ? [`Applied ${result.applied.length} automatic fix(es).`, ...result.applied]
        : ["No machine-applicable fixes were available for the current findings."],
      repaired: false,
    };
  }

  const raw = await complete(
    [
      { role: "system", content: IMPROVE_SYSTEM_PROMPT },
      { role: "user", content: buildImprovePrompt(source, diagnostics) },
    ],
    signal ? { signal } : {},
  );

  const extracted = extractAndValidate(raw);
  if (!extracted.ok || extracted.value.errors.length > 0) {
    const { applyFixes } = await import("./autofix");
    const result = applyFixes(source, diagnostics);
    return {
      source: result.source,
      engine: "offline",
      notes: [
        "The model's revision did not validate; applied deterministic fixes instead.",
        ...result.applied,
      ],
      repaired: false,
    };
  }

  return {
    source: extracted.value.source,
    engine: "openrouter",
    notes: [`Addressed ${diagnostics.length} finding(s).`],
    repaired: false,
  };
}
