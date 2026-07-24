# UIX-271 checkpoint — local release gate

- **Decision:** feature base `b806d78bb94810dff16ffd79d515af66c4664021`; final `RELEASE_SHA` is assigned only after the release-control changes are committed and every automated gate is rerun.
- **Revision:** branch `codex/uix271-release-gate`, uncommitted release-control changes on feature base `b806d78`.
- **Changed files:** legacy chat snapshot compatibility and tests; migration-ledger restore verification; schema-safe backup counts; reset gate; release candidate, preflight, and 39-row feature matrix docs.
- **Verification:** lint PASS; typecheck PASS; Vitest 62 files / 327 tests PASS; focused release-safety tests PASS; key Chromium batch 21/21 PASS; `git diff --check` PASS.
- **Findings fixed:** old API snapshots omitted `chatThreads` / `chatThreadStates`; restore must accept an exact migration prefix before candidate startup and require the exact complete ledger after candidate migration; pre-migration backup counts must skip tables not yet present.
- **Blockers before production:** commit and assign `RELEASE_SHA`; rerun build and complete automated gate at that SHA; fresh production backup; isolated restore + rollback rehearsal; multiplayer and human GM + six-player matrix; explicit production GO. Linear stage-gate update is pending because the connector is unavailable.
- **Next action:** commit the release-control revision, rerun final-SHA gates, then prepare the evidence bundle. Do not deploy without explicit approval.
