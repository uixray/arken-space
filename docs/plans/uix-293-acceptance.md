# UIX-293 — acceptance evidence, 2026-09-17

Candidate under verification: `843a8812dc00f1edaf2ba1445e20ddffcf8357ed`.
Original Linear issue reread live; status remains In Progress. This document is
an evidence map, not an issue closure or production acceptance certificate.

## Original criteria

| Requirement                                                                      | Implementation and evidence                                                                                                                                                                                                         | Scope / remaining limit                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview, name, type, size, usage status and locations                            | `MediaPanel.tsx`: image thumbnails, Russian kind labels, file metadata, explicit usage lookup and locations. `AssetAudioPreview.tsx`: local on-demand audio. Component pool 20/20; catalog browser 4/4 at desktop/narrow widths.    | Usage status is fetched explicitly, not an additional lifecycle-status field. Audio browser gate is GM-only, mock HTTP/socket with real native decoding.                                  |
| Delete unused files                                                              | `asset-usage.ts` DELETE route; HTTP integration checks response, missing metadata/content and removed physical blob; MediaPanel confirms before delete.                                                                             | Real Fastify injection/PGlite/temp files; not production traffic.                                                                                                                         |
| Block deletion of used files                                                     | Dependency resolver and deletion policy, HTTP 409 for referenced content; MediaPanel omits force-delete. Component tests cover cancellation and server rejection.                                                                   | Audit provenance is retained history, intentionally non-blocking, rather than an active usage.                                                                                            |
| Replace without breaking links                                                   | Atomic PUT, immutable action/version intent, explicit review/commit, conflict re-review, exact retry. Integration compares complete relation rows and blob inventory; rollback trigger rejects audit insertion and proves recovery. | IDs and canonical content paths stay stable; version query changes intentionally so mounted consumers reload. Old version URLs serve current authorized content, not historical versions. |
| ACL on usage, replacement, deletion, direct content                              | Integration covers same/foreign campaign, GM/PLAYER, anonymous content, GET/HEAD and conditional hidden content. Usage policy strips GM-only details for players.                                                                   | PLAYER absence from Files navigation is in `concept.spec.ts`, not the new GM replacement/catalog suites.                                                                                  |
| Audited operations and API/integration tests                                     | `asset-lifecycle-http.integration.test.ts`: audit receipt, action reuse/replay, safe public payload, rollback and cleanup; 7/7 prior focused gate.                                                                                  | Focused gate used a temporary source alias before package build. The current project gate rebuilds workspace packages before tests; its result is recorded separately.                    |
| Scene, token definition/placement, character, story media and audio dependencies | HTTP replacement fixture includes scene/world map, token definition + placement, portrait/gallery, world-content cover/media and audio track; full relation rows remain equal.                                                      | Story journal media has a separate storage model; see below. Do not silently label world-content tests as journal-media tests.                                                            |

## Dependency interpretation checked against current schema

- Token appearance is owned by `tokenDefinitions.defaultAssetId`. Both snapshot
  and realtime projection use that value, not the legacy placement `assetId`.
  Existing replacement coverage retains both definition and placement rows.
- `worldContent` cover and `worldContentMedia` refer directly to `assets` and
  are included in the resolver and integration tests.
- Journal `storyPostMedia.contentId` references
  `chatAttachmentUploads(campaignId, contentId)`, not `assets`. The asset
  replacement fixture therefore does **not** prove journal-upload lifecycle.
  Do not expand the API to unrelated private attachment storage merely to make
  a test pass. Original “story media” acceptance must distinguish these models
  before a claim that every named dependency is covered.
- No historical blob browser/version restore requirement has been added.

## Browser receipts already obtained

Relative to the local artifact root
`C:\Users\UIXRay\.codex\visualizations\2026\09\16\01a0a7d5-b072-7022-8e9d-4538c0a92b07`:

- `asset-replacement-browser`: GM review/cancel/pending/conflict/retry/success,
  Chrome/Firefox × 1280/390, 4/4; actual new image pixels after version refresh.
