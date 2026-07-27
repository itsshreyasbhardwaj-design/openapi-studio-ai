import "server-only";

/**
 * SSRF protection for the built-in API client.
 *
 * The API client proxies user-supplied requests through the server so that
 * browsers are not blocked by CORS. That makes the proxy a classic SSRF sink,
 * so outbound targets are validated against an explicit allow/deny policy
 * before any socket is opened.
 */
export interface UrlPolicy {
  /** Permit requests to loopback/private ranges (default: only in local mode). */
  readonly allowPrivateNetwork: boolean;
  readonly allowedProtocols: readonly string[];
}

export const DEFAULT_POLICY: UrlPolicy = {
  allowPrivateNetwork: process.env.APP_MODE !== "production",
  allowedProtocols: ["http:", "https:"],
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Private, loopback, link-local and carrier-grade NAT ranges. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal"))
    return true;
  if (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd"))
    return true;
  if (host.startsWith("fe80:")) return true;
  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  const mapped = host.startsWith("::ffff:") ? host.slice(7) : host;

  const match = IPV4.exec(mapped);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  const [a, b] = octets;
  if (a === undefined || b === undefined) return false;
  if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → deny

  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export function assertSafeUrl(raw: string, policy: UrlPolicy = DEFAULT_POLICY): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "The target URL is not a valid absolute URL." };
  }

  if (!policy.allowedProtocols.includes(url.protocol)) {
    return { ok: false, reason: `Protocol "${url.protocol}" is not allowed.` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Credentials embedded in the URL are not allowed." };
  }
  if (!policy.allowPrivateNetwork && isPrivateHost(url.hostname)) {
    return { ok: false, reason: "Requests to private or loopback addresses are blocked." };
  }
  return { ok: true, url };
}

/** Headers that must never be forwarded from a client-supplied request. */
const FORBIDDEN_REQUEST_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "cookie",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-real-ip",
]);

export function sanitizeForwardHeaders(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const name = key.trim().toLowerCase();
    if (!name || FORBIDDEN_REQUEST_HEADERS.has(name)) continue;
    // Strip CR/LF to prevent header injection.
    out[name] = value.replace(/[\r\n]+/g, " ").trim();
  }
  return out;
}
