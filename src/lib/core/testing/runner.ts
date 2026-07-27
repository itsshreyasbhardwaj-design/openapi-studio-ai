import type {
  ExecutedRequest,
  RequestCollection,
  RequestDefinition,
  TestRun,
} from "@/lib/domain/types";
import { newId } from "@/lib/utils/id";
import { evaluateAssertions, type ResponseSnapshot } from "./assertions";
import { readJsonPath } from "./interpolate";
import { prepareRequest, type PreparedRequest } from "./request";
import type { VariableBag } from "./interpolate";

export interface ExecutionOutcome extends ResponseSnapshot {
  readonly error: string | null;
  readonly sizeBytes: number;
}

/** Transport seam: the runner never performs I/O itself. */
export type Transport = (request: PreparedRequest) => Promise<ExecutionOutcome>;

export interface RunOptions {
  /** Stop the run at the first request whose assertions fail. */
  readonly stopOnFailure?: boolean;
  readonly variables?: VariableBag;
  /** Clock injection keeps runs deterministic under test. */
  readonly now?: () => number;
}

function captureVariables(
  definition: RequestDefinition,
  outcome: ExecutionOutcome,
  into: Record<string, string>,
): void {
  if (!definition.captures?.length) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.body) as unknown;
  } catch {
    parsed = undefined;
  }

  for (const capture of definition.captures) {
    if (capture.from.startsWith("header:")) {
      const wanted = capture.from.slice("header:".length).toLowerCase();
      const found = Object.entries(outcome.headers).find(([key]) => key.toLowerCase() === wanted);
      if (found?.[1] !== undefined) into[capture.name] = found[1];
      continue;
    }
    const value = readJsonPath(parsed, capture.from);
    if (value !== undefined && value !== null) {
      into[capture.name] = typeof value === "string" ? value : JSON.stringify(value);
    }
  }
}

/**
 * Execute every request in a collection in order, threading captured variables
 * from one response into the next request — which is what makes real end-to-end
 * suites (log in → create → read back → delete) expressible.
 */
export async function runCollection(
  collection: RequestCollection,
  transport: Transport,
  options: RunOptions = {},
): Promise<TestRun> {
  const clock = options.now ?? Date.now;
  const startedAt = clock();
  const variables: Record<string, string> = { ...(options.variables ?? {}) };
  const results: ExecutedRequest[] = [];

  for (const definition of collection.requests) {
    const prepared = prepareRequest(definition, variables);

    if (prepared.missingVariables.length > 0) {
      results.push({
        requestId: definition.id,
        name: definition.name,
        status: 0,
        statusText: "Not sent",
        durationMs: 0,
        sizeBytes: 0,
        headers: {},
        body: "",
        error: `Unresolved variables: ${prepared.missingVariables.join(", ")}`,
        assertions: [],
      });
      if (options.stopOnFailure) break;
      continue;
    }

    let outcome: ExecutionOutcome;
    try {
      outcome = await transport(prepared);
    } catch (error) {
      outcome = {
        status: 0,
        statusText: "Request failed",
        headers: {},
        body: "",
        durationMs: 0,
        sizeBytes: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const assertions = outcome.error ? [] : evaluateAssertions(definition.assertions, outcome);
    if (!outcome.error) captureVariables(definition, outcome, variables);

    results.push({
      requestId: definition.id,
      name: definition.name,
      status: outcome.status,
      statusText: outcome.statusText,
      durationMs: outcome.durationMs,
      sizeBytes: outcome.sizeBytes,
      headers: outcome.headers,
      body: outcome.body,
      error: outcome.error,
      assertions,
    });

    const failed = Boolean(outcome.error) || assertions.some((assertion) => !assertion.passed);
    if (failed && options.stopOnFailure) break;
  }

  const finishedAt = clock();
  const passed = results.filter(
    (result) => !result.error && result.assertions.every((assertion) => assertion.passed),
  ).length;

  return {
    id: newId("run"),
    collectionId: collection.id,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    passed,
    failed: results.length - passed,
    results,
  };
}

/** Aggregate assertion statistics across a run, for the results header. */
export function runStats(run: TestRun): {
  assertionsPassed: number;
  assertionsFailed: number;
  averageDurationMs: number;
} {
  let assertionsPassed = 0;
  let assertionsFailed = 0;
  let totalDuration = 0;
  for (const result of run.results) {
    totalDuration += result.durationMs;
    for (const assertion of result.assertions) {
      if (assertion.passed) assertionsPassed += 1;
      else assertionsFailed += 1;
    }
  }
  return {
    assertionsPassed,
    assertionsFailed,
    averageDurationMs:
      run.results.length === 0 ? 0 : Math.round(totalDuration / run.results.length),
  };
}
