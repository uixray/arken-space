# ArkenHar: next pools from the completed audit — 2026-10-09

## Decision and evidence boundary

Plan only, not an implementation start. Root must finish the current UIX-347 frontend acknowledgement-race repair and connected gate first. Starting HEAD inspected: `19ec77c3cd10ba5a0f71c665c5d7c71e57ee9f39`; backend `f450a64`, audit index `35b5613`. Frontend stamp files and checkpoint are dirty/in flight; preserve them. The abandoned `map-ping-motion.ts` is excluded from every deliverable.

The completed inventory is **76 actualized open tasks, not 76 release blockers or 76 completed tasks**. The three audit reports are the classification baseline; this plan does not restart their source exploration. Live issue descriptions were read for UIX-264, UIX-382, UIX-457, UIX-652 (and UIX-314 as a screened alternative). Narrow source confirmation covered the existing GM-only instance routes and static fog pattern only. No tests ran for this plan, no Linear update occurred, and no current source was certified.

There are **two immediately specifiable delivery slices and one finite candidate-evidence pool**, not three whole features ready for unconditional delivery. None closes its broad parent issue automatically. In particular, backend code does not settle every product policy. The nearest-publication order below is not an assertion that help or instances must precede a separately authorized short test publication.

## Ordered recommendation

| Order | Pool | Why now / true scope | Planning effort range |
|---|---|---|---|
| 1 | Finish frozen candidate evidence after current 347 gate | Missing current-revision evidence; avoids widening release scope while source changes. No new feature. | 1–3 focused work hours if gate passes; defects trigger a new scoped estimate, not unlimited retries. |
| 2 | UIX-264 GM campaign-instance editor, existing-contract subset | Genuine missing user-facing workflow over existing routes; highest-value executable non-auth feature slice. Does not invent player discovery, inventory rules or canon lifecycle. | 6–12 focused work hours including connected tests/review; excludes broader 264 AC. |
| 3 | UIX-652 safe screenshot integration and capability/role map | Genuine missing acceptance after delivered search/anchors; smaller additive work, lower product priority than gameplay. No authored FAQ or marketing copy. | 3–6 focused work hours; owner copy review and any later help-center decision excluded. |

These are rough planning ranges, not promises, deadlines, or permission to batch-execute. Use one connected implementation/verification pool at a time. Root owns integration and stage-gate updates; Luna owns the bounded files assigned below. If publication is chosen after pool 1, pools 2–3 remain post-publication development rather than silently becoming blockers. If development continues, pool 1's candidate evidence becomes historical after the next product commit and a fresh final candidate is required.

## Pool 1 — current-candidate verification, not more implementation

**Remaining acceptance:** audit QA report and checkpoint say current stamp frontend has unresolved final acknowledgement-race integration and no final frozen candidate. Prior full typecheck/build receipts preceded the final repair; existing archive build crossed concurrent source changes. They cannot be renamed current-candidate proof.

**Prerequisite:** root has integrated and committed the actual stamp repair, reviewed help/stamp results, and declared product source frozen. No source edits from this planning task or new backlog feature while root finishes.

**Bounded output:** record exact HEAD plus tracked/untracked product boundary; run one connected typecheck/build and changed-critical-flow gate selected by root; retain artifact manifest/hashes and source identity. Use ordinary local synthetic fixtures only. Distinguish unit, disposable server integration, mocked-browser and real transport evidence. If reconnect is only modeled by fixture replay, explicitly leave real transport reconnect open. Do not replay the exhausted retired P/S helper or assert native/device/GM+6 acceptance.

**Ownership:** Luna owns a dedicated candidate receipt/manifest and test execution logs; root owns source freeze, test selection, defect decisions, final checkpoint and Linear. No product modifications unless root separately assigns a proved defect. Failure stops the gate with exact trace/repro; it does not expand test allowance automatically.

**Prompt for Luna:**
> Wait for root's exact frozen SHA and finite gate list. You are not alone; preserve all other edits and never stage the abandoned ping helper or `.tmp`. Own only the new candidate evidence receipt/manifests. Capture source identity before and after the connected commands; if identity changes, label the receipt non-candidate. Run the selected existing local tests/build once, retain failures and artifacts, and distinguish mocked UI from actual transport. Do not repair product code, run the retired P/S harness, access credentials/retained databases, change auth, or access remote/deployment tooling. Return exact SHA, commands/results, hashes, blockers and next action; do not declare publication or full issue acceptance.

## Pool 2 — UIX-264: GM instances without inventing rules

### Exact current issue acceptance vs this slice

