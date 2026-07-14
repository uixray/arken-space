# Manual rehearsal report — 2026-07-14

## Result

Accepted as a shortened foundation rehearsal. It confirms the repaired fog behavior but is not full product acceptance; the complete GM + 6 rehearsal remains deferred to UIX-217.

## Reproduced foundation defect

### Player fog leaks the map and permits interaction through covered space

- Historical defect: player fog was translucent, tokens rendered below it, and the fog layer did not participate in pointer handling.
- Accepted behavior: covered map space is fully opaque; non-owned tokens are absent and non-interactive; the player's owned tokens remain visible and usable above fog.
- Ping policy: pings render above covered fog as an ephemeral overlay and reveal no hidden map content.
- Status: fixed and deployed at revision `4153e7a02f8220bff86702c0a811f8efe5d469d0`.

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

## Fog recheck

Production revision `4153e7a02f8220bff86702c0a811f8efe5d469d0` is the accepted foundation state: player fog is opaque, owned tokens remain usable, foreign/NPC tokens stay hidden under cover, and pings are allowed above fog without revealing hidden content.

## Next action

Continue only through the approved product backlog. Run the complete 30-45 minute GM + 6 product rehearsal after UIX-206 through UIX-216 are complete.
