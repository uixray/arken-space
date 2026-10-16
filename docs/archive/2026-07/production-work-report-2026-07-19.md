# Production work report — 2026-07-19

## Released

- Production revision: `6627e2d426d80649969ca9ac265912eb05c2134c`.
- Health: database `ok`, schema `2`.
- Fresh backup and restore rehearsal passed before release: snapshot `aad41af986e41050ede15a22682c55615d846f6cf3051c875d1acf0376e556ab`.

## Delivered this session

- GM+6 isolated recovery and restore gates.
- Production deployment of candidate `b8d612c`.
- Player alias login investigation and replacement of legacy player accounts with six beta profiles.
- One character and controlled placed token for every beta profile.
- Player aliases verified: archinamon, IRAKLY123, DaryaSteel, VeePeeK, Zheludock, uixray.
- Token palette CSS iterations; final structural fix separates token title from the placement control (`6627e2d`).
- Workspace modal layer lowered below nested modal editors.

## Open

- UIX-239: remove duplicate Ed token placements and make starter provisioning idempotent.
- Visually recheck token palette and nested modal scenarios on current production revision.
