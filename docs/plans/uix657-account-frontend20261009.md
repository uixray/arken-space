# UIX-657 Account frontend checkpoint — 2026-10-09

## Decision and scope

- Implemented Pool C against the current account + campaign API contract: verified email/password lifecycle, password recovery/change, account session/logout, campaign list/create/select, and account-scoped PLAYER invite creation/claim.
- Campaign creation is shown only when the typed capability `campaignCreationEnabled` is true. Account login never derives a GM/PLAYER role from email, display name, alias, or a public roster.
- Invite action tokens live in the URL fragment only until the first effect consumes them, then are removed with `history.replaceState`; tokens are sent only in POST bodies. Pasted invite URLs must be same-origin `/account/join` links or raw format-valid tokens.
- `CAMPAIGN_LINK_ACCESS_ENABLED` / `campaignLinkAccessEnabled` remains false pending backend provenance/session validation for legacy GM/player links. This checkpoint does **not** claim old direct links function in account mode. Root owns the required link-provenance gate and activation.
- Mocked tests are labelled as mocks. The real local HTTP gate uses actual Fastify account/campaign handlers and PGlite/outbox, but intentionally stubs App bootstrap to 401 and does not claim actual gameplay snapshot/socket acceptance.
- Production client no longer imports or includes the historical beta roster. Local legacy player access accepts only an explicit personalized link when the server capability permits that mode.

## Revision and changed owned files

- Source revision at checkpoint: `3146a961c652f57dca7b90a4e5d6024b98fb4d37` (working tree; no commit made by this agent).
- Owned source files:
  - `apps/web/src/AccountAuthWorkspace.tsx`
  - `apps/web/src/account-auth-client.ts`
  - `apps/web/src/account-campaign-client.ts`
  - `apps/web/src/AuthGate.tsx`
  - `apps/web/src/account-auth.css`
- Owned tests:
  - `apps/web/src/AccountAuthWorkspace.test.tsx`
  - `apps/web/src/account-auth-client.test.ts`
  - `apps/web/src/AuthGate.test.tsx`
  - `tests/e2e/account-auth-mock.spec.ts`
  - `tests/e2e/account-auth-local-http.spec.ts`
- No backend, schema, deployment, secrets, or persistent stand files were edited by this owner. Root/backend/guide changes remain shared and uncommitted; preserve them.

## Verification receipts

- `pnpm --filter @arken/web exec vitest run src/AuthGate.test.tsx src/account-auth-client.test.ts src/AccountAuthWorkspace.test.tsx` — **3 files, 25/25 tests passed**. Includes StrictMode one-use fragment handling; authenticated action-link priority; local validation; generic unverified login; expired link; CSRF; campaign creation idempotency retry after an uncertain response; invite URL parsing/claim guards; and two intentional invites after the first success.
- `pnpm --filter @arken/web typecheck` — passed with no diagnostics.
- `pnpm exec playwright test tests/e2e/account-auth-local-http.spec.ts --project=chromium --reporter=line --retries=0` — **1/1 passed** at 15:12:26; actual local HTTP account registration → verify → login → campaign create → invite → second synthetic account verify/login → claim → active-campaign display. Uses an ephemeral Fastify port, disposable migrated PGlite database, isolated synthetic mail outbox, two isolated browser contexts. No `.env`, real identity, persistent stand, or production data.
- Actual local gate scope boundary: `/api/account/*` calls reach the local Fastify handlers through browser route forwarding. `/api/bootstrap` remains an explicit 401 stub; the test asserts the selected campaign UI state, **not** game shell, real bootstrap, socket, or multiplayer isolation.
- `pnpm exec playwright test tests/e2e/account-auth-mock.spec.ts --project=chromium --reporter=line --retries=0` — **2/2 passed** earlier; registration/verification/login/logout and expired-link UI with mocked transport. The subsequent combined focused browser invocation also completed **3/3** (local HTTP + two mock cases).
- `pnpm --filter @arken/web build` — passed. Non-blocking Vite warning remains: main JS chunk >500 kB.
- Production lexical check over generated `apps/web/dist/**/*.js` — passed: no known beta-alias values found. The original source-map setting was subsequently corrected in the account-link pool below; the final fresh build emits no `.map` files. No identity values printed.
- Focused A HTTP integration suite earlier in the pool had 5 pass / 2 fail before backend fixture corrections; backend owner reports those migration/mail fixtures corrected and server/DB/contracts typecheck passing. Do not use the earlier failure or any backend claim to imply broader A/B acceptance unless root reruns the current connected server gate.

## Remaining acceptance / blockers

