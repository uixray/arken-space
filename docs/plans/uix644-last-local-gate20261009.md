# UIX-644 — bounded local P/S pool handoff (2026-10-09)

**PARTIAL / ROOT-RUN ONLY.** This handoff distinguishes preparation from one root-owned runtime attempt. The worker did not access fixtures or launch a browser. Root's first connected attempt is preserved below; it did not reach P/S assertions.

## Frozen scope and boundary

Pinned product source revision: `52013d43e6f2fca1bb268c38608afde9cd76424a`. Helper checks SHA-256 for its 15 relevant caller/transport files before it will read the authorized fixtures. Scope is the approved four cells (Chrome/Firefox × desktop 1360×900/compact 390×844): PlayerRequests' five native selector lifecycles and character selector intermediate focus; ScenePicker open/Escape, source-supported outside-pointer dismissal, current-scene edit entry and cancel/focus return. It does not select a scene, save, submit a request, modify fixtures, or claim OS-native popup/keyboard focus-outside coverage. One source-known initial `scene:view(null)` per fresh socket is allowed only during bootstrap; `game:resync` is read-only; all other socket events are denied before forwarding. Socket bootstrap remains open until its bounded initial-null observation (and GM initial snapshot) complete.

Exact API reads are allowlisted (bootstrap, source-identified PlayerRequests/chat/operator reads, canvas-history GET, and content GETs); unknown API reads, all external requests, and every non-approved mutation are aborted. The socket transport allows only `ws://127.0.0.1:14183/socket.io/` (no external host, alternate port, TLS origin or path). GM/player auth POSTs require the single `token` property, with PLAYER auth conditioned on the retained grant preflight. Tokens, fixture values, option labels, private IDs, raw URLs, and response bodies are never emitted into receipts or console output. The request guard is awaited before navigation.

## Owned artifacts and verification

- Helper: `.tmp/uix644-last-local-pool20261009.qa.mjs`
- Offline guard test: `.tmp/uix644-last-local-pool20261009.guard.test.mjs`
- Runtime receipts, if separately root-authorized: `.data/qa-prep/uix644-last-local-pool20261009/`, exclusive-create names.
- Offline validation after the bounded instrumentation correction (executed; all exit 0):
  - `node --check .tmp/uix644-last-local-pool20261009.qa.mjs`
  - `node --check .tmp/uix644-last-local-pool20261009.guard.test.mjs`
  - `node --test .tmp/uix644-last-local-pool20261009.guard.test.mjs` — 8/8 pass, including no-op default, exact auth intent, API read/write guard, exact loopback websocket transport, initial-null socket guard, focus observation contract, keyboard focus progression (using `page.keyboard.press` after initial focus, not locator `press` which can refocus the trigger), source callers and pinned SHA manifest.
  - `git diff --check` — exit 0 (Git printed a non-fatal fsmonitor IPC diagnostic).

### Runtime attempt 1 — retained partial

Root ran the frozen helper once. Receipt: `.data/qa-prep/uix644-last-local-pool20261009/last-local-pool-20261009T061253909Z-fb7422cc-8238-4618-aeba-613cd3ec4a1e.json`, SHA-256 `7461e7842999998eac9d7c7d43b47b002760e7b62b0ab191f8a50d742845a29a`. It returned `PARTIAL`, Chrome desktop only; no P/S assertions ran and `initialNullForwarded=0`. It recorded 2 auth responses, 2 chat read markers, 0 domain writes; websocket guard rejected the loopback Socket.IO `ws:` URL because the comparison expected page `http:` origin. It also blocked source-confirmed read-only `/api/canvas/history` GETs as unreviewed; operator-capability 403 classification used an incomplete route-family mapping. External reads/fonts remain blocked; do not widen that policy or suppress errors.

One root-authorized instrumentation correction was applied offline: an exact `ws://127.0.0.1:14183/socket.io/` predicate now permits only the loopback Socket.IO endpoint; exact canvas-history GET and operator capability family are source-pinned/recognized. Regressions reject TLS, alternate hosts/ports/paths and unknown API reads. This correction does not prove runtime behavior. The one bounded correction budget is consumed; no further helper repair or automatic rerun is authorized. Root owns any remaining one attempt, restricted to still-unobserved P/S cells; preserve this partial receipt and its failure evidence.

### Runtime attempt 2 — terminal partial, no more automatic retries

Root's final permitted run returned `PARTIAL` (exit 0), receipt `.data/qa-prep/uix644-last-local-pool20261009/last-local-pool-20261009T061438257Z-fceb0a04-c814-4d6a-909c-3ee6ce9d8ec3.json`, SHA-256 `606c8742b0dfa0828b1633a5bbaccd5fe48f08377e6511e39185ecc098bde804`. Only Chrome desktop opened; assertion count was zero and P/S were not reached. The corrected transport forwarded 2 initial-null events and the exact canvas-history GET was no longer blocked; operator-capability 403 was classified exactly (2). Measured audit: 2 auth sessions, 2 chat-read markers, 0 blocked HTTP domain attempts, 0 resource failures; these are transport counters, not proof of zero DB/domain changes. The guard then recorded six unapproved websocket attempts and two generic blocked socket-event attempts and safely stopped. Their precise application/HMR cause is not established by the sanitized evidence; do not infer that they are harmless, widen allowlists, inspect/print private frames, or promote them to domain writes. Three external GETs remained blocked; external fonts/errors were not waived. The four other browser/viewport cells and all P/S assertions remain unobserved.

**Stop:** correction budget is exhausted and root instructed no further helper/runtime attempts. Do not claim P/S coverage, app behavior PASS, domain-data unchanged, or full UIX-644 completion from these partial runs. Handoff the socket transport observability/allowlist question and unobserved cells to root/owner for an explicit next-stage decision; preserve both immutable attempt receipts.

A runtime result must retain the known source limitation that ScenePicker's current `listbox=false` dismissal is pointerdown-based, not keyboard focus-outside dismissal. Native OS popup and true browser zoom remain separate human/browser-chrome evidence.

## Next action

Root reviews the frozen helper, hashes, guard assertions, and approved runtime identities, then either authorizes the one bounded connected attempt or records an explicit blocker. Do not infer runtime readiness/PASS, expand the network allowlist, repeat accepted matrix cases, retry a failed cell, alter product files, update Linear, deploy, push, merge, or close issues from this preparation artifact. Preserve the historical coverage ledger counts/statuses unchanged until root integrates any new named evidence.
