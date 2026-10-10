# Local inventory: possible Arken/Yandex production data

Date: 2026-10-09. Read-only inventory only. No remote access, DB/content inspection, credential access, restore, delete, or resource mutation was performed.

## Bottom line

The local evidence does **not establish that a complete current Yandex production database+media backup is present on this workstation**. It establishes several local QA/test artifacts, a separately ignored root `media/` directory with unclear provenance, and documentation of older production-derived artifacts located on the server. Do not treat any of these as a verified current production backup.

## Local files and volumes observed

- Main checkout `D:\AI\personal\experiments\arken-space\media\`: 309 files, 431,837,534 bytes (~412 MiB), newest file mtime 2026-09-11 UTC. `media/` is ignored by `.gitignore`; Git lists zero tracked paths and zero status entries. Its provenance, pairing, integrity and production relationship are unknown. I did not inspect media contents.
- Active worktree `D:\AI\personal\experiments\arken-space\.worktrees\uix-293-catalog-20261007\media\`: exists but contains 0 files.
- Worktree `.data/qa-prep/uix293-global-import-prep/backups/`: two local PostgreSQL custom dumps named `uix293-arken_qa-20261008T164747Z.pgcustom` (311,439 bytes; 2026-10-08) and `uix293-arken_qa-20261009T043628Z.pgcustom` (370,239 bytes; 2026-10-09). Provenance docs call these local QA database archives, not a canonical Yandex production backup.
- Paired worktree artifact `.data/qa-prep/uix293-global-import-prep/recovery-snapshots/20261009-b10d6e697c264c3f83ebd577a058300d/`: local QA database archive `current-qa.pgcustom` (366,355 bytes) plus a matching capture-time media snapshot (139 files, 10,518,668 bytes). The paired-recovery checkpoint states this was a new local QA DB archive and the then-present media root; 173 referenced objects are absent. This is not full recovery and is not identified as a restic/Yandex production backup.
- The separate `.data/qa-prep/import-rollback-20261009-211bd455cd/gate3-r-media/` is another 139-file/10,518,668-byte QA restore copy. Its gate receipt labels the rollback restore; it is not independent provenance for production data.
- Local Docker metadata shows named QA/release-test volumes (`arken-uix644-qa-data-20261008`, `arken-qa-pgdata-*`, `arken-qa-media-*`, and similar). `arken-space_postgres-data` was created 2026-08-21 and has Compose labels `project=arken-space`, `volume=postgres-data`. No volume contents were mounted or read, so these names/labels do not prove production provenance or backup completeness.
- Candidate-image `.tar` archives and source-context `.tar` files under `.data/qa-prep/` are software/build artifacts, not application DB/media backups.
- The two `release-upgrade-u-*` `.dump` files under the worktree are synthetic fixture-only artifacts created for local migration QA; they are explicitly not Yandex/production data.

## Safe provenance records consulted

- `docs/operations.md` documents production locations on server `51.250.26.16`: `/home/uixray/apps/arken-space`, `/home/uixray/apps/arken-space-data/media`, `/home/uixray/apps/arken-space-data/backups`; encrypted restic is configured from root-owned `/etc/arken-space/restic.env` and `/etc/arken-space/restic-password`. These are server paths/configuration instructions, not local workstation file proofs.
- `docs/measurement-runbook-2026-08-24.md` records a historical restic snapshot `7198f062` from 2026-08-15 and says a 1.4 MB DB dump was restored to `/tmp/arken-measure/home/uixray/apps/arken-space-data/backups/` **on the server**; media was intentionally not restored. This is dated historical documentation, not evidence that the snapshot/dump is currently on this workstation or current production.
- `docs/current-state.md` and `docs/release-2026-09-19.md` record the 2026-09-19 release and a confirmed backup/restore at that time. Those historical results do not prove a current local copy.
- `.data/qa-prep/uix293-global-import-prep/restored-readability-20261009-691d352/media-readonly-preflight.receipt.json` records 139 files/10,518,668 bytes matching the restored QA database metadata; `media-manifest-verification.receipt.json` records a full one-to-one stored-hash pass. The companion checkpoint explicitly labels the target as a restored QA database and says the 173 missing objects are unresolved.

## Limits and next evidence needed

This inventory used targeted names/docs and local filesystem/Docker metadata. It did not inspect any DB rows, media payloads, environment/credential files, Docker volume contents, restic repository, or remote host. Filename search was limited to the named checkouts and their `.data` QA-prep artifacts; absence there is not proof that no other local/remote copy exists. To establish a real production copy, require owner-authorized read-only provenance tying exact dump + full media snapshot to a named production restic snapshot/capture, with hash/count manifests and pairing evidence. No such local proof was found in the scoped inventory.