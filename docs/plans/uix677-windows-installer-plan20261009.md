# UIX-677 — Windows installer architecture plan (Astra, 2026-10-09)

## Decision status / scope

Live UIX-677 read: **Backlog**, parent UIX-657, related UIX-525. Owner asks for an ordinary Setup.exe and shortcut for a nondeveloper host: no Docker, Node installation, terminal, build or .env editing. This document is planning only, not permission to start implementation. No installer, dependency, signing certificate, firewall rule, provider or download was created. No Linear writes. Other workers own auth/frontend/source; this task changes this document only.

Source review baseline HEAD `6a53cd2a65d4cc444e2897c2ded62dea47f6be3f` in `D:\AI\personal\experiments\arken-space\.worktrees\uix-293-catalog-20261007`; active shared work can change it. Auth review is separate and not repeated. No clean-machine execution performed.

## Actual repository constraints — not a ready desktop runtime

- `apps/server/package.json`: ESM tsup server, Fastify/Socket.IO, workspace packages and native `sharp` dependency. A single copied JS file is not a complete package; workspace runtime modules, migrations, PGlite WASM/data assets and platform-correct native binaries must be inventoried and staged. Root pnpm/dev tooling is not an end-user dependency.
- `packages/db/src/pglite.ts`: disk-backed PGlite 0.5.4 wrapper with migrations at `../drizzle/` relative to module, default `./.data/pglite`, hand-built `_arken_migrations` name ledger. It executes each SQL file then separately records its name; no explicit per-file transaction/checksum/failed-upgrade recovery in this wrapper. It casts PGlite's Drizzle type to postgres-js type: compile success does not prove runtime equivalence.
- `apps/server/src/env.ts`: `DEV_DATABASE_DRIVER=pglite` is **development-only**, explicitly rejected in production. Production expects DATABASE_URL and GM_ACCESS_TOKEN and account mode. Do not ship NODE_ENV=development merely to bypass guard. Embedded production support needs a deliberate deployment-mode/configuration contract with equal security requirements, explicit data root and migration strategy.
- `apps/server/src/index.ts`: listens on `0.0.0.0`, uses a single exact WEB_ORIGIN for account writes and Socket.IO handshake, skips beta seed only in account mode, and uses SIGINT/SIGTERM shutdown. First installed start must bind loopback and never seed. Windows launcher shutdown requires tested authenticated IPC/graceful close; killing a child is not proof of clean DB shutdown.
- Web build is Vite static dist; current dev proxy handles API/socket/health on a different port. No packaged same-origin static serving layer was established by this review. Installer must not ship a Vite dev server; unify production static files/API/socket behind one controlled local endpoint and distinguish SPA fallback from API 404/media ACL.
- `storage.ts`: MEDIA_ROOT is resolved from runtime cwd; disk-space/quota checks exist, native sharp/image and audio parsing require actual packaged tests. Absolute per-user storage paths must be supplied explicitly; never rely on shortcut working directory.
- Current backup tooling is Linux shell/restic/PostgreSQL and Docker rehearsal (`infra/backup`, `scripts/run-restore-rehearsal.mjs`). Do not run it against a friend's machine or call it Windows-ready. Reuse integrity concepts, not production defaults/paths/credentials. Count coverage list inspected omits newly added account tables; desktop backup inventory must be derived/validated against full current schema including auth/outbox.

## Architecture choice: prove minimal bundled runtime first

**Preferred spike candidate:** bundled pinned Node runtime + existing built server/web + persistent PGlite, supervised by a small Windows launcher/control UI. This minimizes changes to game implementation, not security/packaging work. PGlite remains a candidate until persistence, migration interruption, transaction concurrency, media and restore tests pass. One OS-user instance owns each data directory; enforce a robust single-instance/data-root lock, not just a PID file.

**Wrapper is orthogonal to database.** Candidate production wrapper: self-contained native Windows UI (for example .NET desktop) with start/stop/status/open-game/backup/update commands, launching hidden child with structured IPC. It needs its own build/runtime/license/toolchain gate, not an assumed installed SDK. Existing web UI stays in the user's supported browser. Packaging as installer is a separate step; choose installer tool only after spike and owner approval of build dependencies/licensing. No wrapper/toolchain exists in the reviewed source.

