# Owner-invoked service snapshot (`/opt/arken-space`)

This is separate from the scheduled `backup.sh`: it creates one encrypted Restic snapshot and never runs `forget`, `prune`, or deletion. It is **not** a claim that a new target or production snapshot exists. Run only after the owner has approved the target, Restic repository, available space, and a brief API interruption.

## Capture

1. Provide `RESTIC_REPOSITORY` and the Restic credential through the operator's protected environment mechanism (never a command argument or terminal output). Ensure the repository is encrypted and initialized. Set `ARKEN_RUNTIME_ENV_FILE` to the private Compose interpolation env file; its server service must resolve to exactly one `env_file` containing actual runtime secrets. The script asks Compose for interpolated config with `--no-env-resolution`, preserving the env-file reference while avoiding an in-memory merge of its values, then captures that referenced file into a mode-0700 temporary directory sent to Restic and removes the directory. The resulting Restic repository contains runtime secrets/config and must be handled as confidential encrypted backup data.
2. Review the deployment config and ensure the app is running with `server`, `postgres`, and (if present) `web` compose service names. Verify the compose project is the intended `/opt/arken-space` target. The database-count query can be overridden with `ARKEN_DATABASE_COUNTS_SQL`. Add host gateway/TLS/deployment files through `ARKEN_CAPTURE_CONFIG_FILES` as newline-separated absolute paths if they are not already within the captured package; the script will reject missing files and duplicate basenames.
3. Invoke with the explicit quiesce interlock, e.g. `ARKEN_CAPTURE_QUIESCE_CONFIRM=stop-and-restart-arken-server infra/backup/capture-service-snapshot.sh`. The script queries the package-configured `PORT` (default 4100) for health metadata, then stops only the API server, captures database/media/config/images, PostgreSQL version and ordered migration ledger, and safe revision/schema metadata, and restarts the API container it stopped, including on ordinary errors/signals. It does not stop PostgreSQL, change deployment config, or alter data.
4. Preserve the resulting private receipt. It contains snapshot ID, image IDs, schema/build revision, and manifest digest, not runtime environment values. Verify the receipt against the encrypted repository before considering recovery complete.

The API is unavailable during capture. Do not run during migrations, uploads, media replacement, deployment, or another backup/restore. If the server fails to restart, operator intervention is required. Do not use this against a live system until host-specific compose path, service names, volume mapping, and required free space have been reviewed. A successful Restic write is not a restore rehearsal.

## Restore and local copy

Restore only through the existing isolated restore rehearsal flow; never restore onto the active service or use `down -v`. First obtain the matching private receipt and encrypted snapshot, select its exact snapshot ID, inspect the manifest from a protected temporary extraction, and validate database migrations, counts, image IDs, and media hashes in an isolated target. Keep runtime env/config encrypted and private throughout. A local encrypted snapshot-copy operation is a separate owner action; use the repository's approved local-copy launcher when available and verify its output repository independently. Do not put the private snapshot or runtime config in a public software ZIP.

## Evidence boundary

Fake-command tests validate argument ordering, private staging, cleanup, and that no retention/deletion command is used. They do not prove host connectivity, snapshot creation, confidentiality of a misconfigured Restic repository, consistency under unrelated writers, or restore readiness. No snapshot is created by tests.
