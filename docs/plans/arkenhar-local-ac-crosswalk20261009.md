# Local acceptance crosswalk — 2026-10-09

## Counting boundary

The live Linear inventory is **77 actionable nonterminal issues** (56 Backlog, 13 In Progress, 8 In Review). This is an issue count, not a feature/function count. The 76-item audit is a historical source audit, not 76 unimplemented items: it predates UIX-677 and subsequent committed implementation. Exact remaining acceptance-criterion count: **unknown**. Issue AC overlap, partial delivery, deferred work and evidence gates are not normalized into a complete criterion-level ledger.

This crosswalk relies on the existing QA/product/implementation audit reports, current goal/release checkpoints, named issue descriptions already retrieved, and Git history. It does not refresh Linear, inspect private fixtures, run tests, or close issues. “Implemented” below means source exists at the recorded scope; it is not a claim that the whole issue is accepted.

## Current local code/evidence pools

| Issue / scope | Present implementation or evidence | Actual remaining acceptance / classification |
|---|---|---|
| UIX-264 item instances | Commit `66334ff`: ITEM-only quantity (unset distinct from zero) and condition controls; 7 unit and 3 mocked 390/1280 Chromium cases were recorded for that slice. | **Implemented partial, broader AC remains:** full GM instance-manager requirements are not satisfied by those two fields; preserve other entity behavior and full manager scope. Do not count the slice as issue completion. |
| UIX-382 mixer | `63fa434` four-track client mixer; focused tests exist in its checkpoint. | **Implementation/evidence split:** device/autoplay behavior and live/realtime client acceptance remain distinct from source/unit evidence. Active work/review belongs to the current mixer pool; no duplicate implementation assignment. |
| UIX-347 collaborative canvas | Existing prototype/source and prior bounded work recorded. | **Implementation needed:** prototype is not fully integrated with authoritative persistence/security/reconnect behavior. Only promote concrete remaining assertions from its issue/checkpoint; no blanket prototype completion. |
| UIX-652 guide | `828263e` gallery/help delivery and prior scoped browser/navigation receipts. | **Partial evidence:** larger requested screenshot/scenario/content coverage is not established by the subset. Do not rerun accepted cases or claim all guide AC met. |
| UIX-657 account + campaign links | `2f31749`, `c93be7c`, `5a9766b`, `83b9261`, `9aefe6b` cover account lifecycle, explicit GM/PLAYER link provenance, encrypted queued mail, PG lock tests and browser lifecycle at their own revisions. | **New active implementation pool:** open registration with mandatory verification and Nodemailer are owner-approved; `/music_mixer` owns SMTP adapter and shared index/routes/bootstrap wiring, with Astra review active. Local end-to-end loopback SMTP signup gate is still required after source freeze. **Not proven:** production provider/sender credentials, external SMTP acceptance, inbox delivery, activation. No campaign auto-binding. |
| UIX-525 / self-hosted setup | Existing backend/candidate foundations and separate installer issue context. | **Implementation/decision/evidence needed:** first-run/self-hosted workflow remains broader than account lifecycle; Windows clean install, update, backup/restore and uninstall acceptance require an actual supported environment and selected scope. |
| UIX-677 Windows installer | Added open issue, not in the historical 76-item audit. | **Implementation and owner/environment gates:** complete installer/first-run acceptance is not evidenced by existing source/image candidate; signing/SmartScreen, supported Windows/LAN scenario and clean-device proof remain open. |
| UIX-644 native/zoom/causal behavior | Historical checkpoint records finite retry/stop and existing helper corrections. | **Evidence/decision gated:** residual native popup/true zoom and causal issue are explicitly not closed. Prior retry budget stop stands; no automatic rerun or scope expansion. |
| UIX-674 manual role/light/compact coverage | Prior checkpoint contains bounded regressions and explicit deferrals. | **Human/runtime evidence remains:** only named remaining comments/assertions are in scope; after-release deferrals stay deferred and are not pre-release omissions to implement. |
| UIX-316 physical/mobile acceptance | Existing implementation is not a device-level receipt. | **Human/device evidence:** physical mobile/device acceptance remains distinct from browser mocks and typechecks. |
| UIX-318 / UIX-473 trusted host and feedback queue | No trusted production-host or actual queue evidence in the local checkpoint. | **External/environment gate:** obtain approved host identity and verify the real feedback path; local source does not prove operational receipt. |

## Product work not reducible to current local source changes

