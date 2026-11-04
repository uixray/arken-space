# Linear outbound adapter: implementation contract

Status: researched, not activated or runtime-verified. Existing adapter seam and
claimed-file reader are local only. No API key requested or used.

## Verified API distinctions

- GraphQL HTTP 200 may include errors and partial data. Parse both; never equate
  HTTP success with completed delivery. Preserve a returned issue UUID even when
  the overall operation fails.
- fileUpload negotiates a signed PUT URL, required headers and durable asset URL.
  PUT must send those headers and verified bytes; check HTTP status explicitly.
- attachmentCreate links a resource; it does NOT itself upload local file bytes.
  Its URL+issue identity is idempotent, unlike a blind repeated issueCreate.

## Required connected implementation

1. Add durable per-delivery upload receipts keyed by selected file ID/hash. Store
   final asset URL and completion state, not token-bearing signed upload URLs.
   Current outbox payload alone does not retain successful intermediate uploads.
2. Read selected bytes through readClaimedBugAttachment, sequentially, bounded.
   Negotiate upload using fixed api.linear.app endpoint. PUT only to explicitly
   configured trusted HTTPS storage hosts; no redirects, credentials/userinfo,
   private IP targets or copied Linear Authorization header. Do not guess host
   allowlist from URL suffixes; establish it before activation.
3. Persist each completed upload receipt before creating/updating the issue.
   Ambiguous uploads stop for reconciliation; no automatic deletion of orphans.
4. Deliver only reviewed text plus links for explicitly selected files. Preserve
   the existing mapped issue; do not overwrite later human edits without a
   separately defined reconciliation policy. No silent raw-source append.
5. Record partial known issue identity on any later failure. SENT requires all
   selected files linked plus text delivery, not merely issueCreate success.
6. Recovery retries only a known receipt write. Unknown creation requires explicit
   inspection, never a new create. A crash cannot be declared terminal by age.

## Remaining policy / activation decisions

Historical import/access scope, bot ownership, storage/retention budget and
reconciliation of source edits against human-edited Linear content remain open.
Albums still fail closed pending grouped consent. No tests or API probes authorized.

## Primary references consulted

- https://linear.app/developers/graphql
- https://linear.app/developers/how-to-upload-a-file-to-linear
- https://linear.app/developers/attachments

## Owner decision: existing issue edits

Confirmed in chat: append a new comment to the existing mapped Linear issue. Never replace human-edited title/description. appendBugRevisionComment implements the dormant mutation, using delivery UUID as stable comment identity for explicit recovery, without automatic retry. Full sender wiring still pending.

## Implemented source checkpoint (supersedes implementation TODOs above)

Migration0076 and recordBugUploadReceipt retain completed uploads; bugUploadsComplete gates SENT. sendBugToLinearOnce connects claim, sequential uploads, durable receipts, creation/comment and outcome. ENQUEUE is operator-audited; history API/UI exposes status without private payload. All dormant and unverified. Recovery, albums, activation and runtime acceptance remain open.
