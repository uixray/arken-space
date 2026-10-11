# Server container stop diagnostic — 2026-10-09

## Scope and evidence

Read-only source review at candidate `76fc9cc`; current checkout HEAD `0476865c8a80ad13dda7ee9fa248cd685c591f54` has the same relevant Dockerfile, package scripts, and `apps/server/src/index.ts`. No product files, services, or containers were changed or restarted.

Inputs supplied by the runtime owner: Docker stop ended with exit 137 and `OOMKilled=false`. That supports forced termination after a stop timeout more than an OOM explanation, but does not identify the exact process/container event by itself.

## Findings

- `Dockerfile.server` ends with `CMD ["sh", "-c", "pnpm db:migrate && node apps/server/dist/index.js"]`. The container's PID 1 is therefore a shell, not the server process. The shell starts `pnpm` for migrations and then starts Node as a child; the final Node invocation is not prefixed by `exec`.
- No `SIGTERM`/`SIGINT` handling or `app.close()` call exists in `apps/server/src/index.ts` at this revision. The Fastify `onClose` hook does close Socket.IO and the database client, but is only run by Fastify's close lifecycle; it is not wired to process signals in the reviewed entrypoint.
- `docker-compose.yml` has no explicit `init`, `stop_grace_period`, `entrypoint`, or `command` override for `server`. Therefore there is no repository-defined init shim or custom grace period to explain/mitigate the stop.
- Plausible mechanism: Docker signals PID 1 (`sh`); the shell/child process arrangement may not promptly deliver that signal to Node, or Node may exit without orderly Fastify close. If the stop grace period expires, Docker sends SIGKILL (exit 137). The source makes this a concrete shutdown-risk hypothesis, not proof that it was the exact cause of the observed event. Runtime logs/process inspection are needed to distinguish signal propagation from another hang.

## Bounded remediation options (not applied)

1. Minimal process-boundary fix: retain the migration command, then use `exec node apps/server/dist/index.js` so Node replaces the shell after migrations. This improves signal delivery but by itself does not guarantee orderly Fastify/DB shutdown.
2. Graceful lifecycle fix: register idempotent `SIGTERM` and `SIGINT` handlers in the server entrypoint that call/await `app.close()`, allowing the existing `onClose` hook to close Socket.IO and the DB client. Combine with option 1 so signals reach Node directly.
3. If adopting a supervisor/init is preferred, set Compose `init: true` explicitly and still implement Fastify shutdown; a longer `stop_grace_period` alone only delays SIGKILL and is not a lifecycle fix.

Before a source change, confirm the preferred remedy and whether graceful close should also log/flush pending work. After approval, validate with a disposable local container by recording PID tree, sending SIGTERM, observing Fastify `onClose` completion, and checking exit status/time; do not infer success from `OOMKilled=false` alone.

## Implemented bounded fix

At current working source (subsequent to the read-only `76fc9cc` diagnosis):

- `Dockerfile.server` now uses `exec node apps/server/dist/index.js` after the migration succeeds, replacing the shell with Node for the steady-state server process.
- `apps/server/src/graceful-shutdown.ts` installs idempotent SIGTERM/SIGINT handlers; each calls `app.close()`, which enters the existing Fastify `onClose` hook. That hook now awaits `io.close()` before ending the DB client. A bounded 8-second timeout exits 1; close success exits 0; close rejection exits 1. Logs contain only signal/deadline and lifecycle event names, not driver error text.
- `apps/server/src/graceful-shutdown.test.ts` covers duplicate signals/one close, close failure with redacted log behavior, and timeout nonzero exit.

Focused verification: `vitest run apps/server/src/graceful-shutdown.test.ts` — 3 passed; server TypeScript check — exit 0. Runtime container image build and actual Docker stop probe remain for the separately assigned runtime gate; these unit/type checks do not prove PID 1 behavior or stop latency.

## Conclusion

The strongest source-backed issue was the shell-as-PID1 command without `exec`, compounded by no explicit application SIGTERM path to `app.close()`. This materially supported a stop-timeout explanation for exit 137, but did not prove it without runtime process/log evidence. The bounded source fix above is in place; actual runtime probe remains required before treating the lifecycle gate as passed.

## Root runtime acceptance — aca1436
- Root inspected .data/qa-prep/local-image-readiness-aca1436-20261009/server-shutdown-receipt.json: exact sourceaca14360c5033844ba3cfea9d87b8d48e6d07b0b/treeb429e9cf9446860b6f4eef3c6d6d1b4c0c5539c7; automatic migration/start health200/revisionaca1436; default Dockerstop exit0 in0.56s/OOMKilledfalse; shutdown-started and shutdown-complete logs both present.
- Runtime lifecycle gate PASS for this disposable scope; prior76fc9cc exit137 remains immutable historical evidence. No full authenticated traffic/drain, production, or schema rollback claim.
- New server image e91b854539a1dea8e929d66dcc9796e104aca0ccd4f2fc1a8b6a49333ef0f09a; export191119360B SHA1aa9641018759b1d26b38b132f76c58a3ccd263f5598bf38b4d8610aef4af897. Web remains76fc9cc; no uniform revision or UIX264-in-old-web claim.
