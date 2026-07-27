import "server-only";
import { env } from "@/lib/server/env";
import { logger } from "@/lib/server/logger";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface CompletionOptions {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
}

export class ProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const REFERER = "https://github.com/itsshreyasbhardwaj-design/openapi-studio-ai";

function headers(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    // OpenRouter attribution headers.
    "http-referer": REFERER,
    "x-title": "OpenAPI Studio AI",
  };
}

export function isProviderConfigured(): boolean {
  return Boolean(env().OPENROUTER_API_KEY);
}

/**
 * Stream a chat completion from OpenRouter as plain text chunks.
 *
 * Yields deltas as they arrive so the editor can render the specification while
 * it is still being written — the difference between a 30-second blank screen
 * and a live document.
 */
export async function* streamCompletion(
  messages: readonly ChatMessage[],
  options: CompletionOptions = {},
): AsyncGenerator<string, void, undefined> {
  const config = env();
  const apiKey = config.OPENROUTER_API_KEY;
  if (!apiKey) throw new ProviderError(503, "OPENROUTER_API_KEY is not configured.");

  const response = await fetch(`${config.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: options.model ?? config.OPENROUTER_MODEL,
      messages,
      stream: true,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 8000,
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    logger.warn("ai.provider_error", { status: response.status });
    throw new ProviderError(response.status, detail.slice(0, 500) || response.statusText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Ignore keep-alive comments and malformed frames.
      }
    }
  }
}

/** Non-streaming completion, used for repair rounds and short explanations. */
export async function complete(
  messages: readonly ChatMessage[],
  options: CompletionOptions = {},
): Promise<string> {
  let out = "";
  for await (const chunk of streamCompletion(messages, options)) out += chunk;
  return out;
}
