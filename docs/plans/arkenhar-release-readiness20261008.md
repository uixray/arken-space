# ArkenHar release readiness checkpoint — 2026-10-08

## Snapshot and source boundary

- Checkout: `D:\AI\personal\experiments\arken-space\.worktrees\uix-293-catalog-20261007`, branch `codex/uix-293-catalog-20261007`, current HEAD `bbc52b1` (handoff commit); global-public catalog implementation is committed at `3ed0f51`, migration `0047`.
- Existing source dirt is intentionally preserved: `apps/web/src/GlobalStickerPackManager.tsx` and `.test.tsx` contain the in-progress Escape ownership fix; `.tmp/` is unrelated/untracked. Neither is frozen or verified. Do not absorb these into this readiness note or claim them tested.
- `docs/plans/arkenhar-publication-preparation20261008.md` is now stale where it says platform-wide catalog/audience is not implemented. `3ed0f51` added global catalog endpoints/access, schema conversion/migration, and message/media resolution; `docs/plans/arkenhar-handoff20261008.md` and latest Linear state supersede that conclusion. Its production-boundary findings remain valid: local synthetic evidence is not production publication, the release script does not package ignored media or import DB rows, and production import/rollback/target-baseline gates remain separate.

## Current evidence and blockers (do not promote across SHAs)

- Global feature: commit `3ed0f51`; accepted pre-dirty-fix focused evidence is backend integration `16/16`, web `67/67`, narrow typecheck repair `7/7`. Evidence is for that source revision, not the dirty current candidate. Global packs 24 and 115 were locally imported additively; old 141 media IDs/SHA matched the saved baseline, idempotent verification made zero writes. Local DB migration wrapper returned exit 1 despite the 0047 journal/FK/check/table checks being committed; this anomaly and absence of restore rehearsal remain release-readiness issues.
- Latest local send evidence: immutable receipt `928889CEADB0E4D55AC2C72AEFD0492BB6215FA81396D3E8582358184496E27A`; two distinct packs/messages delivered in authorized synthetic campaign B, with message persistence, WS receipt, decoded image/content checks. This is B-only proof, not cross-campaign isolation or production visibility. Historical burst produced 31 actual 429 responses; later ordinary scroll had 278/278 content 200 and zero broken visible assets. The burst is not waived.
- UIX-497/UIX-649 remain In Review: cross-campaign proof, human acceptance, burst/rate-limit decision, and actual production publication are open. UIX-318 remains In Review pending independently verified trusted host. UIX-473 remains Backlog pending authorized live report IDs/statuses. UIX-644 remains In Progress; inventory is 50 buckets/92 occurrences, current inventory check 8/8, and two manager rows are runtime-blocked. PlayerRequests only partial (4 GM + 4 PLAYER); owned-character fixture is still zero.
- Gameplay/UIX-644 local gaps: actual scene selection flow; true browser zoom (not viewport/device emulation); causal ResizeObserver failure reproduction and verification; complete overlay/registry acceptance; native OS popup/keyboard human acceptance. Historical failures remain evidence and are not cleared by non-reproduction.
- Product readiness: normal full authorization is explicitly deferred until other preparation is complete. Do not implement auth now or substitute secret-link access. Handoff says public registration/MyCampaigns/public create API are absent; therefore weekend public landing/registration is not release-ready. Do not start/access the stopped remote server, import production data, deploy, push, or merge without separate explicit authorization and a completed gate.

## Feasible next local pool (recommended after Escape pool freeze)

Bound one connected UIX-644 browser pool to GM actual scene selection + actual browser zoom + causal ResizeObserver replay, using the already running authorized local runtime only. No fixture mutation/reseed; no source change unless a reproduced, isolated defect and bounded owner-approved implementation scope result.

1. Read the exact current coverage notes and source paths: `docs/plans/arkenhar-handoff20261008.md`, `docs/plans/uix-644-runtime-coverage.json`, `docs/plans/uix-644-playerrequests-runtime20261008.md`, then inspect `apps/web/src/ScenePicker.tsx` and the actual zoom controls/ResizeObserver owner identified by the historical failing trace. Do not reread broad history.
2. In one connected browser matrix, select a different real scene as GM and verify selected scene identity, canvas/state transition and no unintended publish; test real browser zoom levels with viewport held constant (record browser/OS, zoom %, viewport and resulting layout); replay the original ResizeObserver causal sequence on the authorized local target and capture observer callback/error/stack plus resulting control state. Keep compact coverage only where the same state/interaction applies.
3. If the original ResizeObserver failure cannot be reproduced, report NONREPRO with exact attempts; do not label causal fix/pass. If reproduced, stop before editing and send the narrow trace/owner proposal for approval. Record all browser cells and retained historical failures at the exact candidate SHA.
4. Stop at local evidence. No full E2E, broad registry sweep, remote/server start, auth, publication/import, or deploy.

## Release gate boundary / next decision

Before any production request, separately resolve: current production target identity/trust and authorization; exact candidate commit/ancestry and fresh build/browser evidence; safe handling/package of ignored `media/`, `docs/stickers/`, `.data/` sources; additive target inventory/quota and resumable idempotent import plan; tested backup/restore and data-preserving rollback; migration wrapper exit-1 anomaly; cross-campaign two-user checks; burst-429 policy; human acceptance; and the explicit deployment gate. `infra/deploy/release.sh`'s unconfirmed path is not a no-write dry run: its checklist entails checkout/backup/restore rehearsal. No source-SHA evidence above establishes those gates.

## Checkpoint

- Decisions: retain global-public model; auth later; B-only evidence is not A/B; no remote/deploy/push/merge; Linear updates only at stage gates.
- Changed files: this new checkpoint only.
- Verification: reconciled stale publication note against handoff, `3ed0f51` history/stat, current `bbc52b1`, active-pool evidence and narrow scene-control source. No tests or browser work run.
- Blockers: dirty Escape pool not yet verified; UIX-644 local runtime/human gaps; cross-campaign/production/release gates above.
- Next action: after Escape pool freezes, run the bounded actual-scene/true-zoom/causal-ResizeObserver local pool; preserve exact SHA and NONREPRO distinction.
