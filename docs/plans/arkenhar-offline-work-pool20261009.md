# Offline executable work pool — 2026-10-09

## Updated decision

Owner has explicitly resumed parallel work while the server is unavailable and approved UIX-382: **up to four tracks, independent GM transport/mix, player-local master, existing autoplay/consent behavior**. This supersedes the policy wait in `arkenhar-post-candidate-next-pool20261009.md`. Do not ask that same question again. Root supplied this fresh authorization during planning.

Dispatch two separate file-owned slices below. Neither depends on remote access, public auth activation, new creative assets or physical-device acceptance. Their local gates remain local evidence. Coherent web/server candidate `aca1436` is already prepared; preserve it as immutable historical candidate. New delivery will require a later candidate capture, not immediate rebuild after each edit.

## A — UIX-382 real client mixer (first priority)

### Existing vs missing

Live issue AC: concurrent authorized assets; independent GM mix and local-only player master; join/reload/reconnect convergence without duplicate playback; disposal on remove/replace; legacy settings preserved; GM/player/reconnect/two-track tests; bounded performance/autoplay behavior.

Already implemented per completed audit: DB migration/track state, authoritative four-track limit, independent transport, authorization, CAS/idempotency, single-track migration tests. Do not recreate these.

Narrow current source confirms the actual integration gap:
- `packages/contracts/src/index.ts`: `GameSnapshot.audioTracks`, `AudioTrackDto`, `audio:track:state`, `audio:track:removed` and command `audio:track:set` exist. `audio` is the legacy singular compatibility field.
- `AudioTrackDto`: id, assetId, mixVolume, playing, positionSeconds, loop, startedAt, slotOrder, revision, updatedAt.
- Commands: ADD_TRACK(assetId); REMOVE_TRACK(trackId/revision); SELECT(trackId/revision/assetId); PLAY/PAUSE/END; SEEK; SET_LOOP; SET_MIX_VOLUME. Each includes actionId; all except ADD carry track revision. Use exported types/schema, not new protocol strings.
- `apps/server/src/realtime.ts`: authoritative per-track listener, TRACK_LIMIT_REACHED rejection, state/removed broadcasts. Backend read-only unless a specific failing contract gap is proved and root separately scopes it.
- `MusicBar.tsx`: singular `AudioStateDto` and one audio element; localStorage keys `arken.audio.enabled` / `arken.audio.volume`; existing consent handling and unrelated-update guard.
- `use-game-socket-subscriptions.ts`: handles legacy `audio:state` but not the track events. `App.tsx` MusicBar invocation currently passes `snapshot.audio` (around line 2057).

### Ownership

**Luna audio owns:** `MusicBar.tsx`, `audio-playback.ts` only if necessary, new `audio-tracks-state.ts`/`audio-tracks-playback.ts` helpers and corresponding tests; narrow music-only changes to `use-game-socket-subscriptions.ts`; narrow MusicBar props hookup in `App.tsx`; a dedicated mixer stylesheet if needed; existing MusicBar tests/new dedicated `tests/e2e/uix382-audio-mixer.spec.ts`; `docs/plans/uix382-client-mixer20261009.md`.

Reserve App/subscription edits to this worker for the pool. Do not give another worker an audio-engine-versus-UI split: transport reconciliation and element lifecycle are tightly coupled. Root reviews shared-file hunks and owns final integration/Linear. `apps/server`, `packages/db`, `packages/contracts` read-only by default. Do not stage abandoned `map-ping-motion.ts` or `.tmp`.

### Concrete implementation/acceptance boundary

