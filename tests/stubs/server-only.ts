/**
 * `server-only` throws when resolved outside a React Server Component bundle.
 * Vitest runs plain Node, so the guard is aliased to this no-op — the modules
 * under test are still exercised exactly as the server would run them.
 */
export {};
