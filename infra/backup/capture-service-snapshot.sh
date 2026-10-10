#!/usr/bin/env bash
# Owner-invoked, one-shot snapshot for the /opt/arken-space software package.
# Unlike backup.sh this never prunes, forgets, or deletes Restic snapshots.
set -Eeuo pipefail
umask 077

die() { printf '%s\n' "capture refused: $1" >&2; exit 2; }
[[ ${ARKEN_CAPTURE_QUIESCE_CONFIRM:-} == stop-and-restart-arken-server ]] || die 'set ARKEN_CAPTURE_QUIESCE_CONFIRM=stop-and-restart-arken-server to authorize brief API downtime'
CAPTURE_MODE=${ARKEN_CAPTURE_MODE:-compose}
APP_ROOT=${ARKEN_APP_ROOT:-/opt/arken-space}
COMPOSE_FILE=${ARKEN_COMPOSE_FILE:-$APP_ROOT/compose.template.yml}
ENV_FILE=${ARKEN_RUNTIME_ENV_FILE:-$APP_ROOT/runtime.env}
PROJECT=${COMPOSE_PROJECT_NAME:-arken-space}
BACKUP_ROOT=${ARKEN_BACKUP_ROOT:-/opt/arken-space-data/backups}
RECEIPT=${ARKEN_CAPTURE_RECEIPT:-$BACKUP_ROOT/capture-receipt-$(date -u +%Y%m%dT%H%M%SZ).json}
case "$CAPTURE_MODE" in
  compose)
    [[ -f $COMPOSE_FILE && -f $ENV_FILE ]] || die 'compose file or runtime env file is missing'
    [[ ! -L $ENV_FILE ]] || die 'runtime env symlinks are not accepted'
    ;;
  cloned-review)
    for name in ARKEN_REVIEW_API_CONTAINER_ID ARKEN_REVIEW_PG_CONTAINER_ID ARKEN_REVIEW_WEB_CONTAINER_ID ARKEN_REVIEW_EDGE_CONTAINER_ID ARKEN_REVIEW_API_IMAGE_ID ARKEN_REVIEW_PG_IMAGE_ID ARKEN_REVIEW_WEB_IMAGE_ID ARKEN_REVIEW_EDGE_IMAGE_ID ARKEN_REVIEW_NETWORK_ID ARKEN_REVIEW_EDGE_EXTRA_NETWORK_IDS ARKEN_REVIEW_MEDIA_SOURCE ARKEN_REVIEW_MEDIA_CONTAINER_PATH ARKEN_REVIEW_EDGE_CONFIG_SOURCE ARKEN_REVIEW_EDGE_CONFIG_CONTAINER_PATH ARKEN_REVIEW_RUNTIME_ENV_FILE ARKEN_REVIEW_EXPECTED_DATABASE_HOST; do
      [[ -n ${!name:-} ]] || die 'cloned-review identity inputs are incomplete'
    done
    [[ -f $ARKEN_REVIEW_RUNTIME_ENV_FILE && ! -L $ARKEN_REVIEW_RUNTIME_ENV_FILE ]] || die 'review runtime env file is missing or a symlink'
    [[ -f $ARKEN_REVIEW_EDGE_CONFIG_SOURCE && ! -L $ARKEN_REVIEW_EDGE_CONFIG_SOURCE ]] || die 'review edge config file is missing or a symlink'
    [[ -d $ARKEN_REVIEW_MEDIA_SOURCE && ! -L $ARKEN_REVIEW_MEDIA_SOURCE ]] || die 'review media source must be an existing non-symlink directory'
    [[ $ARKEN_REVIEW_MEDIA_CONTAINER_PATH == /* && $ARKEN_REVIEW_EDGE_CONFIG_CONTAINER_PATH == /* ]] || die 'review container paths must be absolute POSIX paths'
    ENV_FILE=$ARKEN_REVIEW_RUNTIME_ENV_FILE
    ;;
  *) die 'unsupported capture mode';;
esac
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

restic snapshots --json >/dev/null 2>&1 || die 'Restic repository is not readable/unlocked'
if [[ $CAPTURE_MODE == compose ]]; then
  dc=(docker compose --project-name "$PROJECT" --project-directory "$APP_ROOT" --file "$COMPOSE_FILE" --env-file "$ENV_FILE")
  server_id=$("${dc[@]}" ps -q server)
  pg_id=$("${dc[@]}" ps -q postgres)
  [[ -n $server_id && -n $pg_id ]] || die 'running server and postgres containers are required'
  web_id=$("${dc[@]}" ps -q web || true)
  edge_id=
  database_name=
  media_container_path=/srv/arken-space/media
  # Resolve the database the API actually uses against this PG container before downtime.
  # Inspect the URL only in memory; stdout contains only the target host and database.
  compose_identity=$(docker inspect "$server_id" "$pg_id" | node -e '
const fs=require("node:fs");
try {
 const [serverId,pgId]=process.argv.slice(1), a=JSON.parse(fs.readFileSync(0,"utf8"));
 if(!Array.isArray(a)||a.length!==2||a[0]?.Id!==serverId||a[1]?.Id!==pgId||a.some(x=>x?.State?.Status!=="running")) process.exit(2);
 const env=(c,key)=>{const v=(c.Config?.Env??[]).filter(x=>x.startsWith(key+"="));if(v.length>1)process.exit(3);return v.length?v[0].slice(key.length+1):null;};
 const entries=(a[0].Config?.Env??[]).filter(x=>x.startsWith("DATABASE_URL="));
 if(entries.length!==1)process.exit(4);
 const url=new URL(entries[0].slice("DATABASE_URL=".length));
 if(!["postgres:","postgresql:"].includes(url.protocol))process.exit(5);
 const database=decodeURIComponent(url.pathname.slice(1));
 if(!/^[-A-Za-z0-9_]+$/.test(database)||url.pathname.slice(1).includes("/"))process.exit(6);
 const pgDatabase=env(a[1],"POSTGRES_DB")||env(a[1],"POSTGRES_USER")||"postgres";
 if(database!==pgDatabase)process.exit(7);
 const apiNetworks=Object.values(a[0].NetworkSettings?.Networks??{}), pgNetworks=Object.values(a[1].NetworkSettings?.Networks??{});
 const shared=pgNetworks.filter(p=>apiNetworks.some(n=>n.NetworkID===p.NetworkID));
 if(!shared.length)process.exit(8);
 const aliases=new Set([a[1].Name?.replace(/^[/]+/,""),...shared.flatMap(n=>n.Aliases??[])].filter(Boolean).map(x=>x.toLowerCase()));
 if(!aliases.has(url.hostname.toLowerCase()))process.exit(9);
 process.stdout.write(JSON.stringify({databaseName:database,databaseHost:url.hostname}));
} catch { process.exit(10); }
' "$server_id" "$pg_id") || die 'API DATABASE_URL does not identify the database and PG alias on the inspected PostgreSQL container'
  database_name=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).databaseName)' "$compose_identity")
else
  expected_identity=$(docker inspect "$ARKEN_REVIEW_API_CONTAINER_ID" "$ARKEN_REVIEW_PG_CONTAINER_ID" "$ARKEN_REVIEW_WEB_CONTAINER_ID" "$ARKEN_REVIEW_EDGE_CONTAINER_ID" | node -e '
const fs=require("node:fs");
try {
 const a=process.argv.slice(1);
 const [apiId,pgId,webId,edgeId,apiImage,pgImage,webImage,edgeImage,networkId,mediaSource,mediaTarget,expectedDbHost,edgeConfigSource,edgeConfigTarget,edgeExtraText]=a;
 const extra=edgeExtraText?edgeExtraText.split(",").filter(Boolean):[];
 const c=JSON.parse(fs.readFileSync(0,"utf8"));
 if(!Array.isArray(c)||c.length!==4) process.exit(2);
 const ids=[apiId,pgId,webId,edgeId], images=[apiImage,pgImage,webImage,edgeImage];
 for(let i=0;i<4;i++) if(c[i]?.Id!==ids[i]||c[i]?.State?.Status!=="running"||c[i]?.Image!==images[i]) process.exit(3);
 const netmaps=c.map(x=>x.NetworkSettings?.Networks??{});
 for(let i=0;i<3;i++) { const vals=Object.values(netmaps[i]); if(vals.length!==1||vals[0]?.NetworkID!==networkId) process.exit(4); }
 const edgeIds=Object.values(netmaps[3]).map(n=>n.NetworkID).sort();
 const allowed=[networkId,...extra].sort();
 if(new Set(allowed).size!==allowed.length||JSON.stringify(edgeIds)!==JSON.stringify(allowed)) process.exit(5);
 const apiMount=c[0].Mounts?.find(m=>m.Type==="bind"&&m.Destination===mediaTarget);
 if(!apiMount||apiMount.Source!==mediaSource) process.exit(6);
 const edgeMount=c[3].Mounts?.find(m=>m.Type==="bind"&&m.Destination===edgeConfigTarget);
 if(!edgeMount||edgeMount.Source!==edgeConfigSource) process.exit(7);
 const pgNet=netmaps[1][Object.keys(netmaps[1])[0]];
 const aliases=new Set([c[1].Name?.replace(/^[/]+/,""),...(pgNet?.Aliases??[])].filter(Boolean));
 const env=c[0].Config?.Env??[], entries=env.filter(x=>x.startsWith("DATABASE_URL="));
 if(entries.length!==1) process.exit(8);
 const url=new URL(entries[0].slice("DATABASE_URL=".length));
 const db=decodeURIComponent(url.pathname.slice(1));
 if(!["postgres:","postgresql:"].includes(url.protocol)||!/^[-A-Za-z0-9_]+$/.test(db)||url.hostname!==expectedDbHost||!aliases.has(url.hostname)) process.exit(9);
 process.stdout.write(JSON.stringify({databaseName:db,containerIds:ids,imageIds:images,networkId,edgeNetworkIds:edgeIds,mediaSource:apiMount.Source,mediaContainerPath:mediaTarget,edgeConfigSource:edgeMount.Source,edgeConfigContainerPath:edgeConfigTarget}));
} catch { process.exit(10); }
' "$ARKEN_REVIEW_API_CONTAINER_ID" "$ARKEN_REVIEW_PG_CONTAINER_ID" "$ARKEN_REVIEW_WEB_CONTAINER_ID" "$ARKEN_REVIEW_EDGE_CONTAINER_ID" "$ARKEN_REVIEW_API_IMAGE_ID" "$ARKEN_REVIEW_PG_IMAGE_ID" "$ARKEN_REVIEW_WEB_IMAGE_ID" "$ARKEN_REVIEW_EDGE_IMAGE_ID" "$ARKEN_REVIEW_NETWORK_ID" "$ARKEN_REVIEW_MEDIA_SOURCE" "$ARKEN_REVIEW_MEDIA_CONTAINER_PATH" "$ARKEN_REVIEW_EXPECTED_DATABASE_HOST" "$ARKEN_REVIEW_EDGE_CONFIG_SOURCE" "$ARKEN_REVIEW_EDGE_CONFIG_CONTAINER_PATH" "$ARKEN_REVIEW_EDGE_EXTRA_NETWORK_IDS") || die 'cloned-review container, network, image, database, or bind-mount identity did not match'
  server_id=$ARKEN_REVIEW_API_CONTAINER_ID
  pg_id=$ARKEN_REVIEW_PG_CONTAINER_ID
  web_id=$ARKEN_REVIEW_WEB_CONTAINER_ID
  edge_id=$ARKEN_REVIEW_EDGE_CONTAINER_ID
  database_name=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).databaseName)' "$expected_identity")
  media_container_path=$ARKEN_REVIEW_MEDIA_CONTAINER_PATH
  node - "$ARKEN_REVIEW_RUNTIME_ENV_FILE" "$ARKEN_REVIEW_EXPECTED_DATABASE_HOST" "$database_name" <<'NODE' || die 'review runtime env does not target the inspected application database'
const fs=require('node:fs');
const [file,host,database]=process.argv.slice(2);
const entries=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(line=>/^\s*(?:export\s+)?DATABASE_URL\s*=/.test(line));
if(entries.length!==1) process.exit(2);
const raw=entries[0].replace(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*/, '').replace(/^(['"])(.*)\1\s*$/, '$2');
let url; try{url=new URL(raw);}catch{process.exit(3)}
let name; try{name=decodeURIComponent(url.pathname.slice(1));}catch{process.exit(4)}
if(url.hostname!==host||name!==database) process.exit(5);
NODE
fi
# Reject symlink/junction ancestors as well as a symlink at the leaf. Native
# Node paths preserve Windows junction semantics in cloned local review mode.
assert_canonical_sources() {
  node - "$@" <<'NODE' || die 'review source path contains a symlink, junction, or noncanonical ancestor'
const fs=require('node:fs'), path=require('node:path');
try {
 for(const input of process.argv.slice(2)) {
  const absolute=path.resolve(input);
  for(let current=absolute;;current=path.dirname(current)) {
   const stat=fs.lstatSync(current);
   if(stat.isSymbolicLink()) process.exit(2);
   const real=fs.realpathSync.native(current);
   const norm=p=>process.platform==='win32'?path.normalize(p).toLowerCase():path.normalize(p);
   if(norm(real)!==norm(current)) process.exit(3);
   if(path.dirname(current)===current) break;
  }
 }
} catch { process.exit(4); }
NODE
}

if [[ $CAPTURE_MODE == cloned-review ]]; then
  assert_canonical_sources "$ARKEN_REVIEW_RUNTIME_ENV_FILE" "$ARKEN_REVIEW_MEDIA_SOURCE" "$ARKEN_REVIEW_EDGE_CONFIG_SOURCE"
else
  assert_canonical_sources "$COMPOSE_FILE" "$ENV_FILE"
fi

# Capture the safe health fields while the API container is still running.
health_json=$(docker exec "$server_id" node -e 'const p=process.env.PORT||4100;fetch(`http://127.0.0.1:${p}/healthz`).then(async r=>{if(!r.ok)process.exit(2);const j=await r.json();console.log(JSON.stringify({buildRevision:j.buildRevision,schemaVersion:j.schemaVersion}))}).catch(()=>process.exit(3))') || die 'health metadata unavailable'
node -e 'const h=JSON.parse(process.argv[1]); if(!h.buildRevision || h.schemaVersion===undefined || h.schemaVersion===null) process.exit(1)' "$health_json" || die 'health metadata omitted revision or schema version'
compose_rendered=
runtime_env_path=
if [[ $CAPTURE_MODE == compose ]]; then
  compose_rendered=$("${dc[@]}" config --format json --no-env-resolution) || die 'Compose config could not be rendered'
  runtime_env_path=$(printf '%s' "$compose_rendered" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{const c=JSON.parse(s),v=c.services?.server?.env_file,a=Array.isArray(v)?v:[v];if(a.length!==1||!a[0])process.exit(2);const e=a[0],p=typeof e==="string"?e:e.path;if(!p)process.exit(3);const path=require("node:path");process.stdout.write(path.isAbsolute(p)?p:path.resolve(process.argv[1],p))}catch{process.exit(4)}})' "$APP_ROOT") || die 'server runtime env-file path could not be resolved'
  [[ -f $runtime_env_path && ! -L $runtime_env_path ]] || die 'server runtime env file is missing or a symlink'
fi
if [[ -n ${ARKEN_CAPTURE_CONFIG_FILES:-} ]]; then
  declare -A config_basenames=()
  while IFS= read -r f; do
    [[ -z $f ]] && continue
    [[ $f == /* && -f $f && ! -L $f ]] || die 'an additional config path must be absolute, regular, and not a symlink'
    base=$(basename "$f")
    [[ -z ${config_basenames[$base]+x} ]] || die 'additional config paths have colliding basenames'
    config_basenames[$base]=1
  done <<< "$ARKEN_CAPTURE_CONFIG_FILES"
fi
# Validate proof input before API downtime; explicit overrides never fall back.
counts_sql=${ARKEN_DATABASE_COUNTS_SQL:-$APP_ROOT/infra/backup/database-counts.sql}
if [[ -z ${ARKEN_DATABASE_COUNTS_SQL:-} && ! -f $counts_sql ]]; then
  counts_sql=$(cd "$(dirname "$0")" && pwd)/database-counts.sql
fi
[[ -f $counts_sql && -s $counts_sql && ! -L $counts_sql ]] || die 'database counts SQL must be a nonempty regular non-symlink file'

assert_canonical_sources "$counts_sql"
if [[ $CAPTURE_MODE == compose ]]; then assert_canonical_sources "$runtime_env_path"; fi
if [[ -n ${ARKEN_CAPTURE_CONFIG_FILES:-} ]]; then
  while IFS= read -r f; do
    [[ -z $f ]] || assert_canonical_sources "$f"
  done <<< "$ARKEN_CAPTURE_CONFIG_FILES"
fi
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
  if [[ $CAPTURE_MODE == compose ]]; then "${dc[@]}" start server >/dev/null || { printf '%s\n' 'WARNING: could not restart server; operator action required' >&2; return 1; }
  else docker start "$server_id" >/dev/null || { printf '%s\n' 'WARNING: could not restart API container; operator action required' >&2; return 1; }; fi
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

# Stage private configuration while the API is still live; captured copies form the tuple used after quiesce.
mkdir -m 700 "$work/config" "$work/images" "$work/media"
# Runtime credentials and deployment configuration are staged privately and are
# included only inside the encrypted Restic snapshot. They are never emitted.
install -m 600 "$ENV_FILE" "$work/config/runtime.env"
if [[ $CAPTURE_MODE == compose ]]; then install -m 600 "$COMPOSE_FILE" "$work/config/compose.yml"; fi
# Preserve server env_file references while interpolating the rest of the private
# deployment config. Default Compose resolution can inline env_file values and
# remove the path needed to capture the original runtime env file.
if [[ $CAPTURE_MODE == compose ]]; then
printf '%s' "$compose_rendered" > "$work/config/compose-rendered.private.json"
chmod 600 "$work/config/compose-rendered.private.json"
install -m 600 "$runtime_env_path" "$work/config/server-runtime.env"
for f in "$APP_ROOT/compose.activation.override.yml" "$APP_ROOT/manifest.pending.json" "$APP_ROOT/image-build-manifest.json" "$APP_ROOT/software-members.json"; do
  [[ ! -f $f ]] || install -m 600 "$f" "$work/config/$(basename "$f")"
done
else
  install -m 600 "$ARKEN_REVIEW_EDGE_CONFIG_SOURCE" "$work/config/edge-nginx.conf"
fi
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

# Stop only the API container, and only after the explicit interlock above.
stopped_by_us=true
if [[ $CAPTURE_MODE == compose ]]; then "${dc[@]}" stop server >/dev/null; else docker stop "$server_id" >/dev/null; fi


if [[ $CAPTURE_MODE == compose ]]; then
  server_image_id=$(docker inspect --format '{{.Image}}' "$server_id")
  pg_image_id=$(docker inspect --format '{{.Image}}' "$pg_id")
  web_image_id=unavailable
  if [[ -n $web_id ]]; then web_image_id=$(docker inspect --format '{{.Image}}' "$web_id"); fi
  edge_image_id=unavailable
else
  server_image_id=$ARKEN_REVIEW_API_IMAGE_ID
  pg_image_id=$ARKEN_REVIEW_PG_IMAGE_ID
  web_image_id=$ARKEN_REVIEW_WEB_IMAGE_ID
  edge_image_id=$ARKEN_REVIEW_EDGE_IMAGE_ID
fi
docker save --output "$work/images/server.tar" "$server_image_id"
docker save --output "$work/images/postgres.tar" "$pg_image_id"
if [[ $web_image_id != unavailable ]]; then docker save --output "$work/images/web.tar" "$web_image_id"; fi
if [[ $edge_image_id != unavailable ]]; then docker save --output "$work/images/edge.tar" "$edge_image_id"; fi

# Container is quiesced, so database and mounted media form a coherent capture.
if [[ $CAPTURE_MODE == compose ]]; then docker exec "$pg_id" sh -ec 'pg_dump --username "$POSTGRES_USER" --dbname "$1" --format=custom' sh "$database_name" > "$work/database.dump"
else docker exec "$pg_id" sh -ec 'pg_dump --username "$POSTGRES_USER" --dbname "$1" --format=custom' sh "$database_name" > "$work/database.dump"; fi
[[ -s $work/database.dump ]] || die 'database dump is empty'

if [[ $CAPTURE_MODE == compose ]]; then
  docker exec -i "$pg_id" sh -ec 'psql --username "$POSTGRES_USER" --dbname "$1" --no-align --tuples-only --field-separator="|"' sh "$database_name" < "$counts_sql" > "$work/database-counts.txt"
  docker exec "$pg_id" sh -ec 'psql --username "$POSTGRES_USER" --dbname "$1" --no-align --tuples-only --command="SHOW server_version"' sh "$database_name" > "$work/postgres-version.txt"
  docker exec "$pg_id" sh -ec 'psql --username "$POSTGRES_USER" --dbname "$1" --no-align --tuples-only --field-separator="|" --command="SELECT id::bigint, hash, created_at::bigint FROM drizzle.\"__drizzle_migrations\" ORDER BY created_at, id"' sh "$database_name" > "$work/migration-ledger.txt"
else
  docker exec -i "$pg_id" sh -ec 'psql --username "$POSTGRES_USER" --dbname "$1" --no-align --tuples-only --field-separator="|"' sh "$database_name" < "$counts_sql" > "$work/database-counts.txt"
  docker exec "$pg_id" sh -ec 'psql --username "$POSTGRES_USER" --dbname "$1" --no-align --tuples-only --command="SHOW server_version"' sh "$database_name" > "$work/postgres-version.txt"
  docker exec "$pg_id" sh -ec 'psql --username "$POSTGRES_USER" --dbname "$1" --no-align --tuples-only --field-separator="|" --command="SELECT id::bigint, hash, created_at::bigint FROM drizzle.\"__drizzle_migrations\" ORDER BY created_at, id"' sh "$database_name" > "$work/migration-ledger.txt"
fi
[[ -s $work/postgres-version.txt && -s $work/migration-ledger.txt ]] || die 'PostgreSQL version or migration ledger proof is missing'
docker cp "$server_id:$media_container_path/." "$work/media/" >/dev/null

# Read only public health metadata was captured before stopping; never inspect environment.
if [[ $CAPTURE_MODE == cloned-review ]]; then
  capture_identity=$expected_identity
else
  capture_identity='{}'
fi
image_metadata=$(node -e 'const [s,p,w,e]=process.argv.slice(1); console.log(JSON.stringify({server:s,postgres:p,web:w,edge:e}))' "$server_image_id" "$pg_image_id" "$web_image_id" "$edge_image_id")
node - "$work" "$APP_ROOT" "$health_json" "$image_metadata" "$capture_identity" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [root,app,health,image,identity]=process.argv.slice(2), h=JSON.parse(health), imgs=JSON.parse(image), id=JSON.parse(identity);
const hash=p=>new Promise((resolve,reject)=>{const h=crypto.createHash('sha256'),s=fs.createReadStream(p);s.on('error',reject);s.on('data',chunk=>h.update(chunk));s.on('end',()=>resolve(h.digest('hex')));});
const files=[]; const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isSymbolicLink())throw new Error();if(e.isDirectory())walk(p);else if(e.isFile()&&path.basename(p)!=='capture-manifest.json')files.push({path:path.relative(root,p).split(path.sep).join('/'),bytes:fs.statSync(p).size});else if(!e.isFile())throw new Error();}}; try{walk(root)}catch{process.exit(3)}
const git=(require('node:child_process').spawnSync('git',['-C',app,'rev-parse','HEAD'],{encoding:'utf8'}));
(async()=>{for(const f of files)f.sha256=await hash(path.join(root,f.path));const manifest={format:'arken-service-snapshot-v1',captureMode:process.env.ARKEN_CAPTURE_MODE??'compose',capturedAt:new Date().toISOString(),target:id.containerIds?{containerIds:id.containerIds,networkId:id.networkId,databaseName:id.databaseName,mediaSource:id.mediaSource,mediaContainerPath:id.mediaContainerPath,edgeConfigSource:id.edgeConfigSource,edgeConfigContainerPath:id.edgeConfigContainerPath}:app,sourceRevision:git.status===0?git.stdout.trim():'unknown',buildRevision:h.buildRevision??'unknown',schemaVersion:h.schemaVersion??'unknown',images:imgs,files};fs.writeFileSync(path.join(root,'capture-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});})().catch(()=>process.exit(4));
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
