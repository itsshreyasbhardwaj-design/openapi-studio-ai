import { listOperations, pathTemplateVariables } from "@/lib/core/openapi/navigate";
import type { OpenApiDocument, OperationEntry } from "@/lib/core/openapi/types";

export interface MatchedOperation {
  readonly entry: OperationEntry;
  readonly pathParams: Readonly<Record<string, string>>;
  /** Lower is better; used to prefer literal segments over templates. */
  readonly specificity: number;
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * Match a concrete request path against the templated paths of a document.
 *
 * Literal segments always win over template segments at the same position, so
 * `/orders/summary` is matched before `/orders/{orderId}` — the same precedence
 * rule real routers use.
 */
export function matchOperation(
  document: OpenApiDocument,
  method: string,
  requestPath: string,
): MatchedOperation | null {
  const wanted = segments(requestPath);
  const lowerMethod = method.toLowerCase();
  let best: MatchedOperation | null = null;

  for (const entry of listOperations(document)) {
    if (entry.method !== lowerMethod || entry.kind !== "path") continue;
    const template = segments(entry.path);
    if (template.length !== wanted.length) continue;

    const pathParams: Record<string, string> = {};
    let specificity = 0;
    let matched = true;

    for (let index = 0; index < template.length; index += 1) {
      const templateSegment = template[index] ?? "";
      const actualSegment = wanted[index] ?? "";
      if (templateSegment.startsWith("{") && templateSegment.endsWith("}")) {
        const name = templateSegment.slice(1, -1);
        if (!actualSegment) {
          matched = false;
          break;
        }
        pathParams[name] = decodeURIComponent(actualSegment);
        specificity += 1;
      } else if (templateSegment !== actualSegment) {
        matched = false;
        break;
      }
    }

    if (!matched) continue;
    if (!best || specificity < best.specificity) {
      best = { entry, pathParams, specificity };
    }
  }

  return best;
}

/** All concrete example paths for an operation, used to seed the mock console. */
export function examplePathFor(entry: OperationEntry): string {
  let path = entry.path;
  for (const variable of pathTemplateVariables(entry.path)) {
    const parameter = entry.parameters.find((item) => item.name === variable);
    const enumValues = (parameter?.schema as { enum?: unknown[] } | undefined)?.enum;
    const sample =
      Array.isArray(enumValues) && enumValues[0] !== undefined ? String(enumValues[0]) : "123";
    path = path.replace(`{${variable}}`, sample);
  }
  return path;
}
