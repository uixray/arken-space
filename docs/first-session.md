# First session verification script

## Fixture

- 1 GM and 6 player browser sessions.
- 2 scenes, 1 background map per scene.
- 6 player characters, 4 NPC tokens, 2 fog reveals.
- 20 persisted chat messages and at least 20 dice rolls.
- 2 music tracks.

## Flow

1. GM signs in and creates six one-time invitations.
2. Each player claims one invitation and sees only their character controls.
3. GM activates a scene, moves an NPC and reveals fog.
4. Players move their tokens concurrently for five minutes.
5. Players edit stats, roll from skills and exchange chat messages.
6. GM starts, seeks, pauses and loops music; each player adjusts local volume.
7. Disconnect one player for 30 seconds and verify snapshot recovery.
8. Restart the application and verify persisted positions, sheets, chat and audio state.
9. Continue the session for two hours without a required page refresh.
