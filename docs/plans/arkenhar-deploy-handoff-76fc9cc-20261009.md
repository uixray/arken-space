# ArkenHar 76fc9cc — operational handoff

**Verdict: local candidate runtime checks PASS in the named isolated scope; production/deploy is NOT READY / NOT AUTHORIZED.** This is an operator handoff, not permission to connect, transfer, load remotely, start production, or change DNS. No remote command or deployment was run. No credential values were read or included.

## Exact candidate identity and immutable image artifacts

| Item | Proven value / receipt |
|---|---|
| Candidate commit | `76fc9cccaafe5dd6795fb4f7c33344990d39eed0` |
| Candidate tree | `9c3d53904ce32d90bb74615cc7d5218ce3dedf47` |
| Web image | `arken-qa-web:76fc9cc`; image ID/digest `sha256:e6749f37484461a3f9960f825805f95d542e9eddcfdd0e3a2d8aac9adad4e9f1` |
| Server image | `arken-qa-server:76fc9cc`; image ID/digest `sha256:f551e09e7ffaa31a7c5ecf05d45e2efdf166ff40d8e1ff9ea72c1796a57e9ec2` |
| Web image archive | `.data/qa-prep/local-image-readiness-76fc9cc-20261009/images/web-76fc9cc.docker.tar`, 25,027,072 bytes, SHA-256 `6583b4b689acfb5398c95da053ebffaa9ee35d91bd037b1ce7601fd1590f1260` |
| Server image archive | `.data/qa-prep/local-image-readiness-76fc9cc-20261009/images/server-76fc9cc.docker.tar`, 191,117,312 bytes, SHA-256 `d0a28f5351c0ae33a0d8aeb01e78596f266b3187ff11095c922604ee4efcb212` |
| Image-save receipt | `.data/qa-prep/local-image-readiness-76fc9cc-20261009/images/docker-save-receipt.json` |
| Frozen build contexts | Web: `d7051fa96d3d8b665d5ca94cefd3ae28f64e36a3e23083f9bae22b33f1ba9671`; server: `6047bcba2de7ee5cd52421a2aff76cb8bcb81e0b9a4e5ed28f0f6de0bd86bafa`; metadata: `.data/qa-prep/local-image-readiness-76fc9cc-20261009/context-metadata.json` |

These IDs/tags were inspected in the local Docker daemon and match the IDs recorded in the image-save receipt. The archive hashes above identify the exact exported images; they do not prove an external copy was transferred or loaded. Candidate contexts came from the exact commit/tree and exclude `.env`, `.tmp`, `.data`, fixtures, tests and the concurrent UIX-264 work. **Do not rebuild these images from the current dirty checkout.**

The earlier context-preparation metadata may say `buildExecuted: false`; subsequent local image receipts supersede that field for the local candidate build/start only. They do not indicate any remote build or deployment.

## Evidence status: proven vs outstanding

### Proven locally (scoped, synthetic, non-production)

- Both exact image IDs started as isolated local containers on test networks; the server ran its automatic Drizzle migration entrypoint. `.data/qa-prep/local-image-readiness-76fc9cc-20261009/server-runtime.json`: health HTTP 200, `status=ok`, `database=ok`, candidate short revision `76fc9cc`, 49 migration rows, 59 public tables; startup 10.59 s. The separate disposable DB/media restore receipt records one synthetic campaign before/after; do not attribute that fixture count to `server-runtime.json`.
- Edge routing was exercised on a separate local edge container/network. `.data/qa-prep/local-image-readiness-76fc9cc-20261009/edge-runtime.json`: health 200, landing 200, font `200|font/woff|343264`, unauthenticated bootstrap 401, protected stamp route 401, Socket.IO polling 200 with Engine.IO open observed and SID redacted. **This proves polling/open handshake only—not WebSocket upgrade, authenticated realtime, or external TLS.**
- Disposable DB/media recovery passed. `.data/qa-prep/local-image-readiness-76fc9cc-20261009/backup-restore/receipt.json` records one synthetic campaign before/after, 49 migration rows, 59 public tables, dump hash `b0139233ef04a9afa2b56c2bce84d6398ec621bea05a39977d40cac27712024f`, and restore equality PASS. `restored-db-runtime.json` records health 200, repeated migration startup PASS, and source/restored synthetic-media SHA-256 equality (`9039ffdd…43b2a44`). This is recovery into a **fresh local test database/volume**, not a production restore rehearsal.
- The full font context SHA-256 is `7b4e50ec50c782077ee147ca5d8db8c4843bcc7dd72ff8f133c2458e45347252d`; its frozen source is `web/apps/web/public/assets/pragmatica-next_vf.woff` in the extracted context. Use this value for later byte comparison, not just a `200` response.
- Exact-candidate migration journal has 49 entries, ending at `0048_sour_ultimatum`. That migration adds drawing kind/stamp columns with `FREEHAND` defaults and constraints. The server image migrates before serving (`Dockerfile.server`). Application `schemaVersion: 2` is not a substitute for verifying the exact migration ledger.
- Local runtime topology and receipts: `.data/qa-prep/local-image-readiness-76fc9cc-20261009/runtime-topology.json`, `restore-health.json`, `edge-health.json`, `http-static-auth.json`, `restored-db-runtime.json`.