1. Real GM controls list active tracks ordered by slotOrder; add existing authorized AUDIO asset up to four, replace/remove, independent play/pause/seek/loop/mix. Reuse upload/library behavior rather than invent soundpad or a second media manager.
2. PLAYER has local master/explicit mute/consent handling, never emits a campaign mix/transport mutation. Preserve existing local preference keys and automatic retry after a blocked autoplay on an eligible gesture. One track's successful play must not erase another's blocked state.
3. At most four owned stable keyed elements. Effective gain = existing master slider-to-gain × track mixVolume. Volume-only changes, unrelated snapshots and another track's update must not reset src/currentTime or issue extra play/pause. No RAF-per-element React render loop; playback clock UI can reuse bounded media events.
4. Canonical bootstrap/reconnect replaces active mix and removes missing tracks. Apply typed state/removal events with campaign/session guards and correct sequence semantics. Inspect server emission sequences before reusing global snapshotVersion filtering: legacy and per-track events may represent related mutations. Do not drop a legitimate track update simply because another domain/compatibility event advanced a global number.
5. Track revisions/command IDs guard stale or duplicate updates. Immutable payload on retry; no changed-payload actionId reuse. Late ACK after removal, canonical replacement or campaign/session switch cannot resurrect playback. Volume commands must be serialized/coalesced against actual revisions, not blindly flooded.
6. Dispose removed/replaced/unmounted audio resources, abort or ignore old play promises, clear listeners, and never replay an old asset after replacement. Preserve source-content permission failures as failures; no public URL fallback.
7. No client-created fake migration: authoritative audioTracks is truth, including empty array. A fixture missing required tracks is a fixture compatibility issue, not permission to play both legacy and new states. Preserve server legacy data conversion as already implemented.

### Finite connected gate

New helper/component tests cover two concurrent tracks, independent transport/mix, master emitting zero commands, four-track UI/ACK rejection, blocked autoplay plus explicit mute, revision conflict/retry, removed-track late ACK, element disposal, canonical reload/reconnect replacement and unrelated snapshot no-restart. One new mocked browser flow at desktop and compact checks GM controls and PLAYER boundary with neutral generated test tones/no copyrighted media. Use actual browser media events where feasible; mocks prove mechanics only. Simulated reconnect is **not** true network reconnect acceptance. Existing backend receipts are not relabeled for this frontend SHA. Real-device/autoplay/live network acceptance remains separately open, but does not prevent delivering the local feature.

### Self-contained dispatch prompt

> Owner approved UIX-382 maximum four independent GM-controlled tracks, per-track mix and player-local master with existing consent. Implement the actual client mixer using current audioTracks contract/events, not a backend rewrite. Read this plan and checkpoint, then own the exact audio files listed above including narrow App/subscription wiring. You are not alone: preserve other workers' changes and do not edit instance/guide files. Reuse current library/upload and local enabled/volume preferences. Implement stable per-track playback, canonical snapshot/event reconciliation, revision-safe commands, disposal and late-ACK guards. Do not permit local volume/mute to change campaign state, reset playback on mix changes, or introduce new rights/auth/media policy. No external/production data, credentials, deploy/push/merge. Run one connected new-feature unit/component + mocked-browser gate; retain failures, distinguish fixture reconnect from real transport, report exact files/revision/commands/results and remaining acceptance. Stop and report a specific backend contract defect if found rather than silently expanding ownership. Root owns review/Linear/commit.

Planning range: 8–16 focused hours for the full bounded client slice, not a promised deadline. Start implementation now; no prerequisite policy/research wait remains.

## B — UIX-264 item quantity/condition fields (independent parallel slice)

### Why this is approved scope, not a new gameplay decision

Live 264 AC explicitly requires item quantity and condition and excludes pricing. The first delivered editor `0476865` intentionally shipped only name/state/GM notes. The owner's current request resumes remaining task implementation. A nullable integer count and arbitrary condition text change no inventory/economy/ownership rules. Do **not** add owner/container/location/media/discovered/delete fields or imply that this completes the whole item/inventory AC.

Current source:
- `WorldContentInstancesPanel.tsx`: draft/editableFields/draftValues only displayNameOverride, currentState, gmNotes. canonical prop currently `{ id, name }`.
- `world-content-instances-client.ts`: fields Pick currently only those three.
- `WorldContentWorkspace.tsx`: passes selected id/name to panel. Add only the existing selected canonical type to that prop so the extra controls show for ITEM.
- Existing contracts accept quantity nullable nonnegative integer; condition nullable trimmed 1–200 characters. Existing routes persist/return these fields and already guard GM/campaign/CAS. No schema migration or new endpoint is needed.

