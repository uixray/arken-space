#!/usr/bin/env bash
# Owner-invoked, one-shot snapshot for the /opt/arken-space software package.
# Unlike backup.sh this never prunes, forgets, or deletes Restic snapshots.
set -Eeuo pipefail
umask 077

die() { printf '%s\n' "capture refused: $1" >&2; exit 2; }
[[ ${ARKEN_CAPTURE_QUIESCE_CONFIRM:-} == stop-and-restart-arken-server ]] || die 'set ARKEN_CAPTURE_QUIESCE_CONFIRM=stop-and-restart-arken-server to authorize brief API downtime'
APP_ROOT=${ARKEN_APP_ROOT:-/opt/arken-space}
COMPOSE_FILE=${ARKEN_COMPOSE_FILE:-$APP_ROOT/compose.template.yml}
ENV_FILE=${ARKEN_RUNTIME_ENV_FILE:-$APP_ROOT/runtime.env}
PROJECT=${COMPOSE_PROJECT_NAME:-arken-space}
BACKUP_ROOT=${ARKEN_BACKUP_ROOT:-/opt/arken-space-data/backups}
RECEIPT=${ARKEN_CAPTURE_RECEIPT:-$BACKUP_ROOT/capture-receipt-$(date -u +%Y%m%dT%H%M%SZ).json}
[[ -f $COMPOSE_FILE && -f $ENV_FILE ]] || die 'compose file or runtime env file is missing'
[[ ! -L $ENV_FILE ]] || die 'runtime env symlinks are not accepted'
[[ -n ${RESTIC_REPOSITORY:-} ]] || die 'RESTIC_REPOSITORY is required'
command -v restic >/dev/null || die 'restic is unavailable'
command -v docker >/dev/null || die 'docker is unavailable'
command -v sha256sum >/dev/null || die 'sha256sum is unavailable'
command -v node >/dev/null || die 'node is unavailable'
mkdir -p -m 700 "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
backup_root_real=$(realpath -m "$BACKUP_ROOT")
receipt_dir=$(dirname "$RECEIPT")
receipt_dir_real=$(realpath -m "$receipt_dir")
case "$receipt_dir_real" in "$backup_root_real"|"$backup_root_real"/*) ;; *) die 'receipt must be stored beneath the private backup root';; esac
mkdir -p -m 700 "$receipt_dir"
chmod 700 "$receipt_dir"
[[ ! -e $RECEIPT && ! -L $RECEIPT ]] || die 'receipt path already exists or is a symlink; choose a fresh path'

dc=(docker compose --project-name "$PROJECT" --project-directory "$APP_ROOT" --file "$COMPOSE_FILE" --env-file "$ENV_FILE")
restic snapshots --json >/dev/null 2>&1 || die 'Restic repository is not readable/unlocked'
server_id=$("${dc[@]}" ps -q server)
pg_id=$("${dc[@]}" ps -q postgres)
[[ -n $server_id && -n $pg_id ]] || die 'running server and postgres containers are required'
# Capture the safe health fields while the API container is still running.
health_json=$(docker exec "$server_id" node -e 'const p=process.env.PORT||4100;fetch(`http://127.0.0.1:${p}/healthz`).then(async r=>{if(!r.ok)process.exit(2);const j=await r.json();console.log(JSON.stringify({buildRevision:j.buildRevision,schemaVersion:j.schemaVersion}))}).catch(()=>process.exit(3))') || die 'health metadata unavailable'
node -e 'const h=JSON.parse(process.argv[1]); if(!h.buildRevision || h.schemaVersion===undefined || h.schemaVersion===null) process.exit(1)' "$health_json" || die 'health metadata omitted revision or schema version'
work_parent=${ARKEN_CAPTURE_TMPDIR:-${TMPDIR:-/tmp}}
mkdir -p -m 700 "$work_parent"
work=$(mktemp -d "$work_parent/arken-service-capture.XXXXXXXX")
chmod 700 "$work"
stopped_by_us=false
resume_attempted=false
resume_server() {
  [[ $stopped_by_us == true && $resume_attempted == false ]] || return 0
  # Mark before the first start attempt so EXIT cleanup never races/double-starts.
  resume_attempted=true
  "${dc[@]}" start server >/dev/null || { printf '%s\n' 'WARNING: could not restart server; operator action required' >&2; return 1; }
  healthy=false
  for _ in {1..30}; do
    if docker exec "$server_id" node -e 'const p=process.env.PORT||4100;fetch(`http://127.0.0.1:${p}/healthz`).then(r=>{if(!r.ok)process.exit(2);process.exit(0)}).catch(()=>process.exit(3))' >/dev/null 2>&1; then healthy=true; break; fi
    sleep 1
  done
  [[ $healthy == true ]] || { printf '%s\n' 'WARNING: server did not become healthy; operator action required' >&2; return 1; }
  stopped_by_us=false
}
cleanup() {
  status=$?
  trap - EXIT INT TERM HUP
  if [[ $stopped_by_us == true && $resume_attempted == false ]]; then resume_server || status=1; fi
  case "$work" in "$work_parent"/arken-service-capture.*) rm -rf -- "$work";; *) printf '%s\n' 'WARNING: unsafe private staging path; left untouched' >&2; status=1;; esac
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Stop only the API container, and only after the explicit interlock above.
stopped_by_us=true
"${dc[@]}" stop server >/dev/null
mkdir -m 700 "$work/config" "$work/images" "$work/media"
# Runtime credentials and deployment configuration are staged privately and are
# included only inside the encrypted Restic snapshot. They are never emitted.
install -m 600 "$ENV_FILE" "$work/config/runtime.env"
install -m 600 "$COMPOSE_FILE" "$work/config/compose.yml"
# Preserve server env_file references while interpolating the rest of the private
# deployment config. Default Compose resolution can inline env_file values and
# remove the path needed to capture the original runtime env file.
"${dc[@]}" config --format json --no-env-resolution > "$work/config/compose-rendered.private.json" || die 'Compose config could not be rendered'
chmod 600 "$work/config/compose-rendered.private.json"
runtime_env_path=$(node - "$work/config/compose-rendered.private.json" "$APP_ROOT" <<'NODE'
const fs=require('node:fs'),path=require('node:path');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const value=config.services?.server?.env_file;
const entries=Array.isArray(value)?value:[value];
if(entries.length!==1||!entries[0])process.exit(2);
const entry=entries[0], p=typeof entry==='string'?entry:entry.path;
if(!p)process.exit(3);
process.stdout.write(path.resolve(process.argv[3],p));
NODE
) || die 'server runtime env-file path could not be resolved'
[[ -f $runtime_env_path && ! -L $runtime_env_path ]] || die 'server runtime env file is missing or a symlink'
install -m 600 "$runtime_env_path" "$work/config/server-runtime.env"
for f in "$APP_ROOT/compose.activation.override.yml" "$APP_ROOT/manifest.pending.json" "$APP_ROOT/image-build-manifest.json" "$APP_ROOT/software-members.json"; do
  [[ ! -f $f ]] || install -m 600 "$f" "$work/config/$(basename "$f")"
done
# Optional newline-delimited absolute deployment/config paths, explicitly
# supplied by the owner. Stage as private files without logging their contents.
if [[ -n ${ARKEN_CAPTURE_CONFIG_FILES:-} ]]; then
  while IFS= read -r f; do
    [[ -z $f ]] && continue
    [[ -f $f && ! -L $f ]] || die 'an additional config path is missing or a symlink'
    dest="$work/config/extra-$(basename "$f")"
    [[ ! -e $dest ]] || die 'additional config paths have colliding basenames'
    install -m 600 "$f" "$dest"
  done <<< "$ARKEN_CAPTURE_CONFIG_FILES"
fi

server_image_id=$(docker inspect --format '{{.Image}}' "$server_id")
pg_image_id=$(docker inspect --format '{{.Image}}' "$pg_id")
web_id=$("${dc[@]}" ps -q web || true)
web_image_id=unavailable
if [[ -n $web_id ]]; then web_image_id=$(docker inspect --format '{{.Image}}' "$web_id"); fi
docker save --output "$work/images/server.tar" "$server_image_id"
docker save --output "$work/images/postgres.tar" "$pg_image_id"
if [[ $web_image_id != unavailable ]]; then docker save --output "$work/images/web.tar" "$web_image_id"; fi

# Container is quiesced, so database and mounted media form a coherent capture.
docker exec "$pg_id" sh -ec 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom' > "$work/database.dump"
[[ -s $work/database.dump ]] || die 'database dump is empty'
counts_sql=${ARKEN_DATABASE_COUNTS_SQL:-$APP_ROOT/infra/backup/database-counts.sql}
[[ -f $counts_sql ]] || counts_sql=$(cd "$(dirname "$0")" && pwd)/database-counts.sql
docker exec -i "$pg_id" sh -ec 'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-align --tuples-only --field-separator="|"' < "$counts_sql" > "$work/database-counts.txt"
docker exec "$pg_id" sh -ec 'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-align --tuples-only --command="SHOW server_version"' > "$work/postgres-version.txt"
docker exec "$pg_id" sh -ec 'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-align --tuples-only --field-separator="|" --command="SELECT id::bigint, hash, created_at::bigint FROM drizzle.\"__drizzle_migrations\" ORDER BY created_at, id"' > "$work/migration-ledger.txt"
[[ -s $work/postgres-version.txt && -s $work/migration-ledger.txt ]] || die 'PostgreSQL version or migration ledger proof is missing'
docker cp "$server_id:/srv/arken-space/media/." "$work/media/" >/dev/null

# Read only public health metadata was captured before stopping; never inspect environment.
image_metadata=$(node -e 'const [s,p,w]=process.argv.slice(1); console.log(JSON.stringify({server:s,postgres:p,web:w}))' "$server_image_id" "$pg_image_id" "$web_image_id")
node - "$work" "$APP_ROOT" "$health_json" "$image_metadata" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [root,app,health,image]=process.argv.slice(2), h=JSON.parse(health), imgs=JSON.parse(image);
const hash=p=>new Promise((resolve,reject)=>{const h=crypto.createHash('sha256'),s=fs.createReadStream(p);s.on('error',reject);s.on('data',chunk=>h.update(chunk));s.on('end',()=>resolve(h.digest('hex')));});
const files=[]; const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.isFile()&&path.basename(p)!=='capture-manifest.json')files.push({path:path.relative(root,p).split(path.sep).join('/'),bytes:fs.statSync(p).size});}}; walk(root);
const git=(require('node:child_process').spawnSync('git',['-C',app,'rev-parse','HEAD'],{encoding:'utf8'}));
(async()=>{for(const f of files)f.sha256=await hash(path.join(root,f.path));const manifest={format:'arken-service-snapshot-v1',capturedAt:new Date().toISOString(),target:app,sourceRevision:git.status===0?git.stdout.trim():'unknown',buildRevision:h.buildRevision??'unknown',schemaVersion:h.schemaVersion??'unknown',images:imgs,files};fs.writeFileSync(path.join(root,'capture-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});})().catch(()=>process.exit(4));
NODE
manifest_sha=$(sha256sum "$work/capture-manifest.json" | cut -d' ' -f1)
# The database, media, configuration, image archives, and their manifest are
# now one immutable local snapshot tuple. Resume API before potentially slow I/O.
resume_server || die 'captured tuple is staged, but server restart/health failed'
invocation="service-capture-$(date -u +%Y%m%dT%H%M%SZ)-$$"
# No forget/prune/check mutation: this is a new snapshot only.
restic backup "$work" --host arken-space-service --tag arken-space --tag "$invocation" >/dev/null 2>&1 || die 'Restic backup failed'
snapshot_id=$(restic snapshots --json --host arken-space-service --tag "$invocation" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const a=JSON.parse(s);if(a.length!==1)process.exit(2);console.log(a[0].id)})') || die 'could not resolve unique Restic snapshot ID'
node - "$RECEIPT" "$snapshot_id" "$invocation" "$manifest_sha" "$health_json" "$image_metadata" <<'NODE'
const fs=require('node:fs');const [p,id,tag,sha,health,images]=process.argv.slice(2);
const h=JSON.parse(health),i=JSON.parse(images);const r={format:'arken-service-capture-receipt-v1',snapshotId:id,tag,manifestSha256:sha,buildRevision:h.buildRevision??'unknown',schemaVersion:h.schemaVersion??'unknown',imageIds:i};
fs.writeFileSync(p,JSON.stringify(r,null,2)+'\n',{mode:0o600});
NODE
printf 'Encrypted service snapshot captured. Snapshot ID: %s\nReceipt: %s\n' "$snapshot_id" "$RECEIPT"