### Still outstanding — do not infer PASS

- Current production revision, schema ledger, containers/images, Nginx state, available disk, mounted DB/media volumes, and backup freshness have **not** been inventoried. No remote access was attempted.
- The user-facing request to start the server currently returns HTTP 429 `QuotaExceeded`; the underlying resource/cause is unknown. This is not evidence of server state or permission to retry against a remote host. The previously prepared freeze at `76fc9cc` was superseded by a shutdown-server candidate `aca1436` that remains pending; this handoff is strictly for the exact frozen `76fc9cc` artifacts and does not establish which candidate is currently deployable.
- Image provenance/archive checksum has local receipts, but no authorized transfer or remote `docker load` has occurred.
- No migration downgrade was attempted or supported. Restore equality from a disposable synthetic backup does **not** prove old-server compatibility after migration 49/`0048`, and no authenticated live QA path was run.
- No external DNS/TLS/API/WebSocket/font smoke, player/GM acceptance, or persistent production media verification has run.
- Local health currently reports short `buildRevision: "76fc9cc"`. Production health acceptance requires the **full 40-character** target SHA and schema `2`; the shortened local string is not production identity proof.
- The existing `infra/deploy/release.sh` is the fail-closed production path, requires a reviewed SHA in fetched `origin/main`, snapshots rollback images, backs up/restores, then **builds from source**. The current Compose file declares `build:` and does not consume the preloaded `arken-qa-*` image IDs. `infra/deploy/build-and-start.sh` also requires a clean exact-SHA checkout and runs `docker compose up -d --build`. Do not bypass either contract with a direct production `docker compose up`, and do not claim these image IDs can be deployed by those scripts. An image-aware release mechanism must be explicitly approved and preserve the existing lock, backup/restore and rollback gates before these prebuilt IDs can be applied.

## Timeboxed local gate — target 2026-10-09 13:55 MSK

This is a one-hour **local evidence consolidation target**, not a production window. The runtime receipts above already prove the bounded image-start/migration, synthetic DB+media restore, local edge/API unauthorized behavior, Socket.IO polling, and font checks. Before 13:55, the owner/root should reconcile the runtime-agent's final image/edge/media/restore artifacts into one checkpoint and decide whether local gates are closed or what remains. Do not duplicate those pools, expand to real credentials, or turn this time target into a deployment authorization. If a receipt is missing, inconsistent, or reports a mismatch, stop at the failing gate and retain both artifacts; do not repair production or overwrite the candidate.

## Later remote phase — templates only, owner authorization required

**None of the following commands has been executed.** Run only from an already approved operator session after explicit authorization for that exact remote stage. Keep shell tracing off (`set +x`); never `cat`, `env`, `printenv`, or paste `.env`/restic contents. Known paths below come from `docs/operations.md`; verify them read-only before use and stop if they differ. No SSH host/user/key or secret value is specified here.

### R0 — read-only host, revision, disk, volume and topology inventory

Read-only means strictly no service start/restart, migration, image load, backup, file write, or configuration change. If the host/services are unavailable, capture that as an unavailable inventory result and stop; do not try to bring them up in R0.

