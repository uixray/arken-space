# Publish readiness — 2026-07-19

## Prepared candidate

- Application candidate: `b8d612cb8bdc589b672555674a774cb6112d7102`.
- Gate harness revision: `500a2ec`.
- Production rollback baseline: `3d15ba777336c0053abfb0b179e01a42fdfb1c8f` (schema `2`).

## Completed checks

- Lint and workspace typecheck: PASS.
- Targeted formatting and `git diff --check`: PASS.
- Isolated GM+6 recovery: PASS, including backend restart, reconnect, visibility boundaries and cleanup.
- Production health was read before and after the isolated run; no production change was made.

## Release package

- Release evidence: `docs/release-candidate-2026-07-19.md`.
- GM+6 gate evidence: `docs/test-output/uix-201-uix-217-gate-2026-07-19.md`.
- Deployment and rollback procedure: `docs/deployment.md`.

## Required before production GO

1. Create a fresh restic snapshot and record its ID.
2. Restore that exact snapshot in the isolated environment; record checksums, counts and migration `0015` evidence.
3. Complete the human GM+6 rehearsal in Chrome, Firefox and Edge, including credential-dependent GM exchange.
4. Reconfirm production health and rollback revision immediately before deployment.
5. Record GO/NO-GO, then obtain a separate explicit request to deploy.

## Scope boundary

This package is ready for publication to the repository. It is not authorization to deploy production.
