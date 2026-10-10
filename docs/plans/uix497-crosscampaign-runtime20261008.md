# UIX-497 / UIX-649 — A/B crosscampaign runtime checkpoint

Date: 2026-10-08 (Europe/Moscow)

## Decision, scope, and revision

- Worktree: `D:\AI\personal\experiments\arken-space\.worktrees\uix-293-catalog-20261007`
- Product source tested: `52013d43e6f2fca1bb268c38608afde9cd76424a`.
- Current HEAD at checkpoint: `0e571489119159d250039391a20888ded9ca7830`, documentation-only commit after the tested source SHA. No product source changed during this pool.
- Authorized local A and rotated B fixtures were consumed programmatically only. No token values, bootstrap payloads, scene/chat text, sticker names, or alts were printed or written to the receipt. No read of the old seed.
- Existing QA API PID was not restarted; Vite on `127.0.0.1:14183` was absent. Root explicitly authorized a scoped Vite-only start using the existing local config. Started hidden PID 8380 from `apps/web` with `pnpm exec vite --config ../../.data/qa-prep/uix644-local-vite.config.ts`; no API/DB restart, reset, reseed, import, or catalog mutation.
- Startup gate: Vite `/acceptance` returned 200 and Vite-proxied `/healthz` returned 200. Logs: `.data/qa-prep/uix497-crosscampaign-vite20261008.stdout.log` and `.data/qa-prep/uix497-crosscampaign-vite20261008.stderr.log`.

## Harness and immutable receipts

- Harness: `.data/qa-prep/uix497-crosscampaign-runtime.mjs`
- Harness SHA-256: `10B8954E452A9A7D1D4FFFEE09E651C6410CBF492194C4AA678C2880707073CF`
- Successful immutable receipt: `.data/qa-prep/uix497-crosscampaign-runtime-20261008181718752-2c899095-ef81-4fa3-ae0d-c3c7d6d9e07c.json`
- Receipt SHA-256: `367DC677C024569D2AF36D63F143946622F55EB0B158C78A67D5843EE2E55216`
- Final command: `node .data/qa-prep/uix497-crosscampaign-runtime.mjs` — PASS, exit 0. This is a focused 4-context UI/runtime gate, not full legacy E2E.

## Results

- Official GM and PLAYER login plus bootstrap succeeded in all four contexts: A/GM, A/PLAYER, B/GM, B/PLAYER. Receipt stores hashed campaign identifiers only.
- Real authenticated catalog GET in all contexts found exactly two `GLOBAL_PUBLIC` packs with 24 and 115 items (139 total); pack/item identifiers matched across both campaigns and both roles. No sweep/scroll of all 139 media items was initiated.
- Campaign-private sticker IDs: union count A=3, B=0, crosscampaign overlap=0. Names and contents were not read into output.
- Creator manager list: A GM had 0 owned packs; B GM had 2. B creator pack was absent from A's manager list; owner's detail GET returned 200; foreign GM's detail GET returned exact 404. No PATCH or publish was attempted because it could mutate if unexpectedly allowed.
- ACL status nuance: current official contract intentionally conceals foreign creator rows with 404, not 403. `global-sticker-catalog.ts` applies creator ownership in the query predicate and returns not-found when no owned row matches. This runtime proves owner-list omission and foreign detail concealment; it does **not** claim a runtime mutation-denial result. No product change was made.
- Actual chat sends, same-campaign receivers: A GM → A PLAYER selected one item from the 24-pack; B PLAYER → B GM selected one item from the 115-pack. Both actual POSTs returned 201. The same server message ID appeared at sender and receiver without reload; both endpoints rendered/decoded the actual media and its authenticated content route returned 200.
- Across four browser contexts, 180 global content responses were observed, all 200; this includes picker/history lazy requests beyond the two selected sends. No all-139 scroll was requested. 10 mutations were observed (login, sends, and normal read actions), 0 unexpected mutations; 0 page errors.
- Relevant source hashes from the successful receipt:
  - `apps/web/src/StickerPicker.tsx`: `a89b30c7a3edb89514294879aeb9d880c201a202af20065c06a7455d67b3c30f`
  - `apps/web/src/use-chat-actions.ts`: `86589aa50e7ab95c73923a01f8a519c5d39e07b947bda95573a8d8f03686923d`
  - `apps/web/src/sidebar/ChatPanels.tsx`: `796d5ddecaaab177640c35cd9a27a7957187b8d561ba8b392582db8d404f08ff`
  - `apps/server/src/global-sticker-catalog.ts`: `1e815bc118ed061747c0a57a1a213ed0ba5f0c97c844ed4f9aa9bff50a8ecaec`
  - `apps/server/src/routes.ts`: `44117f61bc3324b32f044e4f5a3dc931756abdb43d94c97e44978373f29b4285`

## Failure history / evidence boundaries

- First harness attempt stopped before authentication/catalog because Vite was unavailable; immutable receipt `.data/qa-prep/uix497-crosscampaign-runtime-20261008181259699-0ff858a0-a634-4b27-802e-47f4730dff83.json` (SHA-256 `4BB3998FF075D595A9F23004D84581B5ACC7AD23EAF95CAB12007B114FFAFEE4`). No API/DB startup attempted; Vite was subsequently started only after root authorization.
- Second attempt passed auth/catalog then failed at role-level private-pack-list equality. Role views can legitimately differ (A GM list empty, B GM list 2); comparison was corrected to campaign-wide private-ID overlap, with no product-data change. Immutable receipt `.data/qa-prep/uix497-crosscampaign-runtime-20261008181621464-9e8a31f1-1b70-4f82-83f5-c3497899d37a.json` (SHA-256 `F4292E948F571BD9D41C039980705C7EB8BFA4FAB7DA57033776DDB8C1884F8B`). A transient diagnostic emitted only owner-list counts; a test assertion's diff included private pack UUIDs in tool output, but no credentials, names, alt text, bootstrap, or chat content. The harness now redacts UUIDs and reports aggregate evidence only.
- Stale-auth path: if official A/B login returns non-200 in a future run, record the redacted failure and stop; no token extraction/workaround.
- Existing global catalog packs and scene data were not modified. No production, remote server, deploy, push, merge, or full E2E.

## Next action / blockers

- Root reviews this checkpoint and the successful receipt. Keep UIX-497/UIX-649 open until their remaining criteria are reconciled; this focused run does not establish production readiness or broad security acceptance.
- Remaining ACL evidence is read-only concealment (404) and owner-list separation; mutation denial was not probed to avoid risking real catalog rows. Native/user acceptance and other release gates remain separate.
