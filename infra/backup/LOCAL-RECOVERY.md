# Independent local recovery copy

`copy-snapshot-local.ps1` copies one exact encrypted Restic snapshot into a separate local repository and runs `check --read-data`. It never forgets, prunes, mirrors deletes, or restores over a running service.

Prerequisites: restic available on PATH; source storage credentials in provider environment; source repository password via RESTIC_FROM_PASSWORD_FILE; destination password prompted by restic or via RESTIC_PASSWORD_FILE. Keep both passwords in your password manager. Passwords are never script arguments. Protect any password files with explicitly verified local ACLs; delete temporary password files after use.

Example (placeholders, not real credentials):

```powershell
./infra/backup/copy-snapshot-local.ps1 -SourceRepository '<encrypted source repository>' -SnapshotId '<full 64-character snapshot ID>' -LocalRepository 'D:/ArkenRecovery/restic' -Initialize
```

For subsequent copies omit `-Initialize`. Existing snapshots are retained. Store a second copy on a separate disk; a local repository on the same failed disk is not independent hardware redundancy.

This command copies an existing snapshot; it does NOT create a fresh server dump. Before selecting a snapshot, require a successful server backup invocation containing PostgreSQL dump/checksum/counts, paired media/checksums, and encrypted deployment configuration plus image/revision/schema/PG-version manifest. The current historical backup script does not yet include all deployment configuration and has retention/prune: do not treat it as fulfillment of this new requirement.

After copying, restore to an isolated fresh PostgreSQL target using the existing restore rehearsal tooling. Verify migration ledger, table data, media references/hashes, and GM/player access. `check --read-data` proves repository integrity, not application restorability. The launcher remains incomplete as a full owner recovery workflow until new server snapshot creation and isolated restore evidence are connected. Never use the live review/production database for rehearsal.
