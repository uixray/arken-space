# ArkenHar SMTP empty-config fix — checkpoint (2026-10-09)

## Scope and decision

- Fixed `parseAccountMailSmtpConfig` to detect configuration only from the eight `ACCOUNT_MAIL_SMTP_*` fields; whole-process environment values such as `DATABASE_URL` and runtime flags no longer activate SMTP parsing.
- Any non-empty SMTP-owned value still activates strict validation, so partial SMTP configuration fails closed. Runtime enablement remains independent and cannot make an absent SMTP adapter ready.
- No credential placeholders, dependency changes, product images, or deployment actions were introduced.

## Revision / changed files

- Worktree HEAD at start: `dfb89de` (uncommitted source change; no commit).
- `apps/server/src/account-mail-smtp.ts`
- `apps/server/src/account-mail-smtp.test.ts`
- `docs/plans/arkenhar-smtp-empty-config-fix20261009.md` (this checkpoint)

## Verification

- Direct runtime assertions via installed local Node/tsx: PASS for blank SMTP plus unrelated environment values returning `null`; context remains not-ready for runtime enabled and disabled with empty keyring; partial SMTP host is rejected with `MAIL_SMTP_CONFIG_INVALID`.
- Server bundle (`apps/server/node_modules/.bin/tsup.cmd src/index.ts --format esm --clean --sourcemap`): PASS.
- Full focused Vitest file did not execute: its `beforeAll` synthetic-certificate setup invokes Git-for-Windows OpenSSL, which is denied by sandbox (`NtCreateDirectoryObject ... 0xC0000022`). No bypass attempted.
- Server TypeScript typecheck attempted; currently fails with extensive pre-existing duplicate Drizzle ORM type identity errors across server/db imports. No dependencies were changed. Typecheck is not recorded as passing.

## Blockers / next action

- Re-run focused SMTP tests in an environment where the existing OpenSSL executable can create the synthetic local TLS fixture; resolve the pre-existing Drizzle type identity setup separately before claiming typecheck pass.
- Root integration/review is required before building replacement package images. Existing archive candidate remains blocked/immutable; this fix does not make any package transfer-ready.

## Root connected gate — 2026-10-09

Root reviewed the two-file source/test diff. Elevated local run of the same focused SMTP/runtime files completed: 2 files, 17 tests PASS; then server TypeScript `tsc --noEmit -p apps/server/tsconfig.json` exit 0. Synthetic OpenSSL setup therefore passed outside the restrictive sandbox; earlier duplicate-Drizzle type noise did not reproduce in this gate. Worker server bundle PASS remains recorded. No dependencies changed and no owner stand/remote/provider used. Current 4dca image/archive still does not contain this fix; next action is commit exact reviewed files and build a replacement immutable server image/context, reusing web only after exact context equivalence proof. No full SMTP four-arm or legacy matrix rerun requested; actual-image blank-SMTP bootstrap is the affected assertion.