Alternatives to evaluate, not silently adopt:

| Candidate | Potential benefit | Additional proof/cost |
|---|---|---|
| Native launcher + bundled Node/PGlite | Existing server reused, no DB service, browser player UI | New launcher/IPC/install stack; embedded DB promotion and Windows crash tests |
| Electron wrapper with same backend | Bundled UI engine and JS-oriented shell | New dependency/toolchain and larger patch surface; secure renderer/IPC; still must solve DB/lifecycle/install |
| Tauri/WebView wrapper + Node sidecar | Native shell around existing UI | New Rust/webview prerequisites, offline runtime availability and sidecar verification; not automatically simpler |
| Native launcher + bundled PostgreSQL | Closer to production DB semantics | New binary distribution, process/port/credential/migration/backup ownership, heavier installer; no system DB reuse |
| Node single executable packaging | Fewer visible runtime files potentially | ESM/workspace/native sharp/WASM/migration resource extraction compatibility must be demonstrated; not first critical path |

Do not rewrite server/DB in native language or switch to SQLite to get an .exe. Do not label a portable zip or Docker archive as full issue completion. If PGlite fails the spike, stop and price bundled PostgreSQL rather than relaxing correctness.

## Runtime/storage/security contract to freeze after spike

- Per-user installation recommended for first scope, no always-running Windows service/autostart by default. Proposed app versions beneath `%LOCALAPPDATA%\Programs\ArkenHar\versions\<version>`; data/config/logs beneath `%LOCALAPPDATA%\ArkenHar\instances\<instance-id>`. Exact path/support policy is owner decision; validate Unicode/spaces/long path and Windows permissions. Data never lives under version directory. One host user is the initial owner; multi-Windows-user sharing/service accounts are separate scope.
- Launcher states: stopped → starting/migrating → ready → stopping; explicit degraded/failure/repair. Check port ownership without terminating strangers. Readiness means exact version/schema/data-instance authenticated health, not any process responding on selected port. Reject two launchers on same DB. UI shows LAN exposure off/on, storage/free space, bind address, clean error code; no tokens/SQL/env dumps. Start child hidden; monitor exit and expose bounded restart rather than crash loops.
- Local control is not a game API. Use user-ACL-restricted named pipe or equivalent authenticated local IPC; no unauthenticated `/shutdown`, `/bootstrap-admin`, `/read-token`, backup or arbitrary filesystem endpoint on LAN. Validate peer/instance and input paths. First-run capability is high entropy, single-use, short-lived, passed via secure IPC rather than command line, URL logs or bundled default password.
- Embedded deployment mode is separate from NODE_ENV: production error/log defaults, account/provenance authorization, no alias route or historical null-source shortcut, no seed, no default GM token. Separate transport-security policy from development flags; do not globally turn off secure cookies to make LAN work.

## First run and account policy — genuine owner decision

Local installation cannot honestly verify email without a real external mail channel. Existing account routes require verifiedAt; setting a fabricated verifiedAt or enabling test-mail is prohibited.

Recommend explicit **local-instance identity policy**, subject to owner approval: OS-user-authorized one-time setup creates an account with password and local-owner assurance (distinct from verified email), then atomically creates its own GM membership/campaign/first scene using existing empty-campaign service. Change authorization model to represent local-owner assurance deliberately, never disguise it as email verification. Public hosted verified-email policy stays unchanged. Owner chooses whether player accounts use local instance invitations + password or configured real mail; password recovery is a documented local-owner recovery operation with session revocation and audit, not a universal backdoor. Test no first-run takeover from LAN/restart/duplicate browser.

Accounts remain primary real identities. Retained campaign GM/PLAYER secret links are optional explicit capabilities with existing provenance/revision/revocation/role checks; they neither replace setup account nor auto-bind historic ownership. Invite UI must clearly identify this installation and role. No author's private campaign, beta roster, credentials, media, keys or QA fixtures in package. Optional synthetic demo is separately selected and tested as synthetic.

## LAN and internet boundaries

