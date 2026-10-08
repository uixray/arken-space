# UIX-644 / UIX-293 — Global sticker manager Escape checkpoint

Date: 2026-10-08 (Europe/Moscow)

## State and decision

- Worktree: `D:\AI\personal\experiments\arken-space\.worktrees\uix-293-catalog-20261007`
- Base / current HEAD: `bbc52b1aa58a96b9076bab83c40f33785523ef95` (handoff checkpoint). Source remains uncommitted and frozen for root review.
- Scope: own Escape only while the GlobalStickerPackManager disclosure is open. Consume the initial Escape, close the disclosure and restore focus to its summary. Track ownership of the held key: repeats are consumed only after that owned close; Escape keyup clears the latch; the next deliberate press bubbles to the parent. Native select/input are not intercepted.
- No credentials or fixture contents are included here. The authorized isolated B fixture was read programmatically only.

## Changed source and hashes

- `apps/web/src/GlobalStickerPackManager.tsx` — SHA-256 `A157A1BB4CF69A9AE940EB010D0973E853FFF0770C26431EC101BF9D5FD9F5BD`
- `apps/web/src/GlobalStickerPackManager.test.tsx` — SHA-256 `11BCC0113853899280154EE5ED05FB96DA83448B9A26DB3611FC496CBEFE5282`

Test coverage includes: closed-summary repeat without prior ownership bubbles; open-summary Escape closes/focuses and does not reach parent; held repeat stays consumed; Escape keyup resets ownership; following fresh Escape bubbles; native select and input Escape are not intercepted (DOM unit evidence only).

## Verification

- `pnpm exec vitest run apps/web/src/GlobalStickerPackManager.test.tsx apps/web/src/ui/ArkenDialog.escape.dom.test.tsx` — PASS, 2 files / 25 tests.
- `pnpm --filter @arken/web typecheck` — PASS, exit 0.
- `git diff --check` — PASS.
- Browser harness: `.tmp/escape-fix-local.qa.mjs`; root's independent successful four-cell output: `.data/qa-prep/uix644-escape-root-20261008205925.log`.
- Four local B-fixture browser cells PASS: Chrome desktop, Chrome compact, Firefox desktop, Firefox compact. They exercised opening the Files workspace and Global Packs disclosure, owned close/focus, repeated Escape not dismissing Files, then keyup + fresh Escape bubbling to dismiss Files. Browser harness did **not** verify select/input passthrough; that is unit-test evidence only.
- Existing local API/Vite QA runtime was reused; no restart, reset, reseed, remote server, deploy, push, merge, or full legacy E2E.

## Failure history and evidence boundaries

- Historical QA11941 had two desktop failures and compact was not run. Those predate this fix and remain historical failure evidence; do not overwrite/relabel them as passes.
- During this continuation, an early unit attempt failed because the test mock omitted the detail response and had an incorrect parent-event call count; both were corrected before the final 25/25 run.
- Early browser harness attempts failed from using desktop navigation selectors in compact mode / selecting the Files item before opening the overflow menu. These were harness navigation errors, not product regressions. A separate root sandbox browser-launch attempt exited 1 before the successful independent run; not a source failure.
- Native OS select popup behavior and manual Firefox/native-popup acceptance remain pending; synthetic DOM select/input checks do not close that gate.

## Next action

Root reviews the frozen two-file source diff and the referenced independent browser log, then commits only the explicitly approved files/checkpoint. Keep UIX issues open until their own remaining criteria/evidence are reconciled; do not claim broader release readiness from this focused gate.
