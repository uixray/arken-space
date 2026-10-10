# Owner-invoked service snapshot (`/opt/arken-space`)

This is separate from the scheduled `backup.sh`: it creates one encrypted Restic snapshot and never runs `forget`, `prune`, or deletion. It is **not** a claim that a new target or production snapshot exists. Run only after the owner has approved the target, Restic repository, available space, and a brief API interruption.

## Capture

1. Provide `RESTIC_REPOSITORY` and the Restic credential through the operator's protected environment mechanism (never a command argument or terminal output). Ensure the repository is encrypted and initialized. Set `ARKEN_RUNTIME_ENV_FILE` to the private Compose interpolation env file; its server service must resolve to exactly one `env_file` containing actual runtime secrets. The script asks Compose for interpolated config with `--no-env-resolution`, preserving the env-file reference while avoiding an in-memory merge of its values, then captures that referenced file into a mode-0700 temporary directory sent to Restic and removes the directory. The resulting Restic repository contains runtime secrets/config and must be handled as confidential encrypted backup data.
2. In default `compose` mode, review the deployment config and ensure the app is running with `server`, `postgres`, and (if present) `web` compose service names. Verify the compose project is the intended `/opt/arken-space` target. The database-count query can be overridden with `ARKEN_DATABASE_COUNTS_SQL`. Add host gateway/TLS/deployment files through `ARKEN_CAPTURE_CONFIG_FILES` as newline-separated absolute paths if they are not already within the captured package; the script rejects missing/symlinked files and duplicate basenames before quiescing.
3. Invoke with the explicit quiesce interlock, e.g. `ARKEN_CAPTURE_QUIESCE_CONFIRM=stop-and-restart-arken-server infra/backup/capture-service-snapshot.sh`. The script queries the package-configured `PORT` (default 4100) for health metadata, then stops only the API server, captures database/media/config/images, PostgreSQL version and ordered migration ledger, and safe revision/schema metadata, and restarts the API container it stopped, including on ordinary errors/signals. It does not stop PostgreSQL, change deployment config, or alter data.
4. Preserve the resulting private receipt. It contains snapshot ID, image IDs, schema/build revision, and manifest digest, not runtime environment values. Verify the receipt against the encrypted repository before considering recovery complete.

The API is unavailable during capture. Do not run during migrations, uploads, media replacement, deployment, or another backup/restore. If the server fails to restart, operator intervention is required. Do not use this against a live system until host-specific compose path, service names, volume mapping, and required free space have been reviewed. A successful Restic write is not a restore rehearsal.

## Cloned local-review target mode

`ARKEN_CAPTURE_MODE=cloned-review` is a separate, explicit path for a Docker-cloned review stack that is not represented by the production Compose file. It does **not** infer container selection from names. Before allowing the quiesce interlock to stop anything, the operator must inject the exact inspected API, PostgreSQL, web, and edge container IDs; all four exact image IDs; the shared application network ID; any additional edge network IDs as an exact comma-separated allowlist; the actual media host bind source and container path; the actual edge config bind source and container path; the private API runtime-env file; and the expected database hostname from that runtime. The mode checks all four running IDs/images, API/PG/web network membership, the exact edge network set, bind sources/destinations, and that the API `DATABASE_URL` hostname resolves to the selected PostgreSQL container alias. It parses the actual database name from that URL; it does not use the PG container's default database name. The supplied runtime-env URL must match that host/database pair without emitting credentials.

All sources must exist, be regular/non-symlink inputs, and be validated before stopping the API. Only the selected API container is stopped and restarted; PostgreSQL, web, edge, networks, and mounts are never changed. The capture stages the actual database dump, count manifest, PostgreSQL version, ordered migration ledger, mounted media, runtime env and edge config privately, and archives all four exact images before creating a `arken-service-snapshot-v1` manifest. The manifest is meaningful only inside the encrypted Restic repository. Keep image/context files and runtime config confidential. The copy of a media tree does not prove that all DB references resolve; restoration must do that separately.

Required identity input names are `ARKEN_REVIEW_API_CONTAINER_ID`, `ARKEN_REVIEW_PG_CONTAINER_ID`, `ARKEN_REVIEW_WEB_CONTAINER_ID`, `ARKEN_REVIEW_EDGE_CONTAINER_ID`, the corresponding `ARKEN_REVIEW_*_IMAGE_ID` values, `ARKEN_REVIEW_NETWORK_ID`, `ARKEN_REVIEW_EDGE_EXTRA_NETWORK_IDS`, `ARKEN_REVIEW_MEDIA_SOURCE`, `ARKEN_REVIEW_MEDIA_CONTAINER_PATH`, `ARKEN_REVIEW_EDGE_CONFIG_SOURCE`, `ARKEN_REVIEW_EDGE_CONFIG_CONTAINER_PATH`, `ARKEN_REVIEW_RUNTIME_ENV_FILE`, and `ARKEN_REVIEW_EXPECTED_DATABASE_HOST`. Values must be collected from read-only identity inspection and supplied privately; do not save populated commands or values in shell history. This mode remains owner-interlocked and fake-command tests are not proof it works against a real review stack.

## Restore and local copy

Restore only through the existing isolated restore rehearsal flow; never restore onto the active service or use `down -v`. First obtain the matching private receipt and encrypted snapshot, select its exact snapshot ID, inspect the manifest from a protected temporary extraction, and validate database migrations, counts, image IDs, and media hashes in an isolated target. Keep runtime env/config encrypted and private throughout. A local encrypted snapshot-copy operation is a separate owner action; use the repository's approved local-copy launcher when available and verify its output repository independently. Do not put the private snapshot or runtime config in a public software ZIP.

## Evidence boundary

Fake-command tests validate Compose and explicitly selected cloned-review paths, mismatch-before-stop, API-only restart on injected failure, four-image/config staging, secret-output guards, and that no retention/deletion command is used. They do not prove host connectivity, snapshot creation, confidentiality of a misconfigured Restic repository, consistency under unrelated writers, or restore readiness. No snapshot is created by tests.

## Compose and independent-copy recovery contract

Both `compose` and `cloned-review` produce the same complete four-service
manifest: exact server/PostgreSQL/web/edge immutable image IDs, all four image
archives, inspected database name, shared network, media bind target and edge
configuration. Compose capture refuses an incomplete service tuple before API
quiescence; it does not emit a partial snapshot as recovery-ready.

For a local Restic copy, `SNAPSHOT_ID` is the **copied** 64-character ID.
Keep the original protected capture receipt, and additionally set
`RESTORE_COPY_RECEIPT_PATH` and `RESTORE_COPY_RECEIPT_SHA256` to the protected
`arken-restic-copy-receipt-v1` mapping receipt produced by
`copy-snapshot-local.ps1`. The original capture ID must equal the mapping's
`sourceSnapshotId`; the requested local ID must equal `copiedSnapshotId`.
Both receipts are digest-pinned and checked privately before restore. No origin
repository is opened during recovery; the local repository remains the only
Restic source. The report records both IDs and both receipt digests.

Synthetic contract tests are not a real encrypted-copy/restore rehearsal.
Actual capture, offline image load, database/media verification and rollback
remain required before a release recovery gate can pass.