```sh
set -eu
set +x
APP_ROOT=/home/uixray/apps/arken-space
DATA_ROOT=/home/uixray/apps/arken-space-data
DOMAIN=https://arken-khar.space
compose() {
  sudo -n docker compose --project-name arken-space \
    --project-directory "$APP_ROOT" --file "$APP_ROOT/docker-compose.yml" "$@"
}
date -Is
hostnamectl --static
test -f "$APP_ROOT/docker-compose.yml"
git -C "$APP_ROOT" rev-parse HEAD 2>/dev/null || printf '%s\n' 'checkout has no Git metadata; use health revision below'
curl -fsS --max-time 10 http://127.0.0.1:4100/healthz |
  jq '{status,database,buildRevision,schemaVersion}'
curl -fsS --max-time 10 --resolve arken-khar.space:4430:127.0.0.1 \
  https://arken-khar.space:4430/healthz |
  jq '{status,database,buildRevision,schemaVersion}'
sudo -n nginx -t
compose ps --all --format 'table {{.Service}}\t{{.State}}\t{{.Image}}\t{{.Publishers}}'
for id in $(compose ps -q postgres server web); do
  sudo -n docker inspect --format \
    '{{.Name}} state={{.State.Status}} image={{.Config.Image}} mounts={{json .Mounts}}' "$id"
done
MEDIA_HOST_PATH="$(sudo -n node "$APP_ROOT/infra/deploy/release-core.mjs" \
  env-value "$APP_ROOT/.env" MEDIA_HOST_PATH "$APP_ROOT" "$DOMAIN")"
MIN_FREE_DISK_BYTES="$(sudo -n node "$APP_ROOT/infra/deploy/release-core.mjs" \
  env-value "$APP_ROOT/.env" MIN_FREE_DISK_BYTES "$APP_ROOT" "$DOMAIN")"
df -PB1 "$APP_ROOT" "$DATA_ROOT" "$MEDIA_HOST_PATH"
findmnt -T "$MEDIA_HOST_PATH" -o TARGET,SOURCE,FSTYPE,OPTIONS
MEDIA_FREE_BYTES="$(df -PB1 "$MEDIA_HOST_PATH" | awk 'NR==2 {print $4}')"
node -e 'const [free,min]=process.argv.slice(1).map(BigInt); const need=min+5n*1024n*1024n*1024n; if (free<need) { console.error("media disk reserve failed"); process.exit(1); }' \
  "$MEDIA_FREE_BYTES" "$MIN_FREE_DISK_BYTES"
sudo -n docker volume ls --filter label=com.docker.compose.project=arken-space
```

Stop if health is unavailable, `status`/`database` are not `ok`, current revision/schema cannot be identified, paths/volume mounts differ from the expected live topology, or the filesystem has less than `MIN_FREE_DISK_BYTES + 5 GiB`. Do not print full Compose config or `.env` (they contain secret values). Record only safe fields, image IDs, mount paths, disk bytes, and service states.

### R1 — fresh backup and exact isolated restore rehearsal, before any update

The existing backup one-shot uses the root-owned restic configuration without printing credential values, creates a PostgreSQL custom dump + DB counts + media hashes, uploads them, runs retention `forget --prune`, then `restic check`. That retention/prune side effect must be within the owner-approved backup policy; if not approved, stop and obtain a separately reviewed no-prune backup procedure. Do not point restore rehearsal at the production DB/media/volume.

```sh
sudo -n systemctl start arken-space-backup.service
sudo -n systemctl show arken-space-backup.service \
  -p ActiveState -p SubState -p ExecMainStatus --no-pager
# Extract only the one fresh `snapshot <hex-id>` line from the service log;
# do not dump environment values or unrelated logs into the handoff.
sudo -n journalctl -u arken-space-backup.service -n 30 --no-pager |
  grep -E 'snapshot [0-9a-f]{8,}' | tail -1
```

Require successful oneshot status and capture the exact snapshot ID/time from that invocation; never use `latest` as release evidence. Then run the repo's guarded restore harness against a **new isolated clean target**, with the approved restic environment injected non-echoing from its protected file:

