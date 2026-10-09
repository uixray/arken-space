# UIX-644 — isolated ResizeObserver target preparation (2026-10-09)

## Gate result

**Preparation PASS for both historical exports; launch/comparison NOT RUN.** This is not a ResizeObserver reproduction, causal finding, current-release pass, or issue closure.

- Active checkout/source SHA remained `83726c996ace13872b174d535883543ab3c39a58`; the historical source exports are exact commits `452f5f162da51f10fbafcedef92f5d85fc9d36cf` (old) and `e03b60e2be3c95f5f18033b2760284587160e566` (comparison).
- Exclusive artifacts are contained in ignored `.data/qa-prep/uix644-ro-isolated-20261009/7f5a4e90-4ac4-49ba-8f78-3b3d6c1d5d42/`. Both export destinations were absent at preflight; the resolved paths stayed under the checkout. No active-worktree checkout/reset or source edit was performed.
- Source archive SHA-256: old `4127F605590BBFD96C6BE35B503DE7EBBA8A8F90171600BF2091B2BCB58AE6F5`; comparison `9B7C79DB28D5B2DD2E6FFE3AD97EA2602B6FF7E3DCFF3C26B9FB71921DB88DC1`.
- The two exported root/web manifests and lockfile match their Git blobs. Lock SHA-256 is identical in both: `402501F0C54ADA218EA268CD804BA65439800A3E330F9F3A8C0510DC72D4B329`. The only `.env*` file in either archive is tracked `.env.example`; no `.env` secret file or ignored data was copied.

## Offline dependency and build evidence

- Global `pnpm --version` under the sandbox initially failed on an EPERM while the pnpm package-manager bootstrap tried a protected temporary path. The same check was approved elevated and confirmed `10.12.1`; Node was `v24.15.0`.
- In each export independently, ran `pnpm install --offline --frozen-lockfile --ignore-scripts --store-dir D:\.pnpm-store\v10`. Both exited 0, resolved/reused 667 packages, downloaded 0, and reported frozen lockfile current. No lifecycle scripts were enabled. Lock SHA remained the same. The virtual store is local to each export (`<export>/node_modules/.pnpm`); the active checkout's `node_modules` was not used or edited.
- In each export only, `pnpm --filter @arken/contracts build` and `pnpm --filter @arken/system build` both exited 0 using locked tsup `8.5.1`. Hashes are recorded in the sanitized receipt. No recursive root build or server/database operation occurred.
- Sanitized receipt: `.data/qa-prep/uix644-ro-isolated-20261009/7f5a4e90-4ac4-49ba-8f78-3b3d6c1d5d42/preparation-receipt.json`, SHA-256 `4DCD7A26DF86D3A7B8C1352B9B6CB14360F825F26738686FD5966ABF3C7A5B9F`. It records commands, exit status, lock/archive/output hashes and isolation boundaries; it contains no credentials or fixture payload.

## Boundary, blockers, next action

- **Not done by this pool:** harness extraction/fixture-equivalence work, browser installation/version check, Vite runner config, free-port checks, frontend launch, and browser comparison. No browser or frontend process was launched. The active API/database and Vite ports were not touched.
- Old and comparison outputs differ in `@arken/contracts` dist hashes but share `@arken/system` hashes. This is expected source-version output and must not be overwritten with active-checkout `dist`.
- Next action: hand the two prepared exports to the separately assigned P1 browser owner for the bounded same-fixture work. That owner must still establish exact fixture/helper/assets equivalence, fail-closed interception, browser version and isolated runner/ports before any launch. If those preconditions fail, stop without running a fallback test. Root owns the causal interpretation and release ledger.

## Compact checkpoint

- **Decisions:** no source changes; preserve historical commits and independent locked installs. Successful preparation is not launch readiness.
- **Revision:** active source `83726c996ace13872b174d535883543ab3c39a58`.
- **Changed files:** this new checkpoint; two disposable ignored source exports, their local `node_modules`/contract+system build outputs, two source zips and one sanitized receipt.
- **Verification:** exact commit archives/hashes; exported root/web manifests and lock hashes; offline frozen install exit 0 for both with zero downloads/scripts; contracts/system build exit 0 for both; receipt hash above.
- **Blocker:** comparable isolated browser harness/fixture/runner prerequisites have not yet been established, so no launch or causal comparison.
- **Next:** P1 owner continues preparation/one comparison from these isolated exports under the existing plan. No automatic reinstall/rebuild or launch in this pool.

No product edits, browser/frontend launch, shared dependency/process/data mutation, Linear update, commit, deploy or remote action.
