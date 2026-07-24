# Release candidate preparation - feature base `b806d78` (2026-07-24)

## Status and scope

- **Feature base:** `b806d78bb94810dff16ffd79d515af66c4664021`.
- **Final candidate:** `RELEASE_SHA` is intentionally unresolved until the UIX-271 release-control changes are committed. Replace it with that clean 40-character commit SHA before any live step.
- **Scope:** merged UIX-224, UIX-244 and UIX-255; this RC includes the TOKEN media post-commit safety fix and exact token preview/generation parity.
- **Authorization:** this document is planning and evidence structure only. It does **not** inspect, assert, or authorize any live production state. Production deployment requires the explicit **Production GO** in the final gate below.
- **Known follow-up (non-blocking):** a hard process termination between writing a media file and committing its database transaction can leave an unreferenced file. Normal error paths clean up. Orphan reconciliation remains operational hardening work.

## Historical records

The following files are historical snapshots, not statements about the current host, deployed revision, backup freshness, or readiness. Do not use their production observations as a release gate for this RC:

- [`release-candidate-2026-07-19.md`](./release-candidate-2026-07-19.md)
- [`production-work-report-2026-07-19.md`](./production-work-report-2026-07-19.md)
- [`publish-readiness-2026-07-19.md`](./publish-readiness-2026-07-19.md)
- dated operational notes in [`operations.md`](./operations.md)

## Release invariants

| Item                   | Required value/evidence                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Candidate SHA          | `RELEASE_SHA`: the clean 40-character commit containing feature base `b806d78` plus UIX-271 release-control changes               |
| Previous live revision | `PREVIOUS_SHA`: a required, recorded 40-character SHA obtained during the live preflight; never infer it from a historical report |
| Database migrations    | all repository migrations `0000` through `0021` apply in order                                                                    |
| Application schema API | `2` (`EXPECTED_SCHEMA_VERSION=2`; distinct from migration count)                                                                  |
| Backup identity        | one newly created, exact restic snapshot ID � never `latest`                                                                      |
| Restore evidence       | isolated rehearsal of that exact snapshot at the candidate SHA, with `test-results/restore/runner.json` passed                    |
| Image identity         | record immutable image digests for `postgres`, `server`, and `web` both before change and after the candidate starts              |

## Local verification recorded during preparation

- workspace typecheck, production build and lint: pass;
- Vitest: 62 files / 327 tests: pass;
- TOKEN preview parity unit suite: 2 files / 7 tests: pass;
- Chromium GM and PLAYER token-generator gate: 2/2 pass.

These results were recorded against the feature base and release-control worktree. Re-run the complete local gate at final `RELEASE_SHA`; local results do not replace host preflight, backup/restore, browser rehearsal, or live post-deploy checks.

## Controlled live procedure

Run only from a clean checkout at the candidate and only after a human operator opens a release window. Keep a timestamped operator log containing every value marked **record** below.

### 1. Freeze identity and collect reversible state

```sh
export RELEASE_SHA=<final-clean-40-character-uix-271-commit>
export EXPECTED_BUILD_REVISION="$RELEASE_SHA"
export EXPECTED_SCHEMA_VERSION=2
export PREVIOUS_SHA=<live-40-character-sha>
test "$(git rev-parse HEAD)" = "$EXPECTED_BUILD_REVISION"
test -z "$(git status --porcelain --untracked-files=normal)"
test "${#PREVIOUS_SHA}" -eq 40
```

Before changing the stack, **record** `PREVIOUS_SHA`, current `/healthz` JSON, Compose status, free disk, and the resolved digests of the currently running `postgres`, `server`, and `web` images. A suitable digest capture is:

```sh
docker compose ps -q postgres server web | xargs -r docker inspect \
  --format '{{.Name}} {{.Image}} {{index .RepoDigests 0}}'
```

If a locally-built image has no `RepoDigests` value, record its immutable image ID (`.Image`) and the source candidate SHA; do not substitute a mutable tag as release evidence.

### 2. Backup and isolated restore

Load root-owned restic credentials; credentials must not enter Git, the application `.env`, or the operator log. Run `restic check`, then create a fresh backup with `infra/backup/backup.sh` and **record** its exact emitted snapshot ID.