```sh
export ARKEN_RESTORE_CONFIRM=isolated-clean-target
export RESTORE_BUILD_REVISION=76fc9cccaafe5dd6795fb4f7c33344990d39eed0
export SNAPSHOT_ID='<exact snapshot id from R1>'
sh "$APP_ROOT/infra/backup/restore.sh"
jq '{runSucceeded,buildRevision,schemaVersion,leftovers,steps}' \
  "$APP_ROOT/test-results/restore/runner.json"
```

Require restore report success, exact source revision/schema, DB count/checksum equality, media checksum equality, and complete isolated container/volume cleanup. The checked-in `restore.sh` rejects projects outside `arken-restore-*` and does not restore into the production volume. Do not substitute `SNAPSHOT_ID=latest`.

### R2 — verify and load the two immutable image archives (no container start)

Only after owner authorization for **image transfer/load**, copy these two archives through the approved private transfer channel to a new mode-0700 staging directory. Verify bytes before load; verify tag → full image ID after load. If the tag already points elsewhere or is used by a container, stop and do not retag or replace it.

```sh
# Run only from the source machine after an owner-approved target alias/path is supplied.
LOCAL_QA=.data/qa-prep/local-image-readiness-76fc9cc-20261009/images
: "${DEPLOY_TARGET:?use an owner-approved remote account/host alias; do not record secrets}"
: "${REMOTE_STAGE:?set the approved non-public staging directory on that host}"
ssh "$DEPLOY_TARGET" "umask 077; install -d -m 700 -- '$REMOTE_STAGE'"
scp -p "$LOCAL_QA/web-76fc9cc.docker.tar" "$DEPLOY_TARGET:$REMOTE_STAGE/"
scp -p "$LOCAL_QA/server-76fc9cc.docker.tar" "$DEPLOY_TARGET:$REMOTE_STAGE/"

# Continue only in the approved operator session on that host.
set -eu
set +x
umask 077
STAGE="${REMOTE_STAGE:?use the exact owner-approved stage path created above}"
WEB_TAR="$STAGE/web-76fc9cc.docker.tar"
SERVER_TAR="$STAGE/server-76fc9cc.docker.tar"
WEB_REF=arken-qa-web:76fc9cc
SERVER_REF=arken-qa-server:76fc9cc
WEB_ID=sha256:e6749f37484461a3f9960f825805f95d542e9eddcfdd0e3a2d8aac9adad4e9f1
SERVER_ID=sha256:f551e09e7ffaa31a7c5ecf05d45e2efdf166ff40d8e1ff9ea72c1796a57e9ec2
printf '%s  %s\n' 6583b4b689acfb5398c95da053ebffaa9ee35d91bd037b1ce7601fd1590f1260 "$WEB_TAR" | sha256sum -c -
printf '%s  %s\n' d0a28f5351c0ae33a0d8aeb01e78596f266b3187ff11095c922604ee4efcb212 "$SERVER_TAR" | sha256sum -c -
verify_ref_id() {
  ref=$1
  expected=$2
  if sudo -n docker image inspect "$ref" >/dev/null 2>&1; then
    actual="$(sudo -n docker image inspect --format '{{.Id}}' "$ref")"
    [ "$actual" = "$expected" ] || { echo "existing image tag conflict: $ref" >&2; exit 1; }
  fi
}
verify_ref_id "$WEB_REF" "$WEB_ID"
verify_ref_id "$SERVER_REF" "$SERVER_ID"
sudo -n docker load --input "$WEB_TAR"
sudo -n docker load --input "$SERVER_TAR"
[ "$(sudo -n docker image inspect --format '{{.Id}}' "$WEB_REF")" = "$WEB_ID" ]
[ "$(sudo -n docker image inspect --format '{{.Id}}' "$SERVER_REF")" = "$SERVER_ID" ]
```

These commands only put verified images into the local Docker image store. They do **not** start or update services. Image loading alone is not a deployment. The canonical production release scripts currently rebuild from source; if an approved path cannot consume these IDs without bypassing the existing release lock/backup/restore/rollback policy, stop here.

### R3 — migration compatibility and rollback gate

Before any production-changing action, compare the R0 current revision/schema/migration ledger to the candidate's exact 49-entry journal, then rehearse **all pending migrations** on a fresh isolated restore of the exact R1 snapshot with these images. The isolated DB must show health/database `ok`, expected migration ledger/table counts, and preserved application/media checksums. `0048_sour_ultimatum` is additive at the SQL level (new drawing columns/defaults/checks); that alone does not prove the entire pending migration set or older-server compatibility.

