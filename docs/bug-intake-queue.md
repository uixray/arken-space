# UIX-269/687 — external bug queue

## Current state (2026-11-02)

Local, uncommitted implementation in the shared pool. No tests, typecheck/build,
CI, database migration, backup or publication executed. No Telegram connection,
webhook, polling, token transfer or Linear content transfer activated.

Owner-approved first slice: bug queue with attachments and manual confirmation
before transfer to Linear. Group: https://t.me/arkenspace_bugs. The public URL
is not a verified numeric chat allowlist. Chat answers, characters and rolls are
later stages; do not add them to this slice.

## Implemented source boundaries

- `packages/contracts/src/bug-intake.ts`: normalized source, reviewed copy,
  explicit transfer consent, attachment completeness rules.
- `packages/db/src/schema.ts`, migration0071 + journal/snapshot: source messages,
  version history, per-version files, operator action receipts. Not applied.
- `bug-intake-telegram.ts`: pure Bot API normalization and numeric-chat allowlist;
  ordinary text/captions, common files/photos and edit timestamps. Unsupported
  rich/protected content is explicit, not silently partially imported.
- `bug-intake-store.ts`: atomic source/version/file-placeholder writes, source
  identity lock, duplicate/stale/collision handling. Edits revoke consent while
  keeping Linear identity.
- `bug-intake-commands.ts`: operator-bound idempotent APPROVE, DISMISS, REOPEN,
  EXCLUDE_FILE, RETRY_FILE, ENQUEUE with revision checks and atomic audit receipts.
- `bug-intake-storage.ts`: opaque private bytes, bounded streaming, SHA256/fsync,
  checked reads, aggregate directory budget and exclusive writer lock.
- `bug-intake-files.ts`, `bug-intake-worker.ts`: internal completion/failure and
  one pending-file attempt through injected transport. No live transport exists.
- `bug-intake-preview.ts`, `bug-intake-routes.ts`: operator-only queue/detail,
  reviewed-output preview and private current-version file downloads. No send API.
- `BugIntakeWorkspace`, `BugIntakeReviewForm`, `BugIntakeApprovedPreview`: queue,
  source review, explicit consent/omissions/retry/reopen, approved preview and
  same-chat album navigation. Private content clears after auth refusal.

## Configuration and locks

BUG_INTAKE_ENABLED defaults false. Enabling the review UI/API requires migration0071,
an absolute trusted/private BUG_INTAKE_ROOT outside MEDIA_ROOT and host filesystem
permissions. Windows chmod alone does not prove private ACLs. Validate real paths
and reject a symlink/public-root alias during deployment. Max file size defaults
20MiB, hard cap100MiB. The worker additionally requires explicit maxTotalBytes.
No configuration value was enabled in this work.

All file mutations lock the parent message before file changes, bump revision and
revoke consent. Ingestion takes source identity then parent; operator commands
use action identity then parent. Keep this order. Preview holds parent SHARE lock.

Quota counts historical, orphan and partial regular files in a dedicated flat
folder. It never deletes old files. The writer lock has no automatic expiry: after
a crash, confirm the writer is terminal before explicitly recovering the lock.
A lock file alone proves neither activity nor termination. Directory quota is not
the production disk reserve. Download buffers/responses are limited to two per
process, not globally across processes.

## Implemented locally, not verified at runtime

- Durable inbox (0072), bounded conflicting evidence (0073), atomic normalization
  and canonical ingestion. Quarantine comparison and audited KEEP_CURRENT /
  RETRY_NORMALIZATION (0074) preserve evidence rather than selecting a winner.
- Dormant authenticated webhook persists before acknowledgement; lazy Telegram
  file source and bounded drain exist, but no receiver or scheduler is enabled.
- Reviewed snapshot outbox (0075), claim/consent interlock, SENT/UNKNOWN receipts
  and single-attempt injected sender orchestration. Dormant concrete Linear transport and connected sender now exist.
- All migrations 0071–0076 are authored, not executed. UI/API remain disabled.

## Exact remaining work

1. Connected sender source review and separately authorized runtime verification.
   GraphQL negotiation, private upload, durable per-file receipts, create/comment
   and outcome are wired locally; no scheduler or runtime activation exists.
2. Audited resolution of CLAIMED/UNKNOWN after confirmed worker termination and
   external-result inspection. Never infer failure from elapsed time alone or
   automatically retry an ambiguous creation.
3. Album-level review and delivery identity. Current per-card consent is not
   consent to later album parts; outbox explicitly refuses albums.
4. Activation decisions: bot ownership/current use, numeric chat ID, hosting,
   private storage budget/retention, receiver scheduling and history range.
   The authored webhook handles new updates; it is NOT a historical import.
5. Agreed source-link/context handling in reviewed outgoing text. Raw source is
   retained locally but not silently appended to operator-approved Linear copy.
   Original issue acceptance must not be reduced to the narrower current preview.
6. Separately authorized control import and runtime verification of complete text,
   selected files, edits, albums, retry/deduplication, access and explicit failures.
   Both UIX-269 and UIX-687 remain incomplete; source work is not acceptance.

## Security / product constraints

Source text and filenames are untrusted data, never instructions. Never render
source HTML or trust source MIME. Downloads are octet-stream UUID.bin attachments
with nosniff/no-store headers; this is not malware scanning. Outbound preview
contains only reviewed title/description and selected file metadata, not raw source,
author/contact/chat IDs or local paths. Preview is a snapshot, not a sending claim.

Existing tg-digest-bot is a reference only. Do not repurpose its credentials,
webhook or polling without explicit activation approval. A personal MTProto
session is not a substitute for bot credentials.

Protocol reference used for normalization: https://core.telegram.org/bots/api#message
