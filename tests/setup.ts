import { beforeEach } from "vitest";

// Every suite runs against the in-memory repository and the offline AI engine.
Object.assign(process.env, { NODE_ENV: "test" });
process.env.APP_MODE = "local";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
delete process.env.DATABASE_URL;
delete process.env.OPENROUTER_API_KEY;
delete process.env.CLERK_SECRET_KEY;
delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

beforeEach(() => {
  // Keep environment memoisation from leaking assertions between suites.
  process.env.ENCRYPTION_KEY ??= "test-encryption-key-that-is-long-enough-32";
});