The product audit identifies partial or missing scopes including UIX-245 encyclopedia/import, UIX-263 chronicles, UIX-314 animated fog, UIX-265 regional shops, UIX-379 achievements, UIX-430 area effects, UIX-429/459 progression, UIX-480 map labels, UIX-495 private NPC notes, UIX-496 player skill-add policy, UIX-461 marketplace/system, UIX-457 frame resolver consumers, UIX-508/509/510 map-ping/cursor/ruler R&D, and UIX-458 spell-school editor/assignment UI. These are **not all approved or dependency-free local work**:

- Some need product rules/privacy/economy/authorization decisions before implementation (for example UIX-430, 429/459, 588, 495/496, 461, 458).
- Some are foundations without the requested user-facing/transactional feature (for example UIX-457 contract-only, UIX-265 absent merchant transaction flow, UIX-379 no achievement lifecycle).
- Some are explicitly suspended/deferred, or their release priority is unselected (UIX-505 is suspended; UIX-674 has after-release deferrals; do not revive them unilaterally).
- Existing visual/source presence is partial, not the requested final behavior (for example UIX-314 static fog substrate vs animated cloud acceptance; UIX-508 existing ping animation vs requested motion/performance behavior).

The authoritative per-issue rationale is in `arkenhar-backlog-product-audit20261009.md` and `arkenhar-backlog-implemented-audit20261009.md`; this compact crosswalk intentionally does not repeat every historical issue row or invent new scope.

## Release/recovery/environment gates

- The exact-image and U receipts are synthetic/local. U proves paired synthetic database and media-archive mechanics only, not a current Yandex production backup. The local inventory did not find a proven complete production DB+media pair; unknown-provenance root media files are not evidence of a server backup.
- Full actual-media restore and safe old-binary rollback remain distinct from reconstructed synthetic media and forward-schema startup. Do not claim downgrade compatibility.
- The `2c35435` candidate predates Nodemailer/shared bootstrap changes and cannot cover the current pending bytes. A fresh exact-source candidate and its connected runtime gate are required after this implementation pool.
- Campaign creation entitlement/caps/storage policy remains separate and off; open signup approval does not imply campaign-creation permission.
- Provider account, sender domain, credentials/key operations, external SMTP/inbox acceptance, cloud/host access, production activation and deploy permission are not granted by local implementation approval.
- Human GM/player gameplay acceptance and any required physical-device testing remain separate gates.

## Current next action and nonclaims

1. `/music_mixer` completes the already-authorized SMTP/shared-bootstrap/routes pool; Astra reviews the frozen bytes.
2. Root runs the one connected local signup/queue/synthetic-SMTP integration gate against the resulting exact revision and decides any narrow repair.
3. Separately resolve campaign creation entitlement and real provider/environment gates; then prepare a new exact candidate only with the required release authorization.

No issue status was changed. No exact remaining AC total is asserted. This report is not a release-complete assessment, deployment authorization, external-delivery proof, or replacement for human acceptance.

## Evidence refresh — 2026-10-09, documentation HEAD 4cb0041

This appendix supersedes stale candidate/download/password statements above; it does not recalculate the live Linear count or close any issue.

- Nodemailer/shared bootstrap is committed in exact product candidate `4dca5a19d3b6b7ca17464825b893dfc276185462`, not uncommitted or still awaiting implementation. Exact server/web builds and archive SHA/size acceptance are recorded in the package checkpoint. The actual-image SMTP/bootstrap finite gate is running; provider/inbox acceptance remains unproved.
- Yandex Restic download completed: 701 files, 272271426 bytes, 174 snapshot objects. Owner unlocked and restored selected production snapshot `0b1b0140`, capture `2026-10-06T10:03:48.737168028Z`. Read-only dump checksum and all 151 paired media checksum entries passed. Therefore production backup is no longer merely unknown/unlocated; DB semantic restore/migration/replay and executable rollback remain pending. Later production writes are not guaranteed.
- Local software staging now contains accepted server/web/PostgreSQL image archives, identities and SHA/size receipts, plus nine-member positive list. Package review identified gateway/SMTP-egress/activation-override/restore-sequencing gaps; Luna executes a bounded Astra plan. Staging is not yet ready for authorized transfer.
- Existing 77 nonterminal issue count is the earlier live inventory, not a newly refreshed count or 77 missing functions. Full remaining AC denominator still unknown. Product/policy/human gates above remain distinct; no completed feature should be rebuilt from this historical audit.

Next connected gate: consume current SMTP, production-derived recovery and package-config receipts; record precise open operational requirements. No remote start, deploy, upload, push or merge authorized.
