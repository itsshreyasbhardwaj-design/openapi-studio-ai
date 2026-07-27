import "server-only";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTED = "[redacted]";
const SENSITIVE_KEY = /(authorization|cookie|api[-_]?key|secret|token|password|passphrase)/i;

/** Recursively redact values whose key looks like a credential. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[max-depth]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
  /** Time an async operation and log its duration + outcome. */
  time<T>(message: string, fn: () => Promise<T>, context?: Record<string, unknown>): Promise<T>;
}

function minLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function emit(level: LogLevel, message: string, bindings: Record<string, unknown>): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel()]) return;
  const record = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(redact(bindings) as Record<string, unknown>),
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function make(bindings: Record<string, unknown>): Logger {
  return {
    debug: (message, context) => emit("debug", message, { ...bindings, ...context }),
    info: (message, context) => emit("info", message, { ...bindings, ...context }),
    warn: (message, context) => emit("warn", message, { ...bindings, ...context }),
    error: (message, context) => emit("error", message, { ...bindings, ...context }),
    child: (extra) => make({ ...bindings, ...extra }),
    async time(message, fn, context) {
      const started = performance.now();
      try {
        const result = await fn();
        emit("info", message, {
          ...bindings,
          ...context,
          durationMs: Math.round(performance.now() - started),
          outcome: "ok",
        });
        return result;
      } catch (error) {
        emit("error", message, {
          ...bindings,
          ...context,
          durationMs: Math.round(performance.now() - started),
          outcome: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

export const logger: Logger = make({ service: "openapi-studio-ai" });
