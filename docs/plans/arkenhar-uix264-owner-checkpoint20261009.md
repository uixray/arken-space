# UIX-264 owner slice — 2026-10-09

## Decisions / revision
Isolated product base b6e1e39cb312195c2d097cb20625ca2fd448c1f5; owner subset only, not whole manager acceptance. Current campaign snapshot members supply choices; all existing roles allowed. Nullable owner set/change/clear remains instance-only. Server rejects unknown or foreign membership before mutation/audit. Omitted PATCH retains owner. Existing CAS/action retry semantics retained. Unknown snapshot owner is labelled participant unavailable, not unassigned.

## Owned files
apps/server/src/world-content-instances.ts; apps/server/src/world-content-instances.integration.test.ts; apps/web/src/Sidebar.tsx; apps/web/src/WorldContentWorkspace.tsx; apps/web/src/WorldContentInstancesPanel.tsx; apps/web/src/WorldContentInstancesPanel.test.tsx; apps/web/src/world-content-instances-client.ts; tests/e2e/uix264-instance-manager.spec.ts; this checkpoint. Concurrent fog/spell files excluded.

## Verification
Worker connected focused route/panel Vitest 31/31 PASS (single worker, hookTimeout120000). Actual installed Chrome via Playwright1.62.1 channel chrome: mocked API UI flow390/1280 and PLAYER exclusion3/3 PASS. Node24.15.0, Chrome executable C:/Program Files/Google/Chrome/Application/chrome.exe. Not live DB persistence/concurrency. Root reviewed server guard, null/omitted/retry reconciliation, member plumbing and focused tests; diff check clean.

## Open gate / next
Full typecheck reports Fastify multipart augmentation and unrelated e2e errors; build shell could not resolve tsup .bin. These are unpassed gates, not accepted PASS or proven baseline. Use installed direct tool entry to classify/fix dependency resolution without install; compare exact affected compilation before integration. Containers/portrait/location/full manager and live persistence acceptance remain open. No release integration, merge, push or deployment. Preserve concurrent work.
