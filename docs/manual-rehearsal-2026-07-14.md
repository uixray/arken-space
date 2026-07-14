# Manual rehearsal report — 2026-07-14

## Result

Stopped during the GM setup/walkthrough after reproducing a player fog visibility and interaction foundation defect. The remaining GM + 6 recovery sequence was not run and the manual foundation gate remains open.

## Reproduced foundation defect

### Player fog leaks the map and permits interaction through covered space

- Actual: player fog is translucent, tokens are rendered below it, and the fog layer does not participate in pointer handling.
- Expected: covered map space is fully opaque; non-owned tokens and pings under fog are absent and non-interactive; the player's owned tokens remain visible and usable above fog.
- Code diagnosis: player opacity was 0.94 and the fog layer used `listening={false}`.
- Status: local fix and regression tests in progress; production remains unchanged until a committed build is deployed.

## Usability and product findings

- Fog can undo the latest reveal but cannot intentionally cover a selected area.
- Chat composer scrolls out of the viewport with message history; only the message list should scroll.
- Scene and character names cannot be edited.
- Token ownership cannot be assigned explicitly in the UI; characters and scene tokens need separate management.
- Dice display is ambiguous: total, individual dice and formula are duplicated without labels.
- Dice actions should live in chat and show a visible result notification.
- Player upload affordance has no usable follow-up workflow for music, portraits or token images.
- Add a collaborative soundpad for short effects such as victory, defeat or theme cues.
- GM needs an online-player list.
- Add a ruler/grid distance measurement tool.
- Add map image scale/alignment controls.
- Add zoom controls: minus button, plus button and a range slider, while retaining wheel zoom.
- Add role-filtered token layers: map, GM and players; GM-layer tokens are hidden from players, translucent to GM and movable between layers by GM context menu.

## Next action

Complete the narrow fog fix, run local verification, commit before deployment, deploy the exact commit, and repeat the stopped fog section before resuming the full manual rehearsal.