- `asset-replacement-http`: 7/7 actual route/database/blob tests.
- `mounted-asset-images`: 4/4 GM/PLAYER Chrome/Firefox; real canvas map/token
  pixels update without replacing the mounted canvas or changing token position.
- `mounted-asset-audio`: 4/4 GM/PLAYER Chrome/Firefox; same audio element reloads,
  decodes and preserves local consent/gain. Same Ogg bytes at all version URLs.
- `catalog-audio-preview`: 4/4 GM Chrome/Firefox × 1280/390; single local preview,
  no preload/autoplay, stopping on switch, no game writes. Native `play()` is
  invoked by browser evaluation: native control gestures remain unverified.

These initial receipts are scoped, not physical device/Safari acceptance or a
production release. The later live audio gate below connects browser and server.

## Consolidated gate

See `asset-project-gate` artifact folder for exact commands, logs and outcomes.
No existing GitHub run was restarted. Current branch had no listed CI runs.
The gate is sequential with one Vitest worker and a 1 GiB Node heap limit.
Raw lint can also see ignored local `.tmp-*` harnesses; any candidate-only lint
exclusion must remain explicit, limited to untracked harnesses and out of the
committed lint configuration. Do not call the raw lint green if it failed.

No push/deploy or Linear mutation is part of this gate. Protected untracked
`tests/e2e/selection-recovery.spec.ts` is not included in the candidate.

### Consolidated results

- Generated tokens, workspace build and full project typecheck passed. Three
  release shell scripts passed `sh -n` (syntax only, never executed).
- Raw lint failed on 24 errors in seven ignored `.tmp-*` QA harnesses. After
  confirming none were tracked, candidate lint passed with five warnings;
  committed lint rules were not changed. This is not a clean raw lint claim.
- Format check initially reported 20 files. Formatting repaired them; six had
  actual Git-normalized diffs, the others only line-ending differences. Each of
  the six was verified equal to Prettier applied to its HEAD contents. Whole
  format check then passed; protected selection test unchanged.
- Full Vitest with one worker: **266 passed files / 2 failed files; 2319 passed
  tests / 2 failed tests**, 859.71 seconds. No source edits during this run.
- Failures: token generator expected an unversioned content URL; wiring guard
  expected direct projection rather than the current bulk-over-single projection.
  Repairs retain exact assertions: version derived independently from stored
  blob key plus authenticated GET/ETag/exact bytes and replay URL; wiring must
  connect both projection layers in order. See `repair-tests.log` for the focused
  follow-up; the failed full-run receipt is retained, not relabeled green.
- Build still reports the existing large main chunk (1085.63 kB minified,
  320.07 kB gzip). This is a performance follow-up, not a reason to suppress the
  warning or claim the broader performance goal complete.

At the consolidated gate, browser-to-server replacement was still unverified;
the later live audio gate below closes that gap for AUDIO only. Native audio-control
gestures, physical devices/Safari and exact-candidate remote CI/release remain
unverified. The independent journal attachment model is recorded above rather
than disguised as covered by world-content tests.

Focused follow-up: both failing files passed **17/17 in 29.53s**. No product
runtime was changed to satisfy them. An extra standalone typecheck of the HTTP
suite needed the Fastify multipart augmentation (normally loaded by the server
entry point) and surfaced two pre-existing typing issues in the race assertion:
UUID-array inference and an indexed response known to exist after the preceding
[200,409] assertion. Only type annotations/non-null assertion were adjusted;
test runtime is unchanged. No second full suite or build was run.

## Real browser-to-server audio gate

`tests/e2e/asset-replacement-live.spec.ts`: Chrome and Firefox, one worker,
**2/2 PASS in 30.6s**, desktop, no retries. Base revision `c9e9df0`; product runtime
unchanged. The test uses campaign-fixture, real GM entry and player invitation,
actual cookies/API/PostgreSQL/files/socket, no mocked routes or socket messages.
Initial audio is uploaded via authenticated API and selected via GM music UI.
Replacement itself uses Files → Replace → review actual audio usage → confirm.

