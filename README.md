# arken-space

Web-first virtual tabletop for a custom tabletop RPG system. The first release targets one GM and up to six players in desktop browsers.

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

## Multiplayer verification

With Docker Engine running, execute the isolated multiplayer story:

```powershell
corepack pnpm test:multiplayer
```

The command builds a uniquely named temporary arken-e2e-* Compose project with separate PostgreSQL and media volumes, runs Playwright with one GM and six clean player browser contexts through visibility, network-loss and backend-restart recovery assertions, then removes the complete test stack. The regular Vitest suite additionally exercises one GM and six simultaneous Socket.IO players.

## Documentation

- See [docs/architecture-decisions-2026-07-14.md](./docs/architecture-decisions-2026-07-14.md) for the architecture.
- See [docs/deployment.md](./docs/deployment.md) for deployment prerequisites.
- See [docs/operations.md](./docs/operations.md) for backup, restore and incident checks.
- See [docs/roadmap.md](./docs/roadmap.md) for the product roadmap.

## License

No open-source license is granted. Copyright remains with the repository owner.
