# Production recovery Astra review — 2026-10-09

## Disposition

Accept the supplied checkpoint as **bounded local production-derived migration + fresh export replay evidence**. No concrete blocker to that limited acceptance found. This is not independent re-execution, full row-equivalence audit, usable legacy-link/runtime acceptance, deployment readiness or old-binary rollback. Read only tracked safe checkpoint and immutable Git SQL/journal metadata; private directory filenames inventoried, no dump/row/token-hash/env/resource/log contents opened.

## Identity correction independently checked

Actual reported migration image is `sha256:be8464f516e027f24424f4f7c0a16fdfe7c7278eea714c64395ee221365257ff`, candidate `4dca5a19d3b6b7ca17464825b893dfc276185462`, tree `c4a3112e3a821d92a4304882a371641dfe792ff1`. Do not relabel that image2c35435. Reviewer compared immutable Git entries: both revisions have54 Drizzle SQL files, identical paths/blob IDs; `_journal.json` blob also identical. This strengthens the SQL/ordering equivalence explanation only, never full application equivalence or transfer of runtime PASS across revisions.

## Why bounded migration/replay scope is supported

Executor checkpoint reports baseline55/55 counts and45/45 ledger prefix, migration-only CLI twice, post-migration65/65 table coverage with55 existing counts unchanged and10 new tables empty,54/54 final ledger,140 FKs +65 CHECKs validated. Fresh M export replay into third PG17 database independently matches counts/ledger/constraint aggregates. Thus the receipt is more than successful command exit or dump existence. Original155 files rehashed unchanged; all151 media/storage references match, with zero missing/unsafe/duplicate/orphan/size/hash mismatch, repeated on replay.

Eleven explicit HMAC comparison sets cover credential/grant/invite/session/membership and important ownership/media references while keeping values/key private. Ephemeral key is not retained: these are executor attestation of same-run equality, not independently reproducible keyed fingerprints. Counts and these bounded HMAC sets do not prove every field of every table unchanged. The checkpoint does not claim that, and no broad re-audit is required for its stated gate. Validated constraint metadata is not a substitute for every possible domain invariant; runtime scene/account/link semantics stay outside this acceptance.

Account safety is explicit: preexisting membership.user_id remains NULL, newly introduced account tables empty, all115 historical sessions retain NULL provenance. No inferred ownership, signup or mail send occurred. Retained credential/grant revisions and revocation state are preserved rather than silently rotated.

## Remaining holds, not reasons to repeat migration

- Real GM/PLAYER re-entry is blocked on owner-provided valid bearer links through approved private input. Preserved hashes cannot recover URLs; mismatching local GM token must not be substituted. NULL-provenance old sessions do not automatically authenticate.
- Actual candidate process/account/link/media/browser checks and private key/config continuity require separately authorized runtime evidence. Synthetic SMTP capacity evidence cannot close production-derived user access.
- Fresh replay is not old-binary rollback. Compatible pre-upgrade software/config/data tuple and safe old runtime remain separately gated; rollback loses later writes.
- October6 snapshot capture/pairing originates from owner/backup receipts; unchanged files/checksums verify local integrity, not proof no newer usable snapshot exists.
- Private exports/checksums/resources stay outside software archive/Git. Do not print personal rows, token hashes, env values or private logs to make the safe receipt more verbose. Original snapshot remains untouched.

## Checkpoint

Only this review document changed; no tests/SQL/Docker/runtime, private payload access or source modifications. Next action: root references accepted bounded migration/replay in package manifest while retaining production-derived runtime-access and operational rollback holds. No repeated migration/full54/65 matrix requested.