The connected player receives the versioned source in the **same mounted audio
element**, decodes it without reload, remains paused at saved gain zero; campaign
audio state stays unchanged. Authenticated content has the expected ETag and exact
Ogg SHA-256. Reload retains the new source and local consent=false/volume=0.
The payload before/after is the same existing valid Ogg; this proves real blob
replacement/delivery and source refresh, not different-song audibility.

The first run failed because the new test assumed automatic dialog dismissal.
Actual intended UI keeps the success message and explicit Close button; test was
corrected to verify that message and close it. No production code changed.
The initial failure receipt is retained; Firefox did not run in that failed round.

Safety and reproducibility:

- Dedicated opt-in `ARKEN_ASSET_LIVE_GATE=isolated-loopback` plus loopback baseURL;
  skipped outside that explicit environment, not counted as ordinary CI coverage.
- Installed PG18.1, existing **stopped isolated** `request-server-gate/pgdata`,
  new timestamped synthetic database per run, ports15439/14109/5189 all loopback.
  No access to the user's PostgreSQL service or production database.
- Runner checks free ports/cluster ownership, migrates the isolated database,
  starts current API source with loopback-only entry and Vite proxy; finally stops
  only owned processes/cluster and removes its exact temporary entry file.
- Artifact folder `asset-live-gate` contains `run.ps1`, round environments,
  reports/traces and retained loopback entry. Server logs can contain synthetic
  credentials: keep local, do not attach externally. Test databases/media retained.
- This is not server-restart/persistence-restore, physical mobile/Safari or image
  replacement browser-to-server evidence. Earlier API/database and mocked-image
  browser receipts remain separate. No broad rerun, CI, publication or release.

## Real map-image replacement and connected renderer — 2026-09-17

Closed the MAP-specific browser-to-server gap with an additional scenario in
`tests/e2e/asset-replacement-live.spec.ts`. Existing audio test unchanged and not
repeated. Actual source API, isolated PG18.1, real cookies/files/socket, and the
retained production web build from ecf66e6 (`compact-sections-breakpoint/fixed/dist`).
Four runtime payload hashes verified; no rebuild or mocked transport.

GM uploads a synthetic cyan PNG, links it to the active scene and reveals that
scene. A separate authenticated PLAYER context sees more than1000 cyan pixels
on the composited canvas. GM uses Files → Replace → New image → Review usage
(actual scene name) → Confirm, uploading a different magenta PNG. Without any
PLAYER reload, cyan pixels disappear and more than1000 magenta pixels appear.
The asset ID/name and entire projected scene DTO including mapAssetId/revision
remain unchanged; only the asset version URL changes. Canonical served WebP has
the same SHA256 for GM and PLAYER, differs from the old content, and ETag agrees
with the replacement acknowledgement. PLAYER reload preserves new pixels and
canonical bytes. Firefox final map screenshot visually inspected.

**2/2PASS22.225s**, Chrome/Firefox, one worker, retries0/skipped0/flaky0;
pageerrors0. E2E types, scoped ESLint, formatting/diff pass. First run failed in
the new test after successful visible replacement: it compared source PNG bytes
to delivered bytes. Source inspection confirmed storage.ts intentionally converts
images to WebP. Corrected oracle compares canonical content across roles/reload
plus actual pixels; no product changes or weakened normalization. Initial report
and trace retained. A pre-run TypeScript assertion also distinguished browser
Response from APIResponse; no browser run was claimed for that type failure.

Evidence: `map-asset-live/final-results.json`, payload-checks.json, two role-safe
receipts and screenshots, run.ps1; initial-results.json retains the failed oracle.
Temporary server entry removed, owned API/preview/PG stopped, loopback ports
15439/14109/5189 free; unrelated system PostgreSQL still Running. Protected
untracked selection recovery test unchanged. This proves MAP only, not all image
consumers, non-owner ACL, backend restart/backup restore, Safari or device QA.
Existing API ACL/dependency tests and earlier AUDIO evidence remain separate.
No production access, publication, CI/full-suite rerun, Linear write or closure.
