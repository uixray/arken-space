# UIX-217 GM + 6 rehearsal runbook

Status: not executed. This document is a deterministic operator checklist, not readiness evidence.

Use `tests/fixtures/uix-217-rehearsal.json`. Every profile must have a separate browser data directory. Never record access links, cookies, tokens, private notes, or production credentials.

## Entry gate — operator, 5 minutes

Stop unless all items are recorded against the same exact SHA:

1. Fresh verified remote backup and checksum/restic check.
2. Restore and migration rehearsal in an isolated environment, including build and schema identity.
3. Reviewed SHA deployed without local modifications; `/healthz` reports the expected build and healthy database.
4. Seven independent profiles: GM plus P1–P6 with the Chrome/Firefox/Edge allocation in the fixture.
5. Rollback command and responsible operator identified. Gameplay reset is optional and needs a separate explicit decision.

## Deterministic preparation — GM, 5 minutes

1. Create scenes `Courtyard` and `Vault`; activate `Courtyard`.
2. Create six characters and permanent player links. Close the links, reopen each in its assigned clean profile, and confirm the same links remain usable after reload.
3. Create shared `Reaction` skill and `Stunning Strike` ability; assign them to Elris and customize Elris's copy.
4. Set Elris resources, wallet, cooldown, campaign day and battle state to non-zero values.
5. Upload one map per scene, token and portrait images, and one music loop. Create seven token definitions, including an ownerless NPC.

## Product rehearsal — 25–30 minutes

Record start/end time and result for every numbered group.

1. **Persistent access and isolation.** P1–P6 reload and rejoin. Each sees only their character/private data and controlled palette definitions. P1 attempts P2/NPC actions and direct foreign IDs; all reject without data leakage.
2. **Character and system actions.** P1 rolls a characteristic, skill, ability hit and damage, then a custom roll. Verify ordinary chat entries, formulas, modifiers and ability description. Change mana/resource, wallet/SP and cooldown; verify chat audit. GM advances day, starts/ends battle and resets recharge; reload P1 and GM and compare state.
3. **Canvas.** GM assigns maps and places tokens from the palette. Players place their controlled definitions. Move tokens concurrently. Exercise MAP/GM/PLAYER layers, GM layer visibility toggle, fog reveal/cover order, persistent drawing create/move/recolor/copy/delete, ruler and snapping. Undo/redo token move/delete, drawing and fog; destructive definition deletion must not break later undo.
4. **Assets and adversarial visibility.** P1 uploads TOKEN and PORTRAIT, assigns them, reloads, and confirms visibility. P2 must not see P1 private/unassigned assets. AUDIO upload/control remains GM-only.
5. **Chat, presence and music.** With Chat inactive, P2 rolls; GM and eligible players use the unread notification to focus the exact roll entry. GM observes presence while players must not receive the matrix. GM starts/seeks/pauses music. Players independently opt in and set different local volume; reload and confirm local preferences.
6. **Recovery.** P6 joins late. P2 reloads. P3 disconnects for 20–30 seconds while play continues, then reconnects. Operator restarts only the isolated rehearsal backend. Verify scene, character state, canvas, chat, presence and music converge without duplicates.
7. **Cross-browser pass.** Repeat one roll, token move, chat focus and music consent in at least one Chrome, Firefox and Edge profile.

## Immediate stop conditions

- Any GM/private/inactive-scene leak.
- Loss or duplication after reload/reconnect/restart.
- Foreign/NPC mutation accepted for a player.
- Undo/redo restores a token whose definition was deleted.
- Backup, schema/build identity, health or rollback evidence becomes ambiguous.

## Exit and report

Attach sanitized screenshots/traces and exact action/request IDs only. Record each defect with browser/profile, steps, expected/actual and reproducibility. A human operator makes the explicit go/no-go after affected automation and human scenarios are repeated.
