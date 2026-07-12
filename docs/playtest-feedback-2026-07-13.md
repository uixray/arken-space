# Playtest feedback — 2026-07-13

Source: first manual production walkthrough by the project owner.

This is a product backlog, not permission to implement every item immediately. Stability and authorization work remains ahead of interface expansion.

## P0 — security and authoritative state

### Player can move another character's token

Observed: after joining as a player, the player could move both their own token and another token.

Expected:

- a player can start, preview and commit movement only for a token explicitly assigned to their membership;
- direct Socket.IO commands for another, hidden, locked or inactive-scene token return `FORBIDDEN`;
- rejected optimistic movement immediately returns to the authoritative server position;
- the test uses genuinely separate browser profiles and verifies membership IDs, character ownership and token ownership in PostgreSQL.

This blocks the first real game and must be investigated before usability changes.

## P1 — core game usability

### Fog cannot be hidden again

Observed: the GM can reveal an area, but cannot cover it again.

Expected: add a minimal `HIDE_FOG` operation that creates darkness over a selected rectangular area. Keep the existing "undo latest reveal" command separate; do not build general undo/redo.

### Token image cannot be assigned

Observed: uploaded token images cannot be selected for a token.

Expected:

- GM selects an image from `TOKEN`/compatible image assets when creating or editing a token;
- assignment is persisted and visible after reload/reconnect;
- player sees only assets permitted by the role-filtered snapshot.

### Character portrait cannot be assigned

Observed: a character card has no working portrait assignment flow.

Expected: GM, or the owning player where allowed, selects an uploaded portrait; `portraitAssetId` persists and the card renders the image with a neutral fallback.

### Token label behaves incorrectly during drag

Observed: the token moves but its name remains at the old location during drag.

Expected:

- image, selection shape and label share one draggable Konva group;
- labels are hidden by default and appear only while hovering/focusing the token;
- GM can still identify hidden tokens in GM mode without leaking their labels to players.

### Quick dice controls in chat

Requested: add visible quick-roll buttons to the chat panel for `d2`, `d4`, `d8`, `d12` and `d20`. Rolls must use the existing server-authoritative dice endpoint and produce ordinary auditable chat messages.

## P2 — layout change

### Move music into a sidebar tab

Requested:

- remove the permanent bottom music bar;
- add a dedicated sidebar music tab;
- preserve per-player sound consent and local volume;
- preserve GM track/play/pause/position/loop controls.

### Replace the bottom bar with available tokens

Requested: use the freed bottom area as a compact palette of available tokens. The exact meaning must be resolved before implementation:

- unplaced character tokens available to the GM;
- scene tokens available for selection/focus;
- or reusable token templates.

Recommended first interpretation: GM palette of characters that do not yet have a token on the active scene, with drag/click placement. Do not implement until authorization and token ownership are stable.

## Recommended execution order

1. Reproduce the foreign-token movement with two clean player sessions and inspect ownership rows.
2. Fix server ownership assignment and add API/Socket regression coverage.
3. Verify reconnect, rejected optimistic movement and production deployment version.
4. Add fog re-covering and token/portrait assignment.
5. Fix hover-only grouped token labels.
6. Add chat quick dice.
7. Move music and design the token palette only after the main session flow is stable.
