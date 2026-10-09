# Arken Space product backlog actualization — 2026-10-09

## Scope and rules

Read-only audit of the 34 owner-assigned Linear issues listed below. Live Linear was fetched on 2026-10-09; 271 issues were paged from the `arken-space` project, 77 were non-completed/non-canceled, and the 34-item exclusive scope was matched against that inventory. Duplicate/canceled/done issues are not treated as open work. No Linear field/comment was changed. Source review used the current checkout at `888910b92a847e484170c570fc06ad7247c71580`, its working tree, committed checkpoints, and linked local planning/evidence files. The checkout has simultaneous unstaged product/stamp changes, so code claims are limited to exact inspected files and evidence; no release-wide inference is made.

Status terms below: **implemented / gate-open** means code/artifact exists but acceptance is not proven; **partial** means only identified criteria are met; **missing / decision** means no implementation or owner choice was evidenced; **separate product** means not a prerequisite for core Arken beta. A task being open is not itself a publication blocker.

## Current high-level decisions

- The core public product/first-run umbrella (UIX-653 and children) remains backlog planning. The existing beta shell is not public self-service registration, campaign creation, or onboarding. Public auth has explicitly been deferred; this does not authorize an alternative secret-link access model.
- The short test-publication gate differs from full post-publication GM+6 rehearsal (UIX-217). UIX-217 must not be used to hold an otherwise approved short prepublication gate; the full session is still future work after a separately authorized test publication.
- Full mobile scope is not approved wholesale. The mobile discovery document `docs/plans/uix-316-mobile-discovery.md` records approval limited to responsive foundation P1; P2–P6 (UIX-625–629) remain Backlog and are not authorization to implement. Browser viewport checks are not physical-device acceptance.
- UIX-317 explicitly records the main design-system implementation and exact-candidate CI as completed in the past, while broader issue remains In Progress and follow-on work is paused by the owner. Do not relaunch its remaining backlog without renewed direction.
- UIX-473’s report-to-issue map is historical/Linear-only. It does not show that the real feedback queue was read, acknowledged, linked, or resolved.
- No production deployment, remote access, production data mutation, or protected personal content publication is authorized by this audit.

## Open-issue inventory and actualization

### Public product, first-run, research, identity and portfolio

| Linear | Live status | Actual state / evidence | Unproved acceptance / next boundary |
|---|---|---|---|
| UIX-653 | Backlog | Product-case umbrella with research, positioning, flows and measurement children; no evidence that its entire case has started. | Product story, validated outcomes and publishable evidence remain future work. Not a runtime gate by itself. |
| UIX-654 | Backlog | Competitor research task. No current research artifact verified in this checkout. | Current comparison, sources and strategic conclusion are absent/unverified. Research only when product direction is approved. |
| UIX-655 | Backlog | User research/hypothesis test task. No interview/usability dataset verified. | No claims about user needs or validated hypotheses; obtain sessions/consent before portfolio claims. |
| UIX-656 | Backlog | Positioning, product principles and public scope require owner-level product decision. | Do not infer final audience, public access model or roadmap from UI copy. |
| UIX-657 | Backlog | Scope asks public product page, account/access, “My campaigns,” campaign create, GM onboarding, invite and operational setup. Current `apps/web/src/AuthGate.tsx` contains the beta landing/invitation/login flow, not a self-service campaign workspace. | Registration/public auth explicitly deferred; campaign management and end-to-end newcomer path are missing. Track as strategic product work, not proof that beta campaign cannot run. |
| UIX-526 | Backlog | Onboarding first-entry task. `apps/web/src/LandingGuide.tsx`/`landing-guide-content.ts` give pre-login feature/shortcut information; UIX-652 partial adds section anchors/search. | This is help content, not guided campaign setup, scene creation, invitation, or first-play path. Remaining first-use criteria are open. |
| UIX-652 | Backlog | UIX-415 base guide already exists. Current uncommitted guide slice adds table of contents, stable anchors, direct-hash reveal/focus/history, search and reset; describes real key behavior. `tests/e2e/uix652-guide.spec.ts`, `LandingGuide.test.tsx`, `landing-guide-content.test.ts`; 14 focused unit tests and one mocked Chromium gate pass. Checkpoint `docs/plans/uix652-help20261009.md`. | Screenshots and comprehensive coverage of all product capabilities / structured FAQ were not produced. This slice does not close parent request. |
| UIX-506 | Backlog | Current identity issue remains distinct from implementation font work. Commit `8d37735` supplies Pragmatica Next variable font and controls; this is not evidence of three approved icon directions, favicon/identity decision, or complete Cyrillic wordmark work. | Owner selection of identity/wordmark and the AC set need explicit design evidence; no Figma/Eagle work was performed. |
| UIX-658 | Backlog | UX audit/critical-flow improvement task. Existing scoped control and mobile viewport checks are not a full audit of campaign creation, GM session, invite, recovery, navigation and mobile. | No comprehensive prioritized findings + all required P0/P1 fixes + residual rationale artifact verified. |
| UIX-659 | Backlog | Design-system portfolio child. Existing `apps/web/src/design-system/` and generated tokens/themes are implementation evidence, not a finished presentation/case. | Design rationale, code/design mapping, before/after and publishable story not shown. Depends on research/positioning. |
| UIX-660 | Backlog | Calls for 5–8 actual usability sessions, metrics, iteration and retest. Automated mocked browser QA is not user testing. | No human session results or before/after impact verified. Explicit consent/recruiting gate needed. |
| UIX-661 | Backlog | Portfolio case task explicitly calls for research, interviews, positioning, alternatives, first-run, before/after and measured effect. No complete case artifact verified in scope. | Publication/portfolio acceptance remains unperformed; depends on evidence and permissions. This is not beta runtime functionality. |
| UIX-665 | Backlog | Immersive 3D registration concept based on external reference. No implementation verified. | Creative/technical scope and owner approval required; registration itself is deferred. Optional future differentiator, not baseline beta blocker. |