- Legacy GM/player links alongside account UI are not active until `campaignLinkAccessEnabled` and the provenance/session guard are frozen and tested. No alias roster fallback is present.
- This gate intentionally does not establish the real gameplay bootstrap/socket or standalone server-selection integration; the current account browser harness uses a bootstrap stub. Guide-owned full-runtime evidence is separate and must not be conflated.
- Reset-request form is covered by component client tests; actual local HTTP browser path exercised verification rather than reset delivery. Backend reset/request/confirm acceptance remains owned by Pool A.
- Password change/logout, expired token, rate limits, mail transport activation, real SMTP, campaign quotas/policy, and account/game cross-session/socket behavior remain gated by backend tests/config and product approval. Production SMTP/deployment is explicitly out of scope.
- No commit, Linear mutation, push, merge, production migration, or deployment performed. Root owns whole-workspace review/integration and UIX-657 disposition.

## Next action

Root/backend owner: freeze and verify legacy link provenance/capability before enabling account-mode `/gm` or `/join` legacy flows; then request one final connected workspace gate after source freeze. No need to repeat the 25-test component suite until additional source changes.

## Follow-up pool — account-mode direct campaign links

- Decision: account-mode `/gm/:token` and `/join/:token` now render a scoped personal-link form only when server capability `campaignLinkAccessEnabled` is true. Otherwise the token is removed from the URL, no POST is sent, and the page explains the feature is disabled. Account root remains on email/password workspace. Public `/play/:alias` remains disabled; the client never calls `/api/auth/player/:handle`.
- Secret handling: legacy URL path token is captured in component state and immediately removed with `history.replaceState`; it is POST-body-only to `/api/auth/gm` or `/api/auth/invite`. Successful auth clears browser location and invokes existing `onAuthenticated` bootstrap path. No token logging/telemetry added.
- Changed files in this follow-up: `apps/web/src/AuthGate.tsx`, `apps/web/src/account-auth-client.ts`, `apps/web/src/AuthGate.test.tsx`, `tests/e2e/account-auth-mock.spec.ts`, `apps/web/vite.config.ts`, this checkpoint.
- UI unit: `pnpm --filter @arken/web exec vitest run src/AuthGate.test.tsx` — final **1 file, 11/11 passed**, including StrictMode regression proving legacy-dev `/gm/:token` stays available to POST after URL cleanup and captured `/join/:token` uses its token after URL cleanup.
- Browser: `pnpm exec playwright test tests/e2e/account-auth-mock.spec.ts --project=chromium --reporter=line --retries=0` — **4/4 passed**, explicitly mocked transport; includes disabled capability/no fallback, enabled PLAYER POST, fragment/link secret cleanup and alias-disabled behavior.
- `pnpm --filter @arken/web typecheck` — passed; `pnpm --filter @arken/web build` — passed (existing >500 kB chunk advisory). `Dockerfile.web` copies the complete `apps/web/dist` into public Nginx root, so `apps/web/vite.config.ts` now sets `build.sourcemap: false`; fresh build output had **0 `.map` files**. This closes public map delivery for newly built artifacts; no container/image build/deployment was run.
- Real local runtime: `pnpm exec playwright test tests/e2e/account-campaign-links-local-http.spec.ts --project=chromium --reporter=line --retries=0` — final **2/2 passed** with Playwright trace disabled, against an isolated Fastify server with full `registerRoutes`, disposable migrated PGlite, synthetic GM credential + PLAYER grant, actual `/api/auth/gm` and `/api/auth/invite`, cookie session, and actual role-specific `/api/bootstrap`; browser verified GM and PLAYER snapshot roles and app shell. The test did not run a Socket.IO server/realtime join; that remains a separate backend realtime gate. Vite emitted expected websocket ECONNABORTED warnings because no realtime server is attached; test assertions passed.
- Remaining gate: persistent 4101/14246 stand was not touched or restarted. Actual local account-mode old-link HTTP/bootstrap is now covered; production/manual acceptance and actual realtime socket connection remain separate. Legacy URL tokens are stripped immediately in the SPA and POST-body-only afterward; because legacy format puts the token in the initial URL path, production edge/access-log redaction must be verified before public rollout (client code cannot prevent the first HTTP request path from reaching the web server).
- No commit/stage/Linear mutation/deployment. Root owns integration and final acceptance.

## Root connected frontend integration gate
2026-10-09 root workspace-root Vitest invocation of AuthGate/account-auth-client/AccountAuthWorkspace PASS3files30/30tests (6.30s), after legacy link followup. Agent actual full-route link browser2/2 proves HTTP cookie/role/bootstrap/game shell, mocked io explicitly excludes socket transport. Separate4liveSocket tests retained. Production build0mapfiles removes public sourcemap exposure; initial old-token URLpath logging remains a distinct edge gate.
