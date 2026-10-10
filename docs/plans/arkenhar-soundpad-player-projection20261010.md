# PLAYER Soundpad asset projection fix — 2026-10-10
- Previous product revision e814f20; exact running web e814/server2a showed published shared sound in PLAYER soundpad but omitted eligible AUDIO from bootstrap; contentGET404 whileGM200.
- Added campaign-scoped sound/pack/asset joined readset query in existing Promise.all and eligible published ALL_MEMBERS audio projection into PLAYER snapshot. Draft/GM-only/cross-campaign/nonAudio/invalidduration excluded. GM asset projection unchanged. No schema/frontend/authguard changes.
- Files: apps/server/src/snapshot.ts, apps/server/src/snapshot-soundpad-assets.test.ts. Tests use pure production projection helper; actual loaded-query/runtime behavior requires next image gate.
- Root connected gate: 5files/16tests PASS (soundpad projection, character media/resource projection, soundpad routes/runtime); server tsc --noEmit exit0. Worker standalone3tests/typecheck alsoPASS. No fullE2E.
- Existing ZIP e814-retry1 remains superseded until newserver image and actual PLAYER media/trigger gate. Unchangedweb reuse requires exact contextproof.
- Next: freeze revision, build exactservercontext, integrate ownedC3runtime; verify actual PLAYER bootstrap eligibleasset/contentGET200 and one trigger delivered to GM+PLAYER plus hiddennegative guards. No audible/device/completeUIX512 claim.
- Original R2, pristine C1 dump/schema56/media151 remain immutable; C3 soundpadpack/assets are disposable QA, NOT transferdata. No deploy/push/merge.
