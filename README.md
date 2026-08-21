# arken-space

Private web-first virtual tabletop for a custom tabletop RPG system. The first release targets one GM and up to six players in desktop browsers.

## MVP

- personal invite links and GM/player permissions;
- realtime orthographic 2D scenes, square grid, tokens and manual fog;
- custom-system character sheets, chat and server-authoritative dice;
- safe image/audio uploads and synchronized group music;
- self-hosted deployment at `arken-khar.space`.

Multi-level, isometric and full 3D rendering are deliberately deferred until the core 2D game loop is stable. The shared game state is renderer-independent so those modes can be added without rewriting access, chat, characters or realtime transport.

## Local development

```powershell
Copy-Item .env.example .env
corepack pnpm install
corepack pnpm build
corepack pnpm dev:db
corepack pnpm db:migrate
corepack pnpm dev
```

Open `http://localhost:5173/gm/<GM_ACCESS_TOKEN>`. The server exchanges the token for an HttpOnly session and removes it from the address bar.

### Two traps in that sequence

**`dev:db` does not publish a port.** `docker-compose.yml` describes production, where the server reaches PostgreSQL over the Compose network and the database is deliberately not exposed to the host. A local server started outside Compose cannot reach it. Publish it from a machine-local `docker-compose.override.yml`, which is gitignored precisely because `infra/deploy/build-and-start.sh` calls bare `docker compose` and would otherwise pick it up in production:

```yaml
services:
  postgres:
    ports:
      - "127.0.0.1:5433:5432"
```

Pick a port that is free. 5432 is often taken by a native PostgreSQL service, and the failure looks like `password authentication failed for user "arken"` — the connection reached a different database, not the container.

**`db:migrate` ignores `.env`.** Nothing in this repository loads `.env` into the process environment; `packages/db/src/migrate.ts` reads `process.env.DATABASE_URL` and otherwise falls back to `postgres://arken:arken@localhost:5432/arken`. Export the variable for the command, or it will migrate whatever answers on that address:

```powershell
$env:DATABASE_URL = "postgres://arken:<password>@localhost:5433/arken"
corepack pnpm db:migrate
```

The same applies to `corepack pnpm dev`: the server validates its environment through Zod and needs the variables present in the shell.

`POSTGRES_PASSWORD` is applied only when the database volume is first initialised. Changing it in `.env` later does not change the password of an existing volume.

## Multiplayer verification

With Docker Engine running, execute the isolated multiplayer story:

```powershell
corepack pnpm test:multiplayer
```

The command builds a uniquely named temporary arken-e2e-* Compose project with separate PostgreSQL and media volumes, runs Playwright with one GM and six clean player browser contexts through visibility, network-loss and backend-restart recovery assertions, then removes the complete test stack. The regular Vitest suite additionally exercises one GM and six simultaneous Socket.IO players.

## Workspace rule

All implementation, generated code and commits for arken-space must stay inside this directory. External projects listed in `dependencies.md` are reference-only.

## Project tracking

- [Linear project](https://linear.app/uixraydesign/project/arken-space-004b59486dc4)
- [Текущее проверенное состояние](./docs/current-state.md)
- [Архивная публичная дорожная карта на 20.07–16.08.2026](./ROADMAP.md)
- [Публичная доска задач](https://github.com/users/uixray/projects/1)
- Linear is the source of truth for issue status and acceptance criteria.
- [tasks.md](./tasks.md) and [docs/roadmap.md](./docs/roadmap.md) are preserved historical foundation snapshots, not active trackers.
- See [docs/operations.md](./docs/operations.md) for deployment, backup, restore and incident checks.
- See [docs/yandex-object-storage-backup-2026-07-13.md](./docs/yandex-object-storage-backup-2026-07-13.md) for the private bucket, IAM, secret handling and current cost setup.
- See [docs/server-audit-2026-07-12.md](./docs/server-audit-2026-07-12.md) for the current host capacity and deployment blockers.

## Codebase documentation

Start at the [documentation index](./docs/README.md). It separates the handful of
maintained documents from the ~60 dated per-ticket checkpoints, which are kept
for their reasoning but are not a description of how the system works today.

- [Architecture](./docs/architecture.md) — runtime, modules, data model, realtime and client structure.
- [Development guide](./docs/development-guide.md) — setup, commands, change recipes, and the traps already hit in this codebase.
- [Testing](./docs/testing.md) — kinds of tests, DOM environment, what to use where.
- [Release checklist](./docs/production-release-checklist.md) — the mandatory deploy gates.
- [Operations](./docs/operations.md) — backup, restore, incident checks.

Documentation is updated in the same commit as the code. The checkable half of
that rule is enforced: `tests/documentation-freshness.test.ts` fails the suite
when the schema, migrations, routes or realtime events drift from what
[architecture.md](./docs/architecture.md) says about them.
