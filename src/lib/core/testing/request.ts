import type { AuthConfig, RequestDefinition } from "@/lib/domain/types";
import { interpolate, interpolateRecord, type VariableBag } from "./interpolate";

export interface PreparedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly missingVariables: readonly string[];
}

function base64(input: string): string {
  if (typeof btoa === "function") return btoa(input);
  return Buffer.from(input, "utf8").toString("base64");
}

/**
 * Apply the credential to the outgoing request.
 *
 * Missing variables are reported through `track` rather than swallowed: sending
 * a literal `Bearer {{token}}` to a real API leaks the template and produces a
 * confusing 401 instead of an actionable "you have not set `token`".
 */
function applyAuth(
  auth: AuthConfig,
  headers: Record<string, string>,
  query: Record<string, string>,
  variables: VariableBag,
  track: (names: readonly string[]) => void,
): void {
  switch (auth.type) {
    case "bearer": {
      const token = interpolate(auth.token, variables);
      track(token.missing);
      if (token.value) headers.authorization = `Bearer ${token.value}`;
      break;
    }
    case "basic": {
      const username = interpolate(auth.username, variables);
      const password = interpolate(auth.password, variables);
      track(username.missing);
      track(password.missing);
      headers.authorization = `Basic ${base64(`${username.value}:${password.value}`)}`;
      break;
    }
    case "apiKey": {
      const value = interpolate(auth.value, variables);
      track(value.missing);
      if (!value.value) break;
      if (auth.in === "header") headers[auth.name.toLowerCase()] = value.value;
      else query[auth.name] = value.value;
      break;
    }
    case "none":
    default:
      break;
  }
}

/**
 * Turn a stored request definition plus a variable bag into a concrete HTTP
 * request. Pure and deterministic so the UI can preview exactly what will be
 * sent (including the generated cURL command) before anything leaves the
 * machine.
 */
export function prepareRequest(
  definition: RequestDefinition,
  variables: VariableBag,
): PreparedRequest {
  const missing = new Set<string>();
  const track = (names: readonly string[]): void => names.forEach((name) => missing.add(name));

  const urlResult = interpolate(definition.url, variables);
  track(urlResult.missing);

  const headerResult = interpolateRecord(definition.headers, variables);
  track(headerResult.missing);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(headerResult.record))
    headers[key.toLowerCase()] = value;

  const queryResult = interpolateRecord(definition.query, variables);
  track(queryResult.missing);
  const query = { ...queryResult.record };

  applyAuth(definition.auth, headers, query, variables, track);

  let body: string | null = null;
  if (definition.protocol === "graphql") {
    const queryDoc = interpolate(definition.body ?? "", variables);
    track(queryDoc.missing);
    let parsedVariables: unknown = {};
    if (definition.variables?.trim()) {
      const interpolated = interpolate(definition.variables, variables);
      track(interpolated.missing);
      try {
        parsedVariables = JSON.parse(interpolated.value) as unknown;
      } catch {
        parsedVariables = {};
      }
    }
    body = JSON.stringify({ query: queryDoc.value, variables: parsedVariables });
    headers["content-type"] ??= "application/json";
  } else if (definition.body !== null && definition.body !== "") {
    const interpolated = interpolate(definition.body, variables);
    track(interpolated.missing);
    body = interpolated.value;
    headers["content-type"] ??= "application/json";
  }

  let url = urlResult.value;
  const queryEntries = Object.entries(query).filter(([key]) => key.length > 0);
  if (queryEntries.length > 0) {
    const search = queryEntries
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    url += (url.includes("?") ? "&" : "?") + search;
  }

  return {
    method: definition.protocol === "graphql" ? "POST" : definition.method,
    url,
    headers,
    body,
    missingVariables: [...missing],
  };
}

/** Render an equivalent cURL command for a prepared request. */
export function toCurl(request: PreparedRequest): string {
  const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
  const parts = [`curl -X ${request.method}`, quote(request.url)];
  for (const [key, value] of Object.entries(request.headers)) {
    parts.push(`\\\n  -H ${quote(`${key}: ${value}`)}`);
  }
  if (request.body) parts.push(`\\\n  -d ${quote(request.body)}`);
  return parts.join(" ");
}
