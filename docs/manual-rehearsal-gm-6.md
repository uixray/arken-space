# Manual rehearsal — GM + 6 players

Status: pending. This is the final human foundation gate before the UX backlog.

## Goal

Spend 30–45 minutes using production as a real table: one GM and six independent player browser profiles. Record only reproducible blocking, consistency, security or data-loss defects.

## Profiles

- One GM and six clean player profiles, P1–P6.
- Prefer Chrome, Firefox and Edge across the profiles.
- Every profile must have independent cookies.
- Never put invitation URLs, cookies or access tokens in the report.

## Preflight — 5 minutes

1. Confirm production health reports application and database `ok`.
2. Confirm the expected build revision/schema and a successful recent backup.
3. GM prepares two scenes, six player characters/tokens, one ownerless NPC, fog, one public asset and one hidden-scene asset.
4. GM creates six separate invitations; each player claims exactly one.

Stop if health is not `ok`, the backup is stale, sessions are shared or ownership is ambiguous.

## Rehearsal — 25–30 minutes

1. P1–P5 join; P6 waits for late join. Each player checks private data, moves their own token, then P1 attempts to move P2 and the NPC. Foreign/NPC movement must reject and snap back.
2. P1–P5 move concurrently while GM moves the NPC. Everyone sends public chat/dice; GM sends GM-only chat/dice. State must converge without duplicates or GM-only leakage.
3. GM changes fog and switches scene. P6 joins late. P6 must receive the current scene; hidden and inactive-scene records must remain absent.
4. P2 reloads. P3 goes offline for 20–30 seconds while others continue, then reconnects. Both must return to the current authoritative state without duplicates.
5. Operator restarts only the Arken backend container. Clients must reconnect/resync and preserve scene, fog, positions, chat and rolls.

## Security checks

Every player must be unable to receive hidden/inactive-scene tokens or assets, GM-only messages/rolls, another character's private notes, unrevealed fog geometry or GM preview state. Direct foreign/NPC movement must reject.

A suspected leak is an immediate stop condition. Record time, profile, browser and action/request ID, but do not copy leaked content into the report.

## Pass criteria

- Seven independent authenticated profiles.
- Allowed actions converge; forbidden actions reject and correct locally.
- Reload, late join, outage and backend restart recover authoritatively.
- No duplicate entities and no hidden/GM-only leakage.
- No blocking, consistency, security or data-loss defect reproduced.

## Defect template

```markdown
### [Short title]

- Time:
- Profile/browser:
- Preconditions and steps:
- Expected / actual:
- Reproducible: yes/no, attempts:
- Membership/action/request ID:
- Screenshot or trace path:
- Severity: blocker / consistency / security / data loss
```

## Postflight

Check production health, containers, disk and backup timer. Write a timestamped report. If clean, close the foundation gate; otherwise fix only reproduced foundation defects before P1 UX work.