An image rollback is allowed only if the new schema and any records written by the candidate remain readable and writable by the exact previous server image, proven on the isolated migrated copy. **No migration downgrade is available or authorized.** If the old image fails against the migrated schema, or compatibility is unknown: do not switch the old image against the new DB; keep the database volume untouched, preserve logs, and use a forward fix or the separately authorized restore/cutover plan. The local fresh-DB recovery receipt is not old-app rollback evidence.

### R4 — post-update loopback and external-host smoke (only after separate deploy GO)

No command in this subsection should run until the owner has separately authorized the production-changing phase, R0–R3 pass, and an image-aware fail-closed deployment path exists. Current local artifacts do **not** authorize this step.

Loopback edge checks (API 401 is expected for unauthenticated bootstrap; do not turn it into a login attempt):

```sh
DOMAIN=https://arken-khar.space
curl -fsS --max-time 10 http://127.0.0.1:4100/healthz |
  jq -e --arg rev 76fc9cccaafe5dd6795fb4f7c33344990d39eed0 '.status=="ok" and .database=="ok" and .buildRevision==$rev and (.schemaVersion|tostring)=="2"'
curl -fsS --max-time 10 http://127.0.0.1:4180/assets/pragmatica-next_vf.woff -o /tmp/arken-font-loopback.woff
test "$(sha256sum /tmp/arken-font-loopback.woff | awk '{print $1}')" = 7b4e50ec50c782077ee147ca5d8db8c4843bcc7dd72ff8f133c2458e45347252d
BOOTSTRAP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:4100/api/bootstrap)"
test "$BOOTSTRAP_CODE" = 401
```

The web container on `4180` is static-only; its unknown `/api/*` paths may return SPA HTML and are **not API evidence**. Check API through the configured edge at `127.0.0.1:4430`, not the raw web container. Socket.IO polling is a separate edge route:

```sh
curl -fsS --max-time 10 --resolve arken-khar.space:4430:127.0.0.1 \
  https://arken-khar.space:4430/api/public/roadmap-votes -o /tmp/arken-public-api.json
jq -e 'type == "object" or type == "array"' /tmp/arken-public-api.json >/dev/null
BOOTSTRAP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  --resolve arken-khar.space:4430:127.0.0.1 \
  https://arken-khar.space:4430/api/bootstrap)"
test "$BOOTSTRAP_CODE" = 401
WS_LOG="$(mktemp)"
curl -sS -i -m 8 --http1.1 \
  -H 'Origin: https://arken-khar.space' -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  --resolve arken-khar.space:4430:127.0.0.1 \
  'https://arken-khar.space:4430/socket.io/?EIO=4&transport=websocket' \
  >"$WS_LOG" 2>/dev/null || true
head -n 1 "$WS_LOG" | grep -q ' 101 '
rm -f "$WS_LOG" /tmp/arken-public-api.json /tmp/arken-font-loopback.woff
```

Require the public GET to return its expected JSON/status and the WebSocket handshake to return `101`; the already-proven local polling `200` is not a `101` substitute. From a genuinely external host after DNS/TLS authorization, repeat only non-mutating checks against `https://arken-khar.space`: health must show full 40-character candidate revision + schema `2`, public GET responds as expected, unauthenticated bootstrap is `401`, Socket.IO upgrade is `101`, landing is HTML `200`, and `/assets/pragmatica-next_vf.woff` is `200`, `font/woff`, 343264 bytes, SHA-256 `7b4e50ec50c782077ee147ca5d8db8c4843bcc7dd72ff8f133c2458e45347252d`. Do not follow up with an authenticated/live campaign smoke; owner is considering server-on and no auth approval exists.

External-host smoke template (run from a separately approved external QA machine, without credentials; stop on any mismatch):

