/**
 * RFC 6901 JSON Pointer helpers.
 *
 * Every diagnostic, comment anchor and diff entry in the platform is addressed
 * by a JSON Pointer, so this module is shared by the validator, the linter, the
 * diff engine and the collaboration layer.
 */

export function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function unescapeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Build a pointer from path segments: `["paths", "/pets", "get"]`. */
export function pointer(...segments: (string | number)[]): string {
  if (segments.length === 0) return "";
  return `/${segments.map((segment) => escapeToken(String(segment))).join("/")}`;
}

/** Append segments to an existing pointer. */
export function extend(base: string, ...segments: (string | number)[]): string {
  const suffix = pointer(...segments);
  return base === "" ? suffix : `${base}${suffix}`;
}

export function parsePointer(input: string): string[] {
  if (input === "" || input === "#") return [];
  const normalised = input.startsWith("#") ? input.slice(1) : input;
  if (!normalised.startsWith("/")) return normalised.split("/").map(unescapeToken);
  return normalised.slice(1).split("/").map(unescapeToken);
}

/** Resolve a pointer against a document, returning `undefined` when absent. */
export function resolvePointer(root: unknown, input: string): unknown {
  let current: unknown = root;
  for (const token of parsePointer(input)) {
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

/** Human-readable rendering of a pointer, used in the UI and CLI output. */
export function describePointer(input: string): string {
  const tokens = parsePointer(input);
  if (tokens.length === 0) return "document root";
  return tokens.join(" › ");
}