```sh
export VERIFIED_BACKUP_SNAPSHOT_ID=<fresh-exact-snapshot-id>
test "$VERIFIED_BACKUP_SNAPSHOT_ID" != latest
export ARKEN_RESTORE_CONFIRM=isolated-clean-target
export RESTORE_BUILD_REVISION="$EXPECTED_BUILD_REVISION"
export SNAPSHOT_ID="$VERIFIED_BACKUP_SNAPSHOT_ID"
corepack pnpm restore:rehearse
```

Gate: `test-results/restore/runner.json` must show a passing result for the exact snapshot and candidate SHA, checksums, pre-migration ledger prefix, database counts, media, cleanup, post-migration exact ledger `0000..0021`, health and schema API `2`. Failure stops the release.

### 3. Build, start and poll readiness

The deploy script additionally requires the exact passing restore revision:

```sh
export RESTORE_REHEARSAL_REVISION="$EXPECTED_BUILD_REVISION"
sh infra/deploy/build-and-start.sh
```

Do not treat `docker compose up -d` as readiness. Poll until all services are healthy/running and `/healthz` is authoritative; use a bounded timeout and retain output on failure:

```sh
deadline=$(( $(date +%s) + 180 ))
while :; do
  docker compose ps -a
  health="$(curl -fsS https://arken.uixray.tech/healthz 2>/dev/null || true)"
  printf '%s\n' "$health"
  printf '%s' "$health" | grep -q '"status":"ok"' && \
  printf '%s' "$health" | grep -q '"database":"ok"' && \
  printf '%s' "$health" | grep -q "\"buildRevision\":\"$EXPECTED_BUILD_REVISION\"" && \
  printf '%s' "$health" | grep -q '"schemaVersion":2' && break
  test "$(date +%s)" -lt "$deadline" || { echo 'readiness timeout' >&2; exit 1; }
  sleep 5
done
```

After readiness, **record** the new service image digests/IDs using the same `docker inspect` command, the authoritative `/healthz` response, and authenticated diagnostics. Verify migrations `0000..0021` are represented by the migration ledger; schema API must still be `2`.

### 4. Human release gates

Before opening traffic, a named operator must confirm:

- authentication/GM exchange; player access and authorization boundaries;
- WebSocket/realtime connection; image and audio upload; persistence through `docker compose restart postgres server web`;
- token creation, crop/frame parity, resize/stack behavior, chat/rolls, grid/fog, character editing, scene/music continuity;
- a 30�45 minute GM + 6 player rehearsal in Chrome, Firefox and Edge;
- rollback inputs (`PREVIOUS_SHA`, exact backup snapshot, before/after image identities) are complete and readable.

Any failed, skipped, or inconclusive gate is a **no-go**.

## Rollback decision path

Rollback is mandatory when migration, readiness, health, authentication, realtime, persistence, or the human gate fails.

1. Stop application writes; preserve bounded logs and the failed candidate evidence.
2. Stop the failed stack. Do not run gameplay reset.
3. Check out `PREVIOUS_SHA`, confirm a clean checkout, rebuild/start it with `BUILD_REVISION=$PREVIOUS_SHA`.
4. If the failed deployment changed persisted data, first use the exact pre-deploy snapshot in an isolated restore rehearsal; production data recovery is a separate human-approved recovery action.
5. Poll authoritative health for `PREVIOUS_SHA` and schema API `2`; verify authentication, media, realtime and persistence before reopening traffic.
6. Record outcome, image identities and the decision owner. A rollback does not convert an incomplete restore rehearsal into evidence.

## Final gate � explicit Production GO

**Production deployment is prohibited until a named release owner writes `Production GO` after all boxes in [`release-preflight-checklist-b806d78-2026-07-24.md`](./release-preflight-checklist-b806d78-2026-07-24.md) are checked.**

The GO record must include: candidate SHA, `PREVIOUS_SHA`, exact snapshot ID, restore-report path/result, before/after image digests (or IDs where no digest exists), readiness response, human rehearsal result, timestamp, and release-owner name. Silence, a PR merge, or this document is not GO.