```sh
set -eu
BASE=https://arken-khar.space
curl -fsS --max-time 10 "$BASE/healthz" |
  jq -e --arg rev 76fc9cccaafe5dd6795fb4f7c33344990d39eed0 '.status=="ok" and .database=="ok" and .buildRevision==$rev and (.schemaVersion|tostring)=="2"'
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/")" = 200
curl -fsS --max-time 10 "$BASE/api/public/roadmap-votes" -o /tmp/arken-public-api.json
jq -e 'type == "object" or type == "array"' /tmp/arken-public-api.json >/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/api/bootstrap")" = 401
curl -fsS --max-time 10 "$BASE/assets/pragmatica-next_vf.woff" -o /tmp/arken-font-external.woff
test "$(sha256sum /tmp/arken-font-external.woff | awk '{print $1}')" = 7b4e50ec50c782077ee147ca5d8db8c4843bcc7dd72ff8f133c2458e45347252d
test "$(wc -c </tmp/arken-font-external.woff | tr -d ' ')" = 343264
curl -sS -i -m 8 --http1.1 \
  -H 'Origin: https://arken-khar.space' -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "$BASE/socket.io/?EIO=4&transport=websocket" -o /tmp/arken-ws-external.headers 2>/dev/null || true
head -n 1 /tmp/arken-ws-external.headers | grep -q ' 101 '
rm -f /tmp/arken-public-api.json /tmp/arken-font-external.woff /tmp/arken-ws-external.headers
```

### R5 — restore fallback, never schema downgrade

- If failure occurs before migration starts: preserve the fresh R1 backup and use the established image rollback only through an approved release controller that rechecks exact image IDs and current revision.
- If any migration ran: do not run `DROP`, reverse SQL, hand-edit Drizzle's migration ledger, `docker compose down -v`, or restore the old dump over the live PostgreSQL volume. Preserve the current DB/media volumes and backup evidence.
- Rehearse the exact R1 snapshot again only into a new `arken-restore-*` clean target via `infra/backup/restore.sh`. Check DB counts/checksums, media hashes and target health. A production recovery/cutover would require a separate owner-authorized incident plan acknowledging downtime and loss of writes after the snapshot; keep the old volume intact until explicit cutover approval. Do not treat a successful isolated restore as permission to replace production data.

## Compact checkpoint

- **Decision:** exact local candidate images and synthetic runtime/recovery/edge checks are evidenced; no remote/deploy action is authorized. Owner is considering whether to turn the server on.
- **Revision:** candidate `76fc9cccaafe5dd6795fb4f7c33344990d39eed0` / tree `9c3d53904ce32d90bb74615cc7d5218ce3dedf47`; working checkout at handoff `9ad28ebd73f9e01c3af6f5bd84064ecc7d06fef1` has concurrent UIX-264 work. Candidate was isolated from that dirty tree.
- **Changed file:** only this new handoff. No scripts/product/source files changed.
- **Verification:** local Docker image IDs inspected; image-save receipts, 49-migration startup, isolated DB+media restore, local edge health/API/font/Socket.IO polling receipts inspected. No secret files/values opened.
- **Blockers:** current remote state and disk/volumes/backups unknown; no external host or live-auth test; no schema-down/old-app compatibility proof; existing release scripts build source rather than consume the prebuilt image IDs.
- **Next:** by 13:55 MSK consolidate the local gate with the runtime-artifact owner. Then wait for explicit scope/GO for any remote phase and for an approved image-aware release path. Do not mark production ready or update the task as complete.

## Component candidate supersession — root acceptance
The server76fc9cc archive above is retained for diagnosis, NOT the preferred update artifact after its shutdown failure. Use shutdown-fixed serveraca1436 only after target gates/authorization: image sha256:e91b854539a1dea8e929d66dcc9796e104aca0ccd4f2fc1a8b6a49333ef0f09a, saved archive .data/qa-prep/local-image-readiness-aca1436-20261009/images/server-aca1436.docker.tar (191119360B), SHA2561aa9641018759b1d26b38b132f76c58a3ccd263f5598bf38b4d8610aef4af897. Runtime health200/defaultstop0/0.56s passed. Root inspected server-shutdown-receipt.json. Web76fc9cc remains unchanged; this is an explicitly component-versioned pair, not one-SHA image set. UIX2640476865 is committed/tested but absent from web76fc9cc. External VM start failed429QuotaExceeded; no remote/deploy approval or target evidence exists. Update all revision-sensitive health checks to the selected component revision; never upload the entire QA directory or synthetic DB/env artifacts.