Loopback-only launch is default. Host explicitly enables LAN and sees address/interface/port and risk/consent before any listener/firewall change. No automatic UPnP/router/NAT opening. Restrict firewall scope to chosen executable/port/private network when separately authorized; offer diagnosis/instructions if denied, never require disabling firewall. Check second physical device, not just a second localhost tab. IP/interface changes need clear address refresh; origin allowlist is explicit and bounded, never `*` or blind reflection of Host/Origin. DNS-rebinding/foreign Host tests are required for local control and game ingress.

**LAN security is a release decision, not solved by packaging:** production Secure cookies over plain LAN HTTP will not work as assumed, and passwords over plain HTTP are exposed to LAN interception. Preferred acceptance is a reviewed HTTPS/certificate/trust story for host + players. Do not claim self-signed certificates are frictionless or install trust silently. A consciously limited HTTP-private-LAN mode would require explicit owner risk acceptance and scoped transport policy/tests, not NODE_ENV=development. Until chosen and verified, authenticated LAN acceptance is blocked even if localhost works.

Internet play is separate: NAT/CGNAT, public address/DNS, TLS, auth/rate limits and host availability need a separately approved route (router configuration, tunnel/relay or hosted service). No promise of automatic remote access; no provider selection/provisioning in this issue's current plan. Host laptop must remain awake/running; explain sleep/resume/disconnect behavior.

## Backup, restore, update, rollback, uninstall

1. GUI backup enters maintenance, rejects new mutations, drains active writes/uploads, cleanly closes DB, then snapshots DB+media+version/schema/config manifest to staging. First scope uses offline/quiesced copy, not live directory copy. Backup destination outside app version folder; check free space and archive hashes. Include all tables, assets and necessary local secrets with an explicit portable encrypted export policy; machine-bound secret protection alone will not restore on another PC. Never include secret values in manifest/logs.
2. Restore validates manifest/size/checksum/schema/version and archive path safety (zip-slip, absolute paths, symlinks), stages separate directory, verifies DB/media references, then switches instance atomically with previous directory retained. No overwrite of running DB. Interrupted restore keeps original usable. Demonstrate restore on a fresh instance, not just archive creation.
3. Update stages a versioned immutable payload, validates release manifest/hash and approved authenticity mechanism, requires pre-upgrade verified backup, stops writer, applies tested migration and health check. Do not execute downloads solely because checksum supplied by same untrusted source matches. Delivery/signing channel remains owner decision.
4. Rollback of binaries is not rollback of schema. If migration is incompatible, restore pre-upgrade **data+media+config** checkpoint with explicit warning about post-upgrade data loss; never silently open upgraded DB in old executable. Disk-full/power interruption must leave one recoverable selected version/data pair. Migration ledger/checksums and transaction/recovery changes required before shipping PGlite wrapper.
5. Uninstall removes only known installed program files/shortcuts and owned optional firewall entry; stops own instance gracefully. **Preserve campaigns/data/backups by default**, show their path and reinstall recovery. Separate explicit destructive choice with confirmation/backup guidance; do not recursively delete guessed paths or another instance. No registry/system cleanup beyond owned installation resources.

## Bounded Luna spike prompt (dispatch only after owner GO)

> UIX-677 technical spike, not complete Setup.exe. Own a new isolated `tools/windows-host-spike/` harness plus dedicated tests/report and disposable data/artifact directory; no edits to auth/frontend/shared runtime without root assignment. You are not alone; never revert other workers. Read this plan and current Git state. Use only already installed runtimes/dependencies and synthetic data; no downloads/package installation/signing/firewall/service/remote/secrets/Linear/push actions. Inventory exact bundled dependency closure, native sharp/WASM/migration paths, executable/runtime licenses and missing build tools without copying private workspace data. Demonstrate a staged built server/web running without repo cwd, global PATH Node/pnpm/tsx or dev server; runtime path explicitly selected from an approved existing local Node. This is bundled-runtime simulation, NOT redistributable or clean-machine proof. Test disk PGlite migration+restart, controlled graceful stop through proposed local IPC harness, duplicate-instance rejection, image/audio storage, backup/restore in isolated directories, interrupted migration/restart behavior, and concurrent auth/campaign writes with synthetic fixtures. Current PGlite dev-only restriction must remain intact: any harness dev-mode run is feasibility evidence only; report exact production config/entrypoint refactor required, don't bypass guard and call it production. No LAN/firewall activation or SMTP; localhost only. Return PASS/FAIL/unknown matrix, command/version/hash/dependency manifest without secrets, files/ownership, blockers and measured timings/resource footprint. Recommend PGlite continue or bundled-Postgres fallback with evidence, and native wrapper/installer toolchain decision requiring approval. Root integrates before another pool. Stop after spike report.

