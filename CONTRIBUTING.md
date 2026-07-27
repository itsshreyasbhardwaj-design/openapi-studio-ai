# Contributing

Thanks for considering a contribution. This project aims to be a tool people reach for by choice, which
means the bar is "would I want to maintain this in a year?" rather than "does it work today".

## Getting set up

```bash
pnpm install
pnpm dev          # http://localhost:3000 — no configuration needed
pnpm verify       # typecheck + lint + tests + production build
```

There is no database or API key to configure. If `pnpm dev` does not work from a clean clone, that is a
bug worth reporting on its own.

## Before you open a pull request

```bash
pnpm verify
```

All four steps must pass. CI runs exactly this, so a green local run means a green pipeline.

- **New core behaviour needs a test.** Core engines are pure, so tests are cheap — there is no excuse.
- **Bug fixes need a regression test** that fails before the fix.
- **Run `pnpm format`** before committing.

## Layering rules

These are enforced in review because they are what keeps the codebase workable:

1. **`src/lib/core` stays pure.** No `fetch`, no `fs`, no `process.env`, no React, no `server-only`. If
   your change needs I/O, the I/O belongs in a caller and the pure part belongs in core.
2. **Depend on the `StudioRepository` interface**, never on a database driver.
3. **Core functions return `Result<T, E>`** for expected failures. Throw only at trusted boundaries.
4. **Routes stay thin.** Validate with Zod, delegate, render. Logic lives in a service or an engine.
5. **New endpoints go through `route()`** so they inherit auth, rate limiting, logging and error mapping.

## Adding a rule

Validator, linter and security rules are the most common contribution.

- **Structural rules** (`src/lib/core/openapi/validate.ts`) answer _"is this legal OpenAPI?"_.
- **Quality rules** (`lint.ts`) answer _"is this a good contract?"_.
- **Security rules** (`src/lib/core/security/rules.ts`) are self-contained objects with an id, a severity,
  an OWASP category and an `evaluate()` function.

Every finding must carry a JSON Pointer and an actionable hint. If a rule can be fixed mechanically, add
a `fix` and the "Improve" button picks it up for free.

Please include, in the PR description, one example that the rule _should_ flag and one that it should
not. False positives are worse than a missing rule — an analyser people stop trusting is worse than no
analyser.

## Adding an SDK language

1. Add the language to `SDK_LANGUAGES` in `src/lib/core/sdk/model.ts`.
2. Write an emitter that consumes `SdkSpec`. Do not re-traverse the OpenAPI document.
3. Register it in `src/lib/core/sdk/index.ts`.
4. Add assertions to `tests/sdk/generators.test.ts` covering: a typed model, a method per operation, the
   error type, and a valid package manifest.

Generated clients are expected to include authentication, retries with backoff, typed models and a
README. A generator that emits a bare `fetch` wrapper will not be merged.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(sdk): add Ruby generator
fix(mock): honour Retry-After on simulated 429 responses
docs(architecture): explain the diff direction rule
test(security): cover unsigned webhook detection
```

## Reporting bugs

Use the issue templates. For a specification-related bug, **include the document** (or a minimal
reduction of it) — almost every parser or validator bug is impossible to act on without one.

## Security

Do not open a public issue for a vulnerability. Follow [`SECURITY.md`](./SECURITY.md).

## Code of conduct

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).
