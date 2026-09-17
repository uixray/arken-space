# UIX-293 — acceptance evidence, 2026-09-17

Initial consolidated candidate (historical): `843a8812dc00f1edaf2ba1445e20ddffcf8357ed`.
Later candidate-specific evidence and remaining limits are appended below.
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

## Token definition/placement live image consumer — 2026-09-17

Parameterized the existing real image scenario for MAP and TOKEN rather than
copying the fixture. TOKEN uploads a cyan image, creates a character-linked
placement with its definition, then replaces through GM Files with a different
magenta image after reviewing actual token usage. A connected PLAYER sees the
new token pixels without reload; old cyan pixels disappear. The complete token
DTO is equal before/after (including position, dimensions, revision and control
fields), and the definition's defaultAssetId and full projected DTO are retained.
The scene DTO is also unchanged. Reload preserves token DTO and the new pixels.
Canonical WebP bytes agree for GM/PLAYER and after reload, differ from old
content, and have the acknowledged ETag. This supplements, not replaces, the
previous HTTP relation/permission tests.

Connected pool **4/4PASS35.680s**, MAP/TOKEN × Chrome/Firefox, one worker,
retries0/skipped0/flaky0/pageerrors0. MAP repeated because its test fixture was
refactored, not because the task continued. Existing AUDIO scenario unchanged
and excluded. Product source unchanged, ecf66e6 production dist reused with four
payload hashes checked. E2E tsc/scoped ESLint/Prettier/diff pass; Firefox final
token screenshot visually inspected. No test failures in this pool.

Evidence: image-consumers-live/initial-results.json (successful first run),
payload-checks.json, four image/receipt pairs and run.ps1. Source API5adaf0f,
fresh synthetic isolated PG18.1 database. Owned API/preview/PG stopped, ports
15439/14109/5189 free, unrelated system PostgreSQL Running. Protected untracked
selection test preserved. No production writes, build/full-suite/CI rerun,
publication or Linear mutation. Character portrait/gallery, world-content image
consumers, non-owner ACL and backend restart remain distinct evidence scopes;
journal attachments still have their separate model described above.

## Open character portrait receives replacement — 2026-09-17

Added PORTRAIT to the same real image-consumer fixture. GM assigns an uploaded
portrait to a character; the invited PLAYER opens that character's actual sheet.
The portrait is visible and center-hit-tested before replacement. GM's Files
dialog reviews the character usage and replaces cyan PNG with magenta PNG. The
already open PLAYER sheet receives the versioned image URL and decodes the new
color without reload; the entire projected character DTO, including portrait
link/revision/other fields, is unchanged. After reload and explicitly reopening
the sheet, both portrait and character DTO remain correct. Canonical WebP bytes
match for both roles and after reload; source PNG is not incorrectly equated to
server-normalized WebP.

**6/6PASS50.020s**, MAP/TOKEN/PORTRAIT × Chrome/Firefox, one worker,
retries0/skipped0/flaky0/pageerrors0. MAP/TOKEN remain in this connected pool
because the common rendered-consumer oracle changed; AUDIO was not repeated.
Portrait oracle reads decoded pixels of the actual visible IMG at its rendered
dimensions, not hidden React state; map/token use composited canvas layers.
Firefox portrait-only screenshot inspected, not a claim of complete sheet visual
acceptance. E2E tsc/scoped ESLint/Prettier/diff pass. No red in this pool.

Evidence: portrait-consumer-live/initial-results.json (successful first run),
payload-checks.json, six JSON receipts, portrait screenshots and run.ps1. Runtime
ecf66e6 dist reused unchanged; source API df9f567, fresh isolated PG18.1 database.
Owned services stopped, ports15439/14109/5189 absent, unrelated PostgreSQL still
Running, protected untracked selection test unchanged. No build/CI/fullsuite,
production/publication or Linear writes. Gallery, resource-image and world-content
consumers are not established by this portrait-specific result; ACL/restart/device
acceptance and separate journal attachment model retain their previous limits.

## Gallery access and mounted image replacement repair — 2026-09-17