Live UIX-264 asks for canonical create/edit/version/archive/relations; aliases/type/tags/public and GM text/media; cross-campaign canonical references; instance overrides (name/state/GM notes/portrait/token/owner/location); multiple independent instances; item quantity/owner/container/condition; map/scene links; CAS/idempotency/audit; safe used-entity deletion; player-safe projection; browser create/edit/link/archive verification.

**Already present, do not rebuild:** canonical `WorldContentWorkspace.tsx`; `worldContentInstances` DB model; contracts; `apps/server/src/world-content-instances.ts` CRUD; campaign/CAS integration tests. Current routes explicitly require GM, derive the campaign from auth, and expose no player projection. They already hold displayNameOverride/currentState/gmNotes/portraitAssetId/ownerMembershipId/currentLocationId/quantity/condition/discovered/revision. This is not evidence that all lifecycle, media or player-publication policy is approved.

**Deliver now:** an actual GM-only list and create/edit form for multiple independent instances of an existing canonical entity in the current campaign. First field surface: display-name override, current-state text and GM notes. Provide canonical reference/identity, revision conflict recovery that retains unsaved input, empty/loading/error states and persisted reload. Preserve untouched fields in existing records. UI must use existing action IDs/CAS exactly; no new schema or silent overwrite. Basic UI labels/errors are factual, not generated lore or rewritten owner text.

**Deliberately excluded:** exposing `discovered`; player projection; cross-campaign navigation; item container/economy/game-balance logic; new media/token/owner/location selectors; delete/archive policy changes. Do not expose a control merely because a DTO has a field. Existing canonical archive and related workflows remain as-is. These exclusions mean **partial UIX-264 delivery**, not issue completion. Later field/link slices need an explicit field matrix and validated reference/media constraints.

**Connected acceptance:** GM creates two instances of the same canon, edits one, reloads, and observes the other and canon unchanged; stale revision shows conflict without losing draft; retry does not duplicate; switching campaign never shows previous campaign state; PLAYER never receives GM form/data. Use existing server tests plus browser fixtures/disposable integration, not production. Check error/access behavior without modifying authentication policy. If existing routes cannot safely support this exact slice, report the concrete blocker instead of widening rights.

**Ownership:** Luna: new `WorldContentInstancesWorkspace.tsx` and local styles/helpers/tests, narrow integration in `WorldContentWorkspace.tsx`, dedicated browser spec and checkpoint. Root: any shared navigation/App integration and stage gate. Server/contracts/DB remain read-only; ask root for a separately scoped defect fix if needed. Start only after stamp source is frozen.

**Prompt for Luna:**
> Implement the bounded GM instance list/create/edit slice above using existing campaign-scoped routes/contracts. You are not alone; do not revert others' changes. Own only the new instance workspace/helpers/tests and narrow WorldContentWorkspace integration; coordinate any shared file with root. Preserve canon and owner copy. Expose only canonical reference, display-name override, state and GM notes; keep other stored fields unchanged. No discovered/player visibility, new ACL/auth, delete/archive, item economy, lore generation, new uploads or migrations. Test two independent instances, canon unchanged, reload, CAS conflicts with draft retention, retry and role/campaign isolation in one connected gate. Return exact changed files/revision, results, exclusions and remaining full-264 AC; do not close 264.

## Pool 3 — UIX-652: screenshots, not another guide rewrite

**Current issue acceptance:** role-aware pre-login explanation of all available feature groups; current privacy-safe annotated screenshots; correct contextual shortcuts; step-by-step instructions; explicit landing-versus-help-center decision; no experimental/unavailable features advertised; responsive keyboard-accessible optimized images; clear login and verified paths; one material source and update rule.

**Already delivered:** base UIX-415 guide plus `19ec77c` search/TOC/anchors/history/focus and malformed-hash/filtered-target repairs (root 16 unit + 1 mocked Chromium, scoped historical receipt). Do not reimplement those controls or WASD.

**Deliver now:** a capability/role-to-existing-guide coverage map and small screenshot set for already documented stable paths (map tools, character, chat/rolls, GM preparation). Capture actual current UI with synthetic, neutral fixtures using already authorized/bundled media only; no personal campaigns, source private assets, authored lore or generated creative content. Integrate optimized responsive images under existing sections with existing labels and factual accessibility text. Do not fabricate explanations or publishable FAQ prose. Missing instructions/questions go into a review list for the owner. Record source SHA, viewport, fixture and refresh rule for each screenshot.

