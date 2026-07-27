# Summary

<!-- What does this change and, more importantly, why? One or two paragraphs. -->

Closes #

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] Feature (non-breaking change that adds capability)
- [ ] Breaking change (existing behaviour changes)
- [ ] Documentation
- [ ] Internal (refactor, tooling, tests)

## Area

- [ ] Core engines (`src/lib/core`)
- [ ] Server / persistence (`src/lib/server`, `src/lib/repository`, `src/lib/services`)
- [ ] API routes (`src/app/api`)
- [ ] UI (`src/app`, `src/components`)
- [ ] Docs / CI

## How was it verified?

<!-- Which tests were added, and what did you check by hand? -->

- [ ] `pnpm verify` passes (typecheck, lint, tests, build)
- [ ] Added or updated tests covering the change
- [ ] Checked the affected screens in the browser

## Checklist

- [ ] Core engines remain pure (no I/O, no `process.env`, no React in `src/lib/core`)
- [ ] New endpoints go through `route()` and validate input with Zod
- [ ] New diagnostics carry a JSON Pointer and an actionable hint
- [ ] No secrets, tokens or personal data in code, fixtures or logs
- [ ] Documentation updated where behaviour changed

## Screenshots

<!-- For UI changes, before and after. Delete this section otherwise. -->