### Ownership

**Second Luna owns:** `WorldContentInstancesPanel.tsx`, its CSS/test, `world-content-instances-client.ts`, narrow prop addition in `WorldContentWorkspace.tsx`, existing `tests/e2e/uix264-instance-manager.spec.ts` with a new item-specific case, new `docs/plans/uix264-item-fields20261009.md`. No App, audio, shared tokens or backend files. The audio worker must not touch these files.

### Slice acceptance

- ITEM create/edit/read UI has quantity and condition; non-ITEM does not expose/send them. Existing backend values on non-ITEM are preserved, never nulled by omission.
- Blank quantity means null, **zero means zero**; reject negative, fractional, NaN/nonfinite values rather than silently clamp/round. Follow server numeric representability; do not invent max stack/game balance. Blank/whitespace condition clears to null; >200 trimmed characters rejected.
- An item save changes only requested editable fields; canon, other instances, owner/location/portrait/discovered remain untouched.
- Existing immutable retry and canonical-switch guards extend to the two new fields. Conflict draft remains intact; no reuse of actionId with edited values.
- One connected extension gate: blank/zero/positive/invalid values, two independent ITEM instances, safe non-ITEM edit, rejected/retried mutation and canonical switch; browser create/edit/reload at compact/desktop. Do not repeat all historic 264 tests as a separate campaign; run the coherent affected suite once.

### Self-contained dispatch prompt

> Extend delivered UIX-264 instance editor only with ITEM quantity and condition, explicitly required by live AC and already supported by contracts/routes. You are not alone; own only the instance files listed in this plan, leaving App/audio/guide/backend untouched. Preserve name/state/notes, immutable retry, CAS draft handling and canonical switching. Pass canonical type through the existing workspace; show/send quantity/condition only for ITEM, with null vs zero handled correctly and server-aligned validation. Never overwrite hidden/untouched fields. No owner/container/location/discovery/economy/deletion policy, canon rewrite or generated lore. Add new field regressions and one connected synthetic browser extension; no credentials/production/remote. Report actual commands/results/exclusions and partial-264 checkpoint; do not close the full task.

Planning range: 2–4 focused hours including the connected gate; not a deadline promise.

## Remaining alternatives / correction to earlier narrow conclusion

The earlier six-issue shortlist did not exhaust all 76 rows. It was correct not to redo those six, but not a reason to stop all local development. The owner-approved mixer now provides a clear new core feature, while quantity/condition is a small independent field extension with explicit AC.

UIX-652 product screenshot optimization/integration is also genuinely absent (prior three captures were guide-only evidence in `.data`, not embedded product assets). It is a later independent alternative, not a third assignment now: avoid duplicate guide screenshots and preserve author copy. UIX-457 still needs asset/presentation decisions. Mobile P2–P6, privacy/game-balance, creative imports, external operations and paused design scope keep their audit boundaries. No basic ping/WASD or legacy tests are proposed.

## Checkpoint

- Decision: immediately dispatch audio mixer + independent ITEM fields; owner mixer approval supersedes the old wait.
- Revision: coherent candidate `aca1436` retained; existing 264 `0476865` preserved. Record each worker's actual starting/current SHA rather than copying past test attribution.
- Changed files: this plan only. Live Linear 264/652 re-read; 382 schema/client/backend event hooks narrowly inspected; full implementation audit rows and product/QA audit context reused.
- Verification: planning/source only; no runtime/tests, Linear mutation, credentials or remote work.
- Blockers: none to these bounded local starts. Any discovered defect/contract gap gets explicit root scope; real transport/device/target acceptance remains distinct.
- Next: root assigns two Luna workers with non-overlapping ownership, integrates after connected gates, records one stage checkpoint per pool, then considers a new exact candidate.