### Monitoring, feedback operations and post-publication gate

| Linear | Live status | Actual state / evidence | Unproved acceptance / next boundary |
|---|---|---|---|
| UIX-411 | In Progress | Issue says `/healthz` exists; external monitoring/alerting is the task, not the endpoint. No live service/host check was attempted in this audit. Local scheduled backup mentioned in the issue is not external monitoring. | External monitor/notification and owner’s explicit RPO decision (accept daily or add pre-session backup) remain unverified. Operational risk; separate from product UI completion. |
| UIX-217 | Backlog | Live issue description says GM+6 full rehearsal is post-test-publication. Shortened test-publication criteria are changed critical flows, GM/PLAYER entry, preservation, fresh backup and rollback. | Full rehearsal remains not performed. Not an implicit prepublication gate; run only after explicit publication authorization. |
| UIX-318 | In Review | Staff inbox/list/detail/redaction/access controls have bounded local implementation and mocked privacy/operator regression per checkpoint (`operator-feedback.test.ts`, `OperatorFeedbackWorkspace.tsx`, server routes; 32 unit + 8 mocked-browser noted in current project checkpoint). | Host trust recovery, actual authorized production read/queue verification, and deployment remain unpassed. Do not expose host identifiers or query live reports as part of this audit. Review state is not full AC closure. |
| UIX-473 | Backlog | `docs/plans/uix473-existing-issue-map20261009.md` maps historical report themes to existing UIX-491–496/467; many mapped implementation issues are Done, and UIX-347 is ongoing. | The source issue’s old “9 NEW” snapshot is not current queue evidence. Actual report IDs/statuses and acknowledgment transitions were not read or changed; issue remains operationally unresolved/blocked on trusted operator access. No duplicate product issue needed based on the read-only map. |

### Sticker packs / content deployment boundaries

| Linear | Live status | Actual state / evidence | Unproved acceptance / next boundary |
|---|---|---|---|
| UIX-497 | In Review | Current owner correction: 24 PNG and no individual sticker names; GM pack-manager create/bulk upload/restore/publish has tested local UI; 24-pack import and PLAYER→GM exact-message delivery happened only in an isolated synthetic QA campaign. See `docs/plans/uix497-*20261008.md` and Linear current description. | Real target campaign/production was not updated. Any campaign content publish requires its own explicit permission/release gate. Historical 27-WebP text is superseded. |
| UIX-649 | In Review | Current owner source: 115 transparent 512×512 PNG with unique hashes; local pack flow, GM publish, compact/desktop PLAYER send and cross-session exact-message delivery are documented in live issue. | Production/real campaign publication remains separate; don’t conflate this content iteration with core publication. Historical count/derived experiments are superseded. |

### Themes and mobile

| Linear | Live status | Actual state / evidence | Unproved acceptance / next boundary |
|---|---|---|---|
| UIX-317 | In Progress | Issue explicitly says main implementation was checked in PR #85 with exact-candidate CI, but broad parent remains open and owner paused follow-on work. Current source includes themes/design system; commit `8d37735` is local font/control work, not a reopened full-317 delivery. | Remaining broad criteria remain paused; do not start a next pool absent owner direction. |
| UIX-316 | In Review | Discovery/plan exists at `docs/plans/uix-316-mobile-discovery.md`; approval is limited to P1 responsive foundation. P2–P6 child tasks remain Backlog. | Full player/GM phone/tablet behavior and physical-device acceptance are not proven by compact/desktop browser tests. |
| UIX-625 | Backlog | PLAYER journey child: journal, rolls, character, requests/attachments; planned only. | No connected full player session on physical devices. |
| UIX-626 | Backlog | Shared touch pan/pinch/token control child; planned only. | No touch adapter/gesture gate established by this audit. |
| UIX-627 | Backlog | Touch Draw/Fog/Ruler child; planned only. | No touch workflows/physical acceptance established. |
| UIX-628 | Backlog | Limited GM/tablet scope child; planned only. | No owner-approved GM touch surface or tablet split gate verified. |
| UIX-629 | Backlog | Physical-device/network/accessibility/performance evidence child; planned only. | No iOS Safari/Android Chrome physical evidence or device/network budgets verified. |

