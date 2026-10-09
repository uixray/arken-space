# Candidate build checkpoint — 2026-10-09

Product SHA: 2c35435643e09a4dbbcb041889dbc727070536f0. Tree: 07f69e1d38559679df649de7415cdd55ed726bbe. Later commits change tooling/tests/docs, not these candidate product bytes.

Artifacts: `.data/qa-prep/release-gate-2c35435-20261009/` in this worktree, private local only. Positive contexts192server/316web, exact Git blobs; root independently compared all508exported files to manifests. No retained data/secrets/testfixtures included.

Images: server sha256:a62a4c574f8f625f073c701a3c1b1d64ec6ace25b2405578c23d6ae605fda151,191299403bytes; web sha256:64aa62e1424005314b81d2af78385ab522d42077bbd92a8ca1aae7796b1b3c5e,23651056bytes. Root independently inspected server ID/size and checked both saved archive sizes/SHA256. Astra separately inspected OCI descriptors/config blob identities.

Archives: server191324672bytes SHA2565D535D7CEF294D2BA81F1AE9C11555AC3559E8A7C6975A588B65BB273CA0E757; web23671296bytes SHA256408CC1092CD1C38EF2838244D7811F88AA4AA5DFBDB295A610BA86A795AAEB5D.

Build boundary: first network-none attempt failed missing Corepack pnpm10.12.1 cache. Subsequently root authorized existing pinned-toolchain/frozen-lock downloads inside isolated build only. Both builds exit0, no lock changes/base pulls/hostinstall. Vite advisory largechunk persists. Build receipts/tool transcript retained; no raw build-log-file hash claimed.

Verification beyond images: local source41tests/type/build gate, addressed account HTTP/Chromium lifecycle and retainedGM/PLAYER bootstrap3scenarios passed with fake mail/no-op socketfixture. Socket revocation/PG concurrency prior receipts remain separately scoped. ProductionSMTP absent/registrationdisabled. Current-image freshmigration/media/auth/runtime/restore/rollback gate active in separate synthetic disposable arm, not yet accepted.

Blockers/next: finish exact-image fresh/upgrade/restore/preupgrade tuple checks and scoped browser/runtime; provider/dependency approval/key operational setup/public policy/server availability and explicit deploy permission still required. Installer/human/backlog remaining AC are not solved by an image pair. No production/push/merge/deploy performed. Preserve oldACA artifacts and owner playable stands.
