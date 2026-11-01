# UIX-407: persistent client performance telemetry

## Contract

- Only a visible tab with an authenticated game snapshot collects. A visible idle tab counts; this is not a player-activity detector. Login, hidden tabs and closed sessions do not heartbeat.
- First heartbeat on the next one-minute tick, then once per five minutes. It replaces that minute's notable report: at most 60 performance requests/hour/tab, leaving room in the existing 120/hour shared endpoint budget. Multiple tabs sharing a rate-limit key can still exhaust that budget.
- Each heartbeat contains the actual **client bundle** revision, random per-tab/authentication session UUID, observer states (`active`, `unsupported`, `failed`), window duration, bounded measurements, heartbeat sequence and cumulative failed-send count. No user/account/membership/campaign identifier, names, messages or character content in the persistent journal. Old clients' optional scene UUID/role remain compatible.
- Heartbeat counters cover the period since the previous heartbeat or visibility/session reset. Minute performance windows overlap them: **do not add both**. Visibility transitions reset observation windows and disconnect observers; stale buffered samples are excluded. Sequence gaps/failures are evidence of missing delivery, not proof of a slow game.
- No below-threshold interactions means no measured slow interactions, not proof that every action was fast. An unsupported/failed observer is not a healthy measurement. Browser long tasks alone do not diagnose the cause of a socket disconnect.
- JSONL writes are serialized and synced before the route acknowledges `persisted:true`. A configured writer failure returns 503, increments the client's failure counter, and emits a throttled operational warning; gameplay stays available. No retry queue for lost samples.
- Unconfigured local persistence remains log-only (`persisted:false`) and warns at startup. The client counts that as failed durable delivery, not success.

## Storage

Dedicated host mount, unrelated to media, DB and release directories. 4 MiB segments, 64 MiB total cap, up to 14 days retention (older segments removed first; size pressure may shorten history). Cleanup runs on startup, append and hourly, including idle periods. Only matching regular journal files are pruned; other files/symlinks are untouched. Private new directories/files (0700/0600), one writer process per directory. No public download/API endpoint.

Default telemetry free-space floor is **3 GiB**, independent of the existing media-upload floor. Reserve check is best effort: other writers can consume free space concurrently. A full/unwritable disk does not falsely acknowledge persistence. New process/failure starts a new segment; an old partial line is counted by the report, never concatenated with a new record. Abrupt machine loss can still affect the filesystem; this is not a backup system.

## Apply at the next owner-authorized publication

This implementation alone does not change production.

1. Pin the artifact revision. Web build must receive `BUILD_REVISION=<exact 40-character SHA>` (manual `release-images` build and root compose now pass it). Without it the browser reports `unknown`, never the newer server revision on an old tab.
2. Set an absolute `PERFORMANCE_LOG_HOST_PATH=/opt/arken-space/telemetry`, outside `/opt/arken-space/releases` and outside media/backups. Create the private directory with permissions for the actual container UID; do not change media ownership or existing storage.
3. Copy `infra/compose.performance.yml` to the stable production config directory and include it **last** in every release/rollback compose invocation, after the current base and image override. The production base is pinned outside this repository; updating root compose alone does NOT configure it. Preserve this override during future publications.
4. The override adds only `PERFORMANCE_LOG_DIR`, `PERFORMANCE_MIN_FREE_DISK_BYTES` (default 3221225472), and the telemetry bind mount to `server`. Inspect the resolved service diff during authorized release; retain DB/media/ports/images and existing release settings. Do not run `down -v` or prune the host journal. On rollback to an old image the files remain but that image cannot write the new journal/heartbeat.
5. Account for up to 64 MiB additional journal storage in the release budget, in addition to the required 3 GiB reserve. Do not lower the reserve to make a release fit.
6. Post-publication acceptance, only within authorized operational checks: a real game produces a persisted heartbeat; inspect actual mounted host file, exact client/server revision and observer state. Recreating the server with the same mount retains earlier records. Production recreation is not part of this local implementation.

Local opt-in: set `PERFORMANCE_LOG_DIR` to a dedicated directory. Local default is disabled. Do not configure multiple replicas to write the same directory.

## Operator report (read-only)

`node scripts/report-client-performance.mjs /opt/arken-space/telemetry 24`

Run the script where the directory is accessible (e.g. copy the script to the host during an authorized release). The last argument is the lookback in hours, max 336. It reads only journal segments, never mutates them.

- `collecting-no-measured-delays`: recent persisted heartbeat, both observers active, positive measured window, no threshold delay in that heartbeat/recent notable records. This is scoped measurement, not a global health verdict.
- `collecting-measured-delays`: recent heartbeat and measured threshold delays.
- `collecting-limited-observers`: heartbeat arrived, one or both observer types unavailable/failed. Inspect numeric measurements from supported observers separately.
- `no-recent-heartbeat`: no heartbeat in ten minutes. Could be hidden/closed/logout, old client, connectivity or persistence failure; cannot distinguish these from absence alone.
- Empty sessions: no data. `legacyWindows` retains the count of older uncorrelated records. `reportedSendFailures`, `heartbeatSequenceGaps`, unknown revision, and `malformedLines` must be considered before interpreting coverage.

## Verification state of this pool

Regression sources added for journal recreation/rotation/retention/reserve/partial lines, heartbeat scheduling/session/visibility/capability/failure reporting, strict schema and operator states. No tests, CI, build, qualification or new backup requested or executed. Source review is not runtime PASS. Publication and real-game acceptance remain pending.