The new real GALLERY case exposed an actual earlier defect: an invited character
owner could list OWNER_GM gallery metadata but received an unavailable image.
Content authorization relies on snapshot.assets, which omitted gallery-only
references. Snapshot now loads gallery rows once per campaign and projects asset
IDs with the existing canViewCharacterMedia policy, filtering detached/foreign
rows and preserving OWNER_GM/PARTY/GM_ONLY rules. Controller is not owner. This
does not grant all assets to players or change replacement/deletion permissions.

Independent component RED established the second defect: thumbnail and open
viewer ignored current versioned asset URLs. CharacterWorkspace now supplies its
authorized snapshot asset URLs to CharacterMediaGallery. Both consumers use the
current version; image-failure state resets on replacement, not only navigation.
Fallback ID URLs remain for callers without snapshot metadata, still governed by
the content endpoint. Gallery rows, order, captions and visibility are unchanged.

Verification after the connected fix:

- Fresh production web build, four served payload hashes checked; source API
  includes the snapshot fix, synthetic isolated PG18.1, no mocked transport.
- **8/8 browser PASS**: MAP/TOKEN/PORTRAIT/GALLERY × Chrome/Firefox, one worker,
  retries0/skipped0/flaky0. Gallery now initially loads for its owner, open image
  changes cyan→magenta without reload, thumbnail/viewer receive the new URL,
  full gallery rows stay equal before/after/reload. A second real player with
  another character has no asset in bootstrap and GET content returns404.
- Gallery component **11/11PASS**, including red→green version/reset regression
  and unchanged deletion confirmation cases. Snapshot policy+metrics **12/12PASS**
  (bounded Sol task): owner/PARTY/GM positive and nonowner/controller-only,
  GM_ONLY/player, detached and foreign-campaign negatives. These policy negatives
  are helper tests; actual owner/other-player HTTP behavior is additionally covered
  by the browser gate. Not a claim of every role permutation tested over HTTP.
- Server/web/E2E types, scoped lint, formatting and diffcheck PASS. Initial test
  typing used unsupported RTL exact options, corrected before final types check.

First real red is retained as red-results.json; after the fix, an intermediate
run stopped on a test-label mistake (expected character name, actual gallery
caption), corrected without a product change. Final result in
gallery-consumer-live/final-results.json; fixed/dist and its hash manifest,
role-safe receipts, separate other-member-denied receipts and scripts retained.
The manifest's revision is precommit981f10e plus the recorded dirty source diff;
checkpoint records the final commit. Owned API/preview/PG stopped; original
PostgreSQL service and protected selection test untouched. No CI/fullsuite,
publication, production or Linear writes. This new runtime supersedes ecf66e6
for future exact-candidate checks; previous broad menu results remain historical.
Resource/world-content consumers and private journal-upload model are separate.

### Resource image integrity — 2026-09-17

Resource artwork is now included in player snapshots only through already-visible
characters (with a campaign boundary guard). A CHARACTER_RESOURCE dependency is
registered, shown as a character resource in usage, and blocks deletion. Replacing
the canonical asset preserves the JSON imageAssetId and all character counters.

Evidence: focused helper/registry 13 PASS; real PGlite snapshot ACL 1 PASS
(18 unrelated skipped), HTTP lifecycle 1 PASS (7 unrelated skipped): own vs other
character/campaign projection, usage, DELETE 409, replacement preserves reference.
These are the bounded backend agent results, not an all-API suite claim.

Fresh built runtime plus real isolated PG18/API/socket: RESOURCE replacement
Chrome and Firefox, 2/2 PASS, 24.8s, one worker, retries0. Invited owner sees the
selected image tile; rendered decoded pixels change cyan to magenta without
reload, versioned URL and delivered WebP bytes change; entire character DTO stays
equal and the changed image survives reload. Four served runtime hashes verified.
First attempt failed before bootstrap (loopback connection reset after successful
authentication), not an image assertion; retained separately, no suppression or
weakened assertions. No claim of browser red-to-green reproduction of the original
resource defect: backend changes were already present for this browser gate.

Artifacts: resource-consumer-live under the current visualization directory,
manifest.json, candidate.diff, build.log, initial-results.json and
transport-check-results.json. World-content consumers and the distinct private
journal storage scope still remain; this does not complete all UIX-293 criteria.
No production, push, CI rerun or Linear write.
