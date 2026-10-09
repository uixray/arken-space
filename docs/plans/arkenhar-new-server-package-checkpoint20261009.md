# New-server package skeleton checkpoint — 2026-10-09

## Status

Software-only configuration skeleton exists; it is **not a release package or ready-to-transfer artifact**. Production-data readiness is false. The current candidate `4dca5a19d3b6b7ca17464825b893dfc276185462` is still building; no image IDs or archive hashes have been populated. Root reports the encrypted backup download remains active (process 62006; 333 files / 259,605,273 bytes at the last supplied checkpoint), but this is not completion, decryption, or restore evidence. The owner found the password in a password manager; it has not been locally verified or used here.

## Artifact

Private staging directory: `.data/qa-prep/new-server-package-20261011/` (ignored, not for Git/public archive).

- `README.md` — bounded package assembly and operator checklist.
- `compose.template.yml` — placeholder-only, exact-image-ID template; no automatic build/pull.
- `runtime.env.example` — names/placeholders only; production auth on, registration/mail/runtime/creation off pending operational readiness; retained campaign-link feature is explicit and off by default.
- `manifest.pending.json` — readiness remains false; candidate image IDs and archive hashes intentionally pending.

No application source, image, database/media, backup, or credential material was copied. No Docker operations, server/runtime startup, upload, or deployment were performed. Static inspection only; this does not establish compose validity against final candidate images or target-host compatibility.

## Decisions / boundaries

- Software artifact and private recovery bundle remain separate.
- Never infer the production data snapshot from the encrypted download until integrity, decryptability, snapshot identity, DB/media pairing, and restore are evidenced.
- Keep old campaign-link access as an explicit independent setting; do not convert legacy membership ownership to accounts.
- No guessed host/domain/SMTP/backup values. Missing values stay required or disabled.

## Next action

After the builder freezes accepted image IDs and archive checksums, populate only from its final receipt and perform positive-member-list/hash validation. Data recovery remains blocked on verified encrypted download and owner-provided decryption capability; target readiness also needs host, domain/TLS, mail, entitlement, private-key, and backup-operation decisions.