**Connected acceptance:** no secrets/real identities/hidden campaign material in images; no unavailable combat/direct-chat/auth-registration functions advertised; image dimensions/lazy loading/size recorded; keyboard/compact layout/login remain reachable. Source/bundled fixture provenance must be explicit; if permission for a visual is uncertain, omit it rather than invent rights. Full screenshots/all-features coverage and authored instructions still require owner review. A separate help-center architecture remains a decision, not an automatic redesign.

**Ownership:** Luna: screenshot fixtures/spec, dedicated public help image folder, narrow LandingGuide image placement/local styles and coverage manifest. No unrelated AuthGate/App/shared stylesheet changes. Root reviews privacy, source identity and placement; owner owns prose and final content approval.

**Prompt for Luna:**
> Continue only the missing screenshot/coverage slice of UIX-652 after current source freeze. You are not alone; preserve delivered guide text, anchors/search and others' files. Produce a role/capability map against current guide and actual screenshots from neutral synthetic fixtures with known authorized local assets, then integrate optimized images into existing relevant sections. No new FAQ/marketing/lore copy, creative generation, real campaign data or unapproved asset access. Use existing factual labels and minimal alt text. Own screenshot spec/assets/manifest and narrow LandingGuide placement only. Verify privacy, image payload, keyboard/compact layout and login access in one connected browser gate; report residual content decisions without claiming whole-652 closure.

## Screened alternatives and exact decision gates

### UIX-382 — real missing mixer, but not an unconditional start

Audit: multi-track DB/realtime/migration and tests already exist; no web runtime `audioTracks` consumer. Exact live AC: concurrent authorized tracks, independent GM mix/local-only player master, join/reload/reconnect without duplicate playback, safe element disposal, preserved single-track migration, GM/player/reconnect/two-track tests, and **performance limits/autoplay-consent specified before implementation**. Live questions still ask independent transport versus active-set-only and maximum tracks.

Do not treat existing four-track independent-transport backend tests as owner approval. Root may first find a recorded approval; otherwise ask one concrete decision: adopt existing independent transport with maximum four tracks and preserve current explicit mute/autoplay retry/local consent, or choose a different contract? Confirm the bounded performance/fallback policy before client work. No hidden/unexposed mixer core as a substitute for that decision. After approval, a bounded Luna client-pool can own MusicBar/playback adapter/tests with one audio element per track, stable reconciliation and local master; preserve UIX-492 no-restart-on-volume and UIX-669 consent. Rough approved-scope estimate: 8–16 focused hours, excluding real-device acceptance. This remains separate from pool 1 publication readiness.

### UIX-457 — contract is not the feature or asset permission

Audit: resolver contract/test exists (skill → school → player); no persistence, mutation/settings UI or roll-action integration. Exact AC: player chooses available frame and sees it on own rolls; GM assigns skill frame visible to all; tested precedence; no original megabyte images loaded per message. Live description explicitly requires deciding campaign assets versus builtin set and membership-level preference. Source directory mention does not grant asset rights or authorize import. Need owner asset-model/approved-set/derivative decision and agreed presentation behavior with existing critical frames before implementation. Do not generate frames or modify author assets. After those decisions, plan authoritative selection/history references, safe derived media, picker and roll integration; do not estimate this as a small UI-only task. Preliminary 12–24 focused hours after approved scope, not a commitment.

### Other work not silently promoted

UIX-314 genuinely lacks animated fog, but its low-priority procedural prototype/art approval and opacity/performance gate would add renderer scope; not selected over finishing a candidate. UIX-508 already has AnimatedPing; UIX-405 movement, UIX-495 notes and UIX-496 skill picker already exist. Their residuals are not invitations to recreate features. Mobile P2–P6, paused themes, game-balance decisions, public auth, privacy decisions, external operations and separate products retain their audited boundaries.

## Compact checkpoint

- **Decision:** candidate evidence first; then actual 264 UI subset; then 652 screenshots/coverage. Only these bounded slices are immediately specifiable. 382/457 wait for explicit unresolved decisions, not auth.
- **Revision:** inspected HEAD `19ec77c`; stamp frontend dirty/in flight. No candidate claim.
- **Changed files:** only this plan. No code, Linear, tests, author copy, assets or memory changes.
- **Verification:** reconciled all three audit reports/index/checkpoint; live read of named issue AC; narrow instance-route/static-fog confirmation; no runtime commands/tests.
- **Blockers:** root current 347 gate; future mixer policy, frame asset/rights/model choices; full264 and full652 acceptance beyond selected subset; native/live/manual/remote gates remain separate.
- **Next:** root finishes current pool, integrates its checkpoint, and chooses publication gate or next delivery. No remote access, push/merge/deploy, authentication activation, Figma/Eagle, or broad creative generation authorized here.