Spike stop/ready criterion: a deterministic staging inventory and reproducible isolated lifecycle/persistence/restore result with each unsupported production requirement explicitly marked. No claim of installer acceptance and no changes to retained QA/prod data.

## Delivery pools and conditional estimate

Estimate is engineering effort, not calendar promise or automated-agent deadline; recalculate after spike and policy decisions. Initial planning range for one experienced implementer with review: **roughly 4–8 focused weeks** for a defensible Windows v1 if bundled PGlite is viable and decisions/environments are available. Large DB migration/runtime failures, TLS UX, signing procurement or clean-machine access may extend it substantially.

- Spike: approximately 2–4 engineering days; may falsify recommended runtime quickly.
- Embedded production config/storage/migration and first-run identity: approximately 5–10 days after account/transport policy decision.
- Native control UI, lifecycle and actual installer/dependency packaging: approximately 4–8 days after toolchain choice.
- Backup/restore/update/rollback/uninstall: approximately 4–8 days; real failure rehearsal is required, not just happy path.
- Clean Windows/device QA and repairs/documentation: approximately 4–8 days plus external waits.

Pools may overlap only with explicit ownership; do not parallelize shared auth/schema changes blindly. Public internet mode, auto-update infrastructure, signing certificate acquisition and broad Windows/CPU support are not included as guaranteed deliverables. User decides supported OS/architecture (suggest initial Windows 11 x64 candidate, subject to approval), identity/LAN policy and signed/unsigned internal-test distribution. Do not claim current Microsoft support/signing requirements were researched here.

## Acceptance evidence matrix

- **Source:** manifest, config isolation, secret/beta exclusion scan, ACL/Origin/Host/provenance checks, version/schema guards, unit failure paths. Necessary but insufficient.
- **Packaged local:** install payload with packaged exact runtime/native assets, arbitrary cwd/paths, no developer PATH dependency; create campaign/upload/restart; collision/disk-low/graceful stop/crash/sleep-resume; full recoverability tests with synthetic data.
- **Clean Windows:** supported fresh VM/machine without Node/Docker/Git/dev tools; standard user installation and clear elevation only where approved; offline installation if package claims offline; actual shortcut/start/stop/uninstall/reinstall. Record Windows version/architecture, package SHA, installer version, app revision and results. Existing developer Windows success does not count.
- **Second device:** explicitly consented LAN connection, account login/invite/realtime/media, reconnect and invalid-origin/token rejection, firewall-denied diagnostic. Use approved transport policy; not mock/socket-only evidence.
- **Durability:** before/after counts and media hashes across backup/restore/new-machine recovery, failed update/rollback and uninstall-preserve. All account/outbox tables included; tokens remain private; demonstrate one recoverable version-data pair after interruption.
- **Human acceptance:** friend follows short Russian nondeveloper instructions unaided; no terminal/.env/toolchain requirement. Explain data location, backups, host sleep, local/internet difference and signature/SmartScreen limitations honestly. Public release requires root gate and explicit owner approval.

## Compact checkpoint

Decisions: plan only; bundled Node+PGlite is spike candidate, not approved production DB; native launcher and installer remain choices after evidence. Revision: `6a53cd2a65d4cc444e2897c2ded62dea47f6be3f` source snapshot, live UIX-677 Backlog. Changed: only `docs/plans/uix677-windows-installer-plan20261009.md`. Verification: read-only source + live Linear, no build/download/install/runtime test. Blockers: production embedded mode, local-account assurance without fake email verification, LAN cookie/TLS policy, packaging/native assets, Windows lifecycle/migration/restore evidence, toolchain/signature and clean-machine access decisions. Next: owner approves bounded spike and root allocates isolated ownership; do not start full installer implementation from task creation alone.
