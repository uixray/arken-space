# arken-space

Private web-first virtual tabletop for a custom tabletop RPG system. The first release targets one GM and up to six players in desktop browsers.

## MVP

- personal invite links and GM/player permissions;
- realtime orthographic 2D scenes, square grid, tokens and manual fog;
- custom-system character sheets, chat and server-authoritative dice;
- safe image/audio uploads and synchronized group music;
- self-hosted deployment at `arken.uixray.tech`.

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
- [Публичная дорожная карта на 20.07–16.08.2026](./ROADMAP.md)
- [Публичная доска задач](https://github.com/users/uixray/projects/1)
- See [tasks.md](./tasks.md) for the delivery issues.
- See [docs/roadmap.md](./docs/roadmap.md) for the production-first sequence leading to the first real game.
- See [docs/operations.md](./docs/operations.md) for deployment, backup, restore and incident checks.
- See [docs/yandex-object-storage-backup-2026-07-13.md](./docs/yandex-object-storage-backup-2026-07-13.md) for the private bucket, IAM, secret handling and current cost setup.
- See [docs/server-audit-2026-07-12.md](./docs/server-audit-2026-07-12.md) for the current host capacity and deployment blockers.

## Codebase documentation

- [Architecture](./docs/architecture.md) — runtime, modules, data model and request/realtime flows.
- [Development guide](./docs/development-guide.md) — clean setup, commands, tests and safe change recipes.
- [Skills matrix](./docs/skills-matrix.md) — required competencies, ownership and review checklists.
- [Codebase audit](./docs/codebase-audit.md) — current strengths, risks, drift and recommended priorities.