### Campaign ownership and surrounding products/content

| Linear | Live status | Actual state / evidence | Unproved acceptance / next boundary |
|---|---|---|---|
| UIX-525 | Backlog | The issue documents current singleton beta campaign/GM token constraints. `apps/web/src/AuthGate.tsx` and contracts’ beta player model remain a beta access flow, not a public multi-tenant campaign manager. | Self-serve isolated campaign creation is missing. This is central to future public SaaS/product shell but not required to operate the current private beta. |
| UIX-527 | Backlog | Fixed beta roster is still an issue. `packages/contracts/src/beta-players.ts` is the authoritative code path noted in issue; no editable per-campaign roster system is evidenced here. | Runtime roster management across campaigns remains missing; membership/privacy handling needs product architecture, not a copy edit. |
| UIX-664 | Backlog | Separate ARKPATH product/scope issue; current Arken Space source/build checkpoint does not deliver standalone multi-campaign ARKPATH. | Independent product plan/build, not core VTT publication blocker. No separate checkout was inspected. |
| UIX-647 | In Progress | Separate protected campaign/content project. Its historical test release is recorded at commit `ca643f42e62f93263dd155c1b9732c24901044b5`, with a test release and source/browser checks. This is campaign-specific, not generic VTT onboarding. | Issue describes additional content/human validation and non-published newer local work. Do not infer current production content or deploy this branch from its historical test release. |
| UIX-263 | Backlog | World-content import/reconciliation remains a provenance/review-first task for Tilda/Framer/Eagle content; no import artifact or source review was done. | Separate content pipeline; requires explicit source scope and review; Eagle is out of bounds here. Not core service runtime blocker. |
| UIX-364 | In Progress | Repository contains static player-page infrastructure (`infra/static/players/`, `build-player-pages.mjs`, page JS/CSS/data) and 10 static page directories. This proves page-generation/content machinery exists, not that current individualized pages meet consent/content goals. | Personal content/media/rights/human acceptance is unverified. No names, handles, or private content are reproduced in this report. |
| UIX-572 | In Progress | Separate dispatch-game product issue. No source implementation audit of another product checkout was made; it must not be reported as an Arken Space VTT capability. | Separate design/product task, independent from Arken beta readiness. |
| UIX-378 | Backlog | Separate WebAR book-cover experience for `arken-khar.space`; no WebAR implementation inspected in this checkout. | Separate site/content/physical-device feature; not core VTT release blocker. |

## Audited IDs (exact scope)

`UIX-652, UIX-318, UIX-473, UIX-649, UIX-497, UIX-657, UIX-411, UIX-217, UIX-317, UIX-665, UIX-664, UIX-647, UIX-661, UIX-660, UIX-659, UIX-658, UIX-653, UIX-656, UIX-655, UIX-654, UIX-526, UIX-506, UIX-364, UIX-625, UIX-316, UIX-629, UIX-628, UIX-627, UIX-626, UIX-263, UIX-525, UIX-527, UIX-572, UIX-378`.

## Gate implications / next actions

1. Keep the public-auth/campaign-manager decision at its existing owner boundary; do not build registration as a byproduct of this actualization.
2. Root to integrate this source-of-truth map and the existing stage-gate evidence. Update Linear only at the relevant stage gate, not during this audit.
3. UIX-473/318 require trusted-host and approved operator access to real data; do not substitute historical mapping or mock tests for queue disposition.
4. UIX-497/649 are content iterations with isolated QA evidence only; do not publish content to a live campaign without a separate explicit GO.
5. UIX-317 follow-on remains paused. Mobile P2–P6, ARKPATH, WebAR, player personalization, research, usability and portfolio are discrete workstreams; they do not automatically block the shortened beta publication gate.

## Audit checkpoint

- **Decision:** distinguish shipped code, limited local acceptance, missing product work, owner decisions and separate-product work; do not turn all open tasks into a release blocker.
- **Revision:** inspected checkout `888910b92a847e484170c570fc06ad7247c71580` with simultaneous dirty product/stamp work; not a clean candidate. UIX-317 font/control commit referenced: `8d37735`; UIX-647 historical test release SHA referenced from its current Linear issue: `ca643f42e62f93263dd155c1b9732c24901044b5`.
- **Files changed:** only this audit and one stale UIX-652 checkpoint sentence (`docs/plans/uix652-help20261009.md`). No source/Linear changes.
- **Verification:** live Linear project inventory paginated (271 total, 77 open-ish) and exact 34 assigned IDs fetched/read; inspected code, status docs, and UIX-473 mapping. No external integrations beyond Linear; no live production/system access.
- **Open:** public registration/product shell, comprehensive landing/FAQ, human usability, physical mobile, external monitoring/RPO, real feedback queue/trusted host, content publication, wider themes/design acceptance, research/portfolio and separate-product outcomes remain separate as above.
- **Next:** root consolidates evidence; user decides order/scope for the still-unstarted product/research/campaign work.
