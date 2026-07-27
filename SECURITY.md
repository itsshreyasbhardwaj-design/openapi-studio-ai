# Security Policy

## Supported versions

The `main` branch is the supported version. Fixes are released from `main`.

## Reporting a vulnerability

**Please do not open a public issue.**

Report privately through
[GitHub Security Advisories](https://github.com/itsshreyasbhardwaj-design/openapi-studio-ai/security/advisories/new).

Please include:

- what an attacker can achieve, and the preconditions required;
- reproduction steps, ideally with a specification document or request that triggers it;
- the affected commit and your configuration (local mode, or which hosted services are enabled).

You can expect an acknowledgement within 72 hours and an assessment within seven days. We will keep you
updated through the advisory and credit you in the release notes unless you prefer otherwise.

## Threat model

OpenAPI Studio AI accepts **untrusted specification documents** and executes **user-authored HTTP
requests**. Those are the two primary attack surfaces, and both have deliberate controls:

| Surface                  | Control                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Untrusted specifications | External `$ref`s are **never fetched**. Reference resolution is local-only and cycle-guarded, so a malicious document cannot make the server issue requests or hang.                                   |
| Untrusted specifications | Payload size is capped by `MAX_SPEC_BYTES`; example generation, dereferencing and diffing are all depth-limited.                                                                                       |
| The request proxy        | Every target passes `assertSafeUrl()`: protocol allow-list, no embedded credentials, and (outside local mode) no loopback, private, link-local or CGNAT addresses — cloud metadata endpoints included. |
| The request proxy        | Hop-by-hop and identity headers (`host`, `cookie`, `x-forwarded-*`, `connection`, …) are stripped, and CR/LF is removed to prevent header injection.                                                   |
| The mock server          | Public by design so clients can call it, but rate-limited and unable to reach anything other than the stored document.                                                                                 |
| Stored secrets           | Environment secrets are encrypted with AES-256-GCM when `ENCRYPTION_KEY` is set, returned to the browser masked, and never logged.                                                                     |
| Logs                     | Any key matching `authorization\|cookie\|api[-_]?key\|secret\|token\|password\|passphrase` is redacted at any depth.                                                                                   |
| Abuse                    | Per-identity, per-scope fixed-window rate limiting on every mutating and expensive endpoint.                                                                                                           |

### Known limitations

These are documented rather than hidden:

- **Rate limiting is in-process.** A multi-instance deployment needs a shared store; the `consume()`
  function is the seam for one.
- **The default file repository is single-writer.** Concurrent writes from multiple processes can lose
  an update. Use `DATABASE_URL` for anything shared.
- **In local mode the SSRF policy permits private addresses** so you can point the client at
  `localhost`. `APP_MODE=production` disables that, and the health endpoint reports readiness.
- **The mock server is unauthenticated at the platform level.** Anyone who knows a spec id can call its
  mock. Do not put production data in example payloads.

## Hardening a deployment

Set `APP_MODE=production` and the health endpoint will refuse to report healthy until:

- `DATABASE_URL` is configured (durable, concurrent-safe storage);
- Clerk keys are configured (real authentication rather than the local identity);
- `ENCRYPTION_KEY` is configured (secrets encrypted at rest);
- `NEXT_PUBLIC_APP_URL` uses HTTPS.

Security headers (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`) are applied to every response by `next.config.ts`.
