# Terrain stamp prototype — UIX-347

## Run locally

From the repository root, with the repository's existing locked dependencies:

```powershell
node apps/web/node_modules/vite/bin/vite.js --config tools/terrain-stamp-prototype/vite.config.ts --host 127.0.0.1 --port 14244 --strictPort
```

Open `http://127.0.0.1:14244/`. The prototype is standalone and has no API, WebSocket, database, server-authority, deployment or production route. It imports the already locked Konva package from `apps/web/node_modules`; no package or lockfile changes are required.

Run its isolated model tests:

```powershell
node_modules/.bin/vitest.CMD run --config tools/terrain-stamp-prototype/vitest.config.ts
```

Run the connected browser gate (the isolated config starts its own Vite server on 14244):

```powershell
node node_modules/@playwright/test/cli.js test --config tools/terrain-stamp-prototype/playwright.config.ts
```

The output directory is `.data/qa-prep/terrain-stamp-prototype/`.

## Prototype controls

- Choose a local test-pack motif, adjust size/rotation/layer metadata, and click repeatedly in **Placement** mode.
- **Selection** mode allows selection and drag. Buttons and keyboard provide copy, delete, undo and redo. Ctrl/⌘+C copies; Delete removes; Ctrl/⌘+Z and Ctrl/⌘+Shift+Z undo/redo. Middle-button drag pans; wheel zooms. Grid snapping is an optional *prototype-only* toggle.
- **Load 100 / 500** creates deterministic sample data and reports model-load time, Konva layer draw time, camera pan/zoom timing, serialized JSON byte length, and object count. These are raw measurements, not a performance pass/fail threshold.
- JSON round-trip validates schema version, IDs, transforms, layer/revision metadata and stable serialization.

## Model and boundaries

Each in-memory object has a stable ID, stamp kind, author key, position, size, rotation, `DECORATION_PUBLIC` or `DECORATION_GM` layer metadata and revision. The model validates its local document and provides edits/history for interaction studies. The two layer values are labels only; no permission checks, player visibility, asset-preload protection, server authority, persistence, reconnect, collaborative edit/conflict behavior, undo/redo endpoint, touch/accessibility acceptance, or pack management is implemented.

The forest/mountains/clouds raster patterns were generated with the image-generation tool on 2026-10-09 after the owner explicitly requested stamp patterns, and copied without pixel editing to `public/patterns/`. They are prototype imagery, not an approved final art pack. A visible 2×2 repeat swatch is provided for visual review; edge-to-edge seamless tiling has not been established, and no external redistribution/license claim is made. Original source outputs were retained outside this prototype directory by the owner/runtime. Current source-file SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `public/patterns/forest.png` | `57C842857C679B9F35BE627FADF0AF66FAD83C0B89DDE16C8B54D05DFA51EF66` |
| `public/patterns/mountains.png` | `11E99BFA773F7E1FD72E67B76D9DC79180AC9DE93D7DDB935CA4E472E7080F6C` |
| `public/patterns/clouds.png` | `33BFB93B976B037C210168F8A06DFAE85CAD66CB943A949C82B363D29E0A8C68` |

The prototype also uses the exact local Pragmatica Next variable font already supplied in `apps/web/public/assets/`; no remote font import is used. SHA-256: `7B4E50EC50C782077EE147CA5D8DB8C4843BC7DD72FF8F133C2458E45347252D`.

The patterns use procedural hand-drawn Konva symbols as a fallback. Layering/snap defaults are exploration parameters, not product choices. Server integration, access/layer policy, grid behavior, pack licensing, batching and renderer limits, cross-client visibility, reconnect, authoritative undo/redo, and final asset acceptance remain open before any production implementation.
