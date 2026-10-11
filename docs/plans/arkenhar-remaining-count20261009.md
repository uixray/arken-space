# Arken Space: exact live remaining count — 2026-10-09

## Count from live Linear

Read the current `arken-space` project (`P-UIX-30`, UIXRay) with paginated issue listing on 2026-10-09. Result: **272 total issues**: 193 Completed, 1 Canceled, 1 Duplicate, and **77 nonterminal, nonduplicate issues**. Current actionable statuses: **56 Backlog + 13 In Progress + 8 In Review = 77**. If “nonterminal” includes the Duplicate state, it is 78; duplicates are excluded from work count.

The 2026-10-09 full backlog audit index mapped 76 open IDs: 7 QA/current-integration, 34 product, and 35 implementation reports, with zero missing/unexpected/duplicate IDs against its then-live inventory. All 76 remain nonterminal today. **UIX-677 is the only added, unaudited open issue**, Backlog: a full Windows installer / non-developer self-hosted first-run package. Its AC includes clean Windows install, master setup, campaign/scene creation, LAN second-device play, restart/update, backup/restore, safe uninstall, signing/SmartScreen and explicit connectivity/auth policy.

Therefore: 77 is the exact current Linear issue count, **not** a count of remaining product changes or acceptance criteria. The exact remaining AC count is unknown; issues include parent/child overlap, deferred features, delivered code with review gates, human acceptance and owner/external decisions. Do not interpret 77 or the historical 76 audit as “77 features still missing” or “76 done.”

## What changed since the 76-item audit

The three audit reports use source baseline `888910b92a847e484170c570fc06ad7247c71580`. Git history since then records real implementation pools including the UIX-264 item quantity/condition editor, four-track client mixer, guide gallery, account lifecycle and scoped GM/PLAYER link access, encrypted transactional mail queue/drain, plus candidate hardening. Linear statuses were intentionally not closed by source presence. The issue-by-issue audit is consequently a useful historical map, not a current live acceptance recount.

Current candidate checkpoint identifies frozen product SHA `2c35435643e09a4dbbcb041889dbc727070536f0`, exact local image pair and synthetic F/R/TLS verification. The later U media archive test proves only synthetic archive mechanics. No production deployment or provider mail has been tested. The working tree now has pending `apps/server/package.json`/`pnpm-lock.yaml` edits for Nodemailer, plus other uncommitted artifacts; the candidate checkpoint is not proof for these new bytes.

## Actual unresolved work — do not collapse into a single “code remaining” number

- **Product implementation / incomplete AC (exact count unknown):** some of UIX-347 remains a prototype pending integration and authoritative persistence/security/reconnect acceptance; UIX-264's bounded ITEM quantity/condition editor is only a slice of the broader instance manager; UIX-245/263 world encyclopedia/import scope and UIX-657/525/677 first-run/self-hosted campaign setup remain broader product work. Other Linear Backlog work spans R&D, economy/progression, social/gameplay, mobile, sound, content and portfolio; not all are approved current release work.
- **Code present, review/evidence still open:** many In Progress/In Review tasks are not zero-implementation tasks. Examples in the current checkpoint include UIX-382 client mixer (device/autoplay/live acceptance distinct from source), UIX-644 residual native/zoom and historical RO issue, UIX-672/674 broad manual comment coverage, and UIX-316 physical-device/mobile acceptance. UIX-217 GM+6 is explicitly post-test-publication, not a prerequisite to start publication.
- **Owner/policy decisions:** campaign-creation entitlement/caps and storage policy; installer Windows/support/signing/update policy; paused broad theme/identity work; unresolved product/content/rights decisions. The owner has now approved Nodemailer and open signup with mandatory email verification; do not list those as pending decisions or impose invite-only signup. The SMTP adapter/shared bootstrap/routes integration is an active `/music_mixer` pool under review. Provider credentials/sender-domain setup, real external SMTP acceptance and production activation remain separate gates. Synthetic fake-mail delivery does not settle them.
- **External/real-environment evidence:** trusted production-host identity and actual feedback queue for UIX-318/473; current paired production database+media backup and safe old-binary rollback; deployment authorization and available server/cloud capacity; actual SMTP/provider; real human/device/game acceptance. The local production-data inventory found no proven complete current Yandex DB+media pair on this workstation. Do not infer production loss from QA-only missing-media counts.

These are topic examples, not a mutually exclusive count of issues or all AC. A new full issue-by-issue actualization would be required before making an exact denominator for unresolved criteria.

## Current stage and next action

Latest accepted release evidence is local and synthetic. Exact candidate build/runtime/recovery evidence does not equal deployment readiness. Open signup/Nodemailer integration is actively being implemented; other next work depends on the listed campaign-policy decisions/access and separate real-environment gates. Do not rerun accepted tests, rebuild/reimplement already-landed slices, or mark tasks Done by inference. Root owns any stage-gate Linear update. This inventory made no Linear writes or closures.

## Sources inspected

- Live Linear `arken-space` project listing (2 pages) and UIX-677 issue description; no fields/comments changed.
- `docs/plans/arkenhar-backlog-audit-index20261009.md` and exclusive QA/product/implementation reports.
- `docs/plans/arkenhar-goal-checkpoint20261009.md` (latest candidate/F-R-TLS/U appendices), `arkenhar-candidate-build-checkpoint20261009.md`, `arkenhar-candidate-evidence-review20261009.md`.
- Git history through HEAD at inspection `1644be807abbacad3e4c05a2cc54cb5fd5c9ef2b`; current worktree status checked. No source was modified.

## Evidence refresh — 2026-10-09, documentation HEAD 4cb0041

This appendix supersedes stale candidate/download/password statements above; it does not recalculate the live Linear count or close any issue.

- Nodemailer/shared bootstrap is committed in exact product candidate `4dca5a19d3b6b7ca17464825b893dfc276185462`, not uncommitted or still awaiting implementation. Exact server/web builds and archive SHA/size acceptance are recorded in the package checkpoint. The actual-image SMTP/bootstrap finite gate is running; provider/inbox acceptance remains unproved.
- Yandex Restic download completed: 701 files, 272271426 bytes, 174 snapshot objects. Owner unlocked and restored selected production snapshot `0b1b0140`, capture `2026-10-06T10:03:48.737168028Z`. Read-only dump checksum and all 151 paired media checksum entries passed. Therefore production backup is no longer merely unknown/unlocated; DB semantic restore/migration/replay and executable rollback remain pending. Later production writes are not guaranteed.
- Local software staging now contains accepted server/web/PostgreSQL image archives, identities and SHA/size receipts, plus nine-member positive list. Package review identified gateway/SMTP-egress/activation-override/restore-sequencing gaps; Luna executes a bounded Astra plan. Staging is not yet ready for authorized transfer.
- Existing 77 nonterminal issue count is the earlier live inventory, not a newly refreshed count or 77 missing functions. Full remaining AC denominator still unknown. Product/policy/human gates above remain distinct; no completed feature should be rebuilt from this historical audit.

Next connected gate: consume current SMTP, production-derived recovery and package-config receipts; record precise open operational requirements. No remote start, deploy, upload, push or merge authorized.
