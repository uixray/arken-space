# Production release checklist

This checklist prepares and verifies a release. It is not evidence that backup,
restore, deployment, or the human GM + 6 rehearsal has passed.

## Release identity

Use one reviewed, committed revision for every gate:

```sh
export EXPECTED_BUILD_REVISION="$(git rev-parse HEAD)"
test -z "$(git status --porcelain --untracked-files=normal)"
test "$(printf %s "$EXPECTED_BUILD_REVISION" | wc -c)" -eq 40
```

The production `.env` must be mode `600`, must not be committed, and must set:

- `APP_VERSION`, `POSTGRES_PASSWORD`, `GM_ACCESS_TOKEN`;
- `WEB_ORIGIN=https://arken.uixray.tech` and
  `PUBLIC_URL=https://arken.uixray.tech`;
- absolute persistent `MEDIA_HOST_PATH` outside the checkout;
- media quota, free-disk reserve, image and audio limits.

Restic and S3 credentials belong only in root-owned `/etc/arken-space` files,
never in the application `.env` or GitHub.

## Mandatory pre-deploy gates

1. Confirm DNS resolves to the intended host and the existing certificate covers
   `arken.uixray.tech`. Validate nginx with `sudo nginx -t`.
2. Install `restic`; load `/etc/arken-space/restic.env`; run `restic check`.
3. Create a fresh backup with `infra/backup/backup.sh`. Record the exact snapshot
   ID emitted by that invocation. Do not use `latest` as release evidence.
4. Rehearse that exact snapshot in the isolated `arken-restore-*` environment:

   ```sh
   export ARKEN_RESTORE_CONFIRM=isolated-clean-target
   export RESTORE_BUILD_REVISION="$EXPECTED_BUILD_REVISION"
   export SNAPSHOT_ID=<exact-snapshot-id>
   corepack pnpm restore:rehearse
   ```

5. Inspect `test-results/restore/runner.json`: overall result, dump/media
   checksums, table counts, schema `2`, exact build revision, cleanup,
   production health and disk checks must all pass.
6. Confirm at least 5 GiB free after the configured media reserve. Confirm
   `/srv/arken-space-data/media` and the Compose PostgreSQL volume
   are included in the backup/restore evidence.

## Deploy exact revision

Only after the gates above pass:

```sh
export EXPECTED_BUILD_REVISION=<reviewed-40-character-sha>
export VERIFIED_BACKUP_SNAPSHOT_ID=<exact-snapshot-id>
export RESTORE_REHEARSAL_REVISION="$EXPECTED_BUILD_REVISION"
export EXPECTED_SCHEMA_VERSION=2
sh infra/deploy/build-and-start.sh
```

The server applies migrations `0000` through `0008` before accepting traffic.
After startup, require all services healthy and verify:

```sh
curl -fsS https://arken.uixray.tech/healthz
sh infra/deploy/smoke-auth.sh
```

The health and authenticated diagnostics responses must report the exact release
revision and schema `2`. Verify WebSocket connection, one image upload, one audio
upload, and persistence across `docker compose restart postgres server web`.

## Rollback

Before deploy, record the previous commit/image identity and the fresh snapshot
ID. If startup, migration, health, authentication, realtime, or persistence
verification fails:

1. stop application writes and retain logs;
2. stop the failed stack;
3. check out the recorded previous revision and rebuild it with its exact
   `BUILD_REVISION`;
4. if migrations changed persisted data, restore the recorded exact snapshot
   using the isolated rehearsal procedure first, then the separately approved
   production recovery procedure;
5. verify health, schema, authentication, media and realtime before reopening.

Never run the gameplay-reset command as part of deployment or rollback. It is a
separate destructive operation requiring its own explicit approval.

## Remaining release evidence

- A local Docker GM + 6 pass does not replace the real 30–45 minute browser
  rehearsal.
- Publishing the public GitHub repository does not deploy production.
- Do not mark the release ready until the fresh backup and exact-snapshot restore
  rehearsal have actually passed on the operator environment.
