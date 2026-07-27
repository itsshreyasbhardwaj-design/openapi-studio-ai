/**
 * `{{variable}}` interpolation shared by the API client, the collection runner
 * and the generated cURL snippets.
 */

const TOKEN = /\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}/g;

export type VariableBag = Readonly<Record<string, string>>;

export interface InterpolationResult {
  readonly value: string;
  /** Variables referenced by the template but absent from the bag. */
  readonly missing: readonly string[];
}

export function interpolate(template: string, variables: VariableBag): InterpolationResult {
  const missing = new Set<string>();
  const value = template.replace(TOKEN, (_match, name: string) => {
    const replacement = variables[name];
    if (replacement === undefined) {
      missing.add(name);
      return `{{${name}}}`;
    }
    return replacement;
  });
  return { value, missing: [...missing] };
}

export function interpolateRecord(
  record: Readonly<Record<string, string>>,
  variables: VariableBag,
): { record: Record<string, string>; missing: string[] } {
  const out: Record<string, string> = {};
  const missing = new Set<string>();
  for (const [key, value] of Object.entries(record)) {
    const interpolatedKey = interpolate(key, variables);
    const interpolatedValue = interpolate(value, variables);
    interpolatedKey.missing.forEach((name) => missing.add(name));
    interpolatedValue.missing.forEach((name) => missing.add(name));
    out[interpolatedKey.value] = interpolatedValue.value;
  }
  return { record: out, missing: [...missing] };
}

/** List the variable names referenced by a template. */
export function referencedVariables(template: string): string[] {
  return [...new Set([...template.matchAll(TOKEN)].map((match) => match[1] ?? ""))].filter(Boolean);
}

/**
 * Minimal JSON path reader supporting dot and bracket notation:
 * `data.items[0].id`, `$.data.total`, `items[2]`.
 */
export function readJsonPath(value: unknown, path: string): unknown {
  const normalised = path
    .replace(/^\$\.?/, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);

  let current: unknown = value;
  for (const token of normalised) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Render a value for assertion messages without dumping megabytes into the UI. */
export function stringifyForDisplay(value: unknown, max = 240): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  const json = JSON.stringify(value);
  if (json === undefined) return String(value);
  return json.length > max ? `${json.slice(0, max)}…` : json;
}
