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
corepack pnpm dev:db
corepack pnpm db:migrate
corepack pnpm dev
```

Open `http://localhost:5173/gm/<GM_ACCESS_TOKEN>`. The server exchanges the token for an HttpOnly session and removes it from the address bar.

## Workspace rule

All implementation, generated code and commits for arken-space must stay inside this directory. External projects listed in `dependencies.md` are reference-only.

## Project tracking

- [Linear project](https://linear.app/uixraydesign/project/arken-space-004b59486dc4)
- See [tasks.md](./tasks.md) for the delivery issues.
- See [docs/roadmap.md](./docs/roadmap.md) for the production-first sequence leading to the first real game.
- See [docs/operations.md](./docs/operations.md) for deployment, backup, restore and incident checks.
- See [docs/server-audit-2026-07-12.md](./docs/server-audit-2026-07-12.md) for the current host capacity and deployment blockers.
