# ArkenHar publication preparation boundary — 2026-10-08

Read-only preparation audit for UIX-497, UIX-649, UIX-318, and UIX-473.
This is not a production access, start, import, or deploy authorization.

## Current evidence

- Owner policy: both final sticker packs should be available to everyone,
  without campaign-specific scope. UIX-497 and UIX-649 remain In Review;
  their current Linear text says local QA only and real production publication
  is a separate explicitly approved gate.
- Local content evidence: the final 115-PNG manifest/import receipt records
  115 items and persisted Russian alt/provenance; the 24-PNG receipt records
  24 source SHA matches before/after, persisted original provenance, and
  preservation of prior QA pack IDs. The joint QA verifier reports the 139
  original source files unchanged and existing sticker/media IDs retained.
  These receipts are isolated synthetic-campaign evidence, not production
  visibility or live-target inventory evidence.
- The source PNGs and manifests are not part of the release checkout:
  `media/`, `docs/stickers/`, and `.data/` are ignored by Git. The release
  script deploys an exact Git revision; it does not package these local source
  files or import sticker database rows.

## Blocking scope mismatch: “everyone” is not implemented

- `packages/db/src/schema.ts:1459-1472`: every sticker pack has a required
  `campaign_id` foreign key.
- `apps/server/src/routes.ts:5500-5548,5906-5915`: create stamps the
  authenticated campaign ID, and player listing filters to that same campaign.
- `apps/server/src/sticker-access.ts:17-27,121-149`: access resolution is
  campaign/member based; `CAMPAIGN` means members of that campaign, not all
  Arken Space users.
- `apps/web/src/StickerPackManager.tsx:575-597`: manager choices are
  “Только мастер” or “Все участники кампании” for visibility and sending.
  `ALL_MEMBERS` likewise means members in the authenticated campaign.
- Therefore the local QA setting `audience: CAMPAIGN, sendPolicy: ALL_MEMBERS`
  does not satisfy the owner's platform-wide policy. A shared/global pack
  catalog and its authorization, send, media-resolution, and migration model
  need an explicit product/engineering design and implementation first. Do not
  silently reinterpret “everyone” as one campaign or copy packs into an
  invented set of campaigns.

## Required before any publication/deployment request

1. Resolve and implement a global-public pack model (or obtain a direct owner
   scope change to a named campaign). Specify who can view/send across campaigns
   and how existing message/media references resolve.
2. Prepare one locked publication manifest for the 24 and 115 packs: exact
   ordered source files, SHA-256, alt text, pack metadata, provenance/license
   wording, and intended audience/send policy. Keep visible sticker names
   neutral; do not copy QA-only provenance notes into production metadata.
3. Define an idempotent, resumable import keyed by source SHA and target pack,
   with a dry-run, partial-failure checkpoint, duplicate refusal, and expected
   pack/sticker/media counts. Existing QA import scripts are hard-coded to
   `127.0.0.1` and campaign-scoped; do not repurpose them for production.
4. At an explicitly authorized target gate, capture the existing target
   inventory and media/hash baseline; verify target storage/quota. Require
   additive-only changes and prove old pack/sticker/media IDs remain intact.
5. Specify rollback before import. Current lifecycle supports DRAFT→ACTIVE,
   ACTIVE→DEPRECATED, and DRAFT/DEPRECATED→ARCHIVED; archive is not a data
   rollback and removes content availability for old messages. Define a
   tested hide/deprecate/recovery plan that preserves existing chat history.
6. Validate visibility and sendability with separate users across distinct
   campaigns if “everyone” is platform-wide; the existing QA proof is only
   within one synthetic campaign. Verify exact message/content URL delivery,
   realtime receipt, and decoded image without changing unrelated packs.

## Independent operational dependencies

- **UIX-318 operator trust:** local issue-link and security gates are complete,
  but current production host identity has not been independently verified.
  Do not change SSH trust or treat historical recovery notes as current proof.
- **UIX-473 triage:** owner authorized the nine-report review; the saved map is
  a topic-to-existing-issue plan, not live IDs/statuses. Read and update actual
  reports only after separately authorized access; verify ID/date/content,
  avoid duplicate issues, and resolve only with evidence. This is not a reason
  by itself to start the production server.
- **Release mechanics:** `infra/deploy/release.sh` requires an exact 40-character
  revision in `origin/main`, a clean production checkout, environment/TLS and
  backup checks, a fresh restic backup, and an isolated restore rehearsal.
  Its unconfirmed pass still checks out the target revision and creates a real
  backup/rehearsal; it is not a no-write dry run. Confirmed deploy additionally
  needs the non-live media smoke gate and explicit deploy invocation. Image
  rollback does not undo imported database/media content.

## Gate decision

Do not request server startup yet: the requested global audience cannot be
achieved by the current campaign-scoped feature, and the source package,
idempotent import, target baseline, and data rollback plan are not production
ready. Reassess startup only after those local decisions/artifacts exist and a
specific deployment-preparation action is defined. Startup is not permission
to import, change operator statuses, or deploy; each remains its own gate.

No production/SSH access, server startup, data import, release, push, merge, or
Linear change was performed for this audit.
