# UIX-652 capability evidence — 2026-10-09

## Result / boundary

This is a source-backed capability/role map plus a small **actual local browser screenshot set** for the delivered keyboard guide. It is not closure of UIX-652. No product files were edited. Existing port `14243` could not be reused: Vite reported `EADDRINUSE`, although shell HTTP probes could not reach a listener. To avoid fighting an unknown/reserved port, capture used a single short-lived Vite `createServer` bound to an OS-selected `127.0.0.1` port, in the same local process as headless Chrome; the process closed after capture. No backend was started or contacted. API requests were intercepted with synthetic bootstrap (401) and empty public-roadmap (200) responses. Screenshots crop only the existing `#guide-shortcuts` panel, excluding the landing/auth area and its identity list. A preliminary full-landing capture was rejected and removed after visual review because that area showed account labels; it is not present in the artifact folder.

Source revision observed: `094824eef0d6d68f54a31e62ba26f3b6b9cf1b58`; checkout is concurrently dirty for UIX-264 and other work. Source fingerprints at inspection:

| File | SHA-256 |
|---|---|
| `apps/web/src/LandingGuide.tsx` | `8EF115FFC0F53C20EDA64D58F6F93C3358592CCD76720F524C755336A897F86E` |
| `apps/web/src/landing-guide-content.ts` | `B62C5194850F645298C3C142E3B0EE6681C1036D223CE35A055034A33A701841` |
| `apps/web/src/landing-guide.css` | `DFAEDC730A55F419076784578C028181261B611C95423B85BE3B88A36B97658D` |
| `apps/web/src/AuthGate.tsx` | `03D8EDF7964C47C2DAF1E26458E1C50D9F3E72DF4E63D4C6272B49DC251887D1` |

These hashes identify inspected files only; they do not establish a frozen build or current runtime behavior. The previous connected guide checkpoint reports final repaired-guide 16/16 unit tests and Chromium 1/1 with mocked API, at `.data/qa-prep/uix652-guide-root-final-20261009`; it is historical evidence for its named revision/scope, not a receipt for this checkout or images.

## Capability / role coverage (source inspection, not live acceptance)

| Existing guide group / feature | Surface and role boundary found in source | Coverage status / safe screenshot candidate |
|---|---|---|
| Map & tools: camera, select/move, measure, ping, fog | `LandingGuide` map shortcut groups are data sourced from `MAP_TOOL_SHORTCUTS`; fog entries are marked GM-only. `map-interaction.ts` and renderer implement key semantics; guide content tests compare shortcuts to implementation. | Existing guide coverage, with player-safe map and a GM fog/tools state as separate views. Use neutral empty/synthetic map only. |
| Character | `CharacterWorkspace.tsx` contains the character card/workspace and attributes, skills, abilities, resources, inventory, roll actions. | Landing summary only; role-specific visible controls/compact layout are not evidenced by this screenshot pool. A synthetic character is required. |
| Chat & rolls | `ChatPanels.tsx`, `DiceTrayPanel.tsx`, `QuickRollPanel.tsx` expose chat, dice/roll and GM-only/secret roll affordances; `chatSection` documents send/newline/GM-only shortcuts; commands are explicit in `landing-guide-content.ts`. | Guide coverage exists for keyboard/commands, not a complete role-aware walkthrough. Screenshot only synthetic room/messages and fake roll result; no real identities or payloads. |
| GM preparation / fog / story | Fog keyboard controls have GM markers. `Sidebar.tsx` exposes a Story feed title; source notes Story is hidden from player sidebar (`UIX-467`). | GM-only visual candidate should show preparation context with neutral names/content; player screenshot must not imply access to GM Story. No player-safe projection claim from a screenshot. |
| Direct messages, stickers, attachments | Guide summary mentions these. `ChatPanels.tsx` contains a personal-dialog flow and attachment rendering; the read-only source scan found these code paths. | **Not acceptance of availability, role policy, or stable current behavior.** Do not feature them in the screenshot set until a fixture-backed role/control test and owner approval; avoid personal-message contents and attachment metadata. |
| World maps, story publications, player requests | Guide summary mentions these; `PlayerRequestsWorkspace.tsx` implements a request form/list; Story has a role boundary as above. | Coverage/role mapping is partial. No visual or availability claim without current role-specific fixture verification; never show campaign-authored text. |
| Music | Guide summary describes synchronized playback and local volume. | No playback screenshot in this pool: no current runtime/API acceptance was performed. Keep out of imagery until current control and role behavior verified. |
| Pre-login entry | `AuthGate.tsx` renders `LandingGuide` on the landing path before auth. | Structural source evidence only; no browser-visible access, keyboard reachability, or responsive behavior captured in this pool. |

This map separates what code currently contains from what can safely be advertised as fully available. Existing guide prose was preserved verbatim; this work does not generate replacement copy or certify every summary statement.

## Actual local screenshot receipts

Capture origin: ephemeral Vite URL `http://127.0.0.1:64177/` generated for the capture then closed. Headless Chrome, device scale factor 1. Each PNG is a browser screenshot of `#guide-shortcuts` only; viewport is recorded separately from element pixel dimensions. Fixture boundary: pre-login anonymous state; all `/api/**` requests intercepted; only `GET /api/bootstrap` (401 twice) and `GET /api/public/roadmap-votes` (200 empty twice) occurred. No mutations, credentials, campaign data or authored fixture content. Browser emitted no `pageerror`. At 390×844, `documentElement.scrollWidth <= innerWidth` and the guide panel had no horizontal overflow. This is local mocked browser evidence, not live backend, full landing/login, device, or owner acceptance.

| ID / file | Viewport | Captured state | PNG dimensions | Bytes | SHA-256 |
|---|---:|---|---:|---:|---|
| `.data/qa-prep/uix652-capability-20261009/desktop-guide-expanded.png` | 1280×800 | All guide sections / shortcuts, expanded | 1120×1213 | 180737 | `386756dc5007d4b654775613f99498f0735f52d8f9227adfe53fd80a6e77c044` |
| `.data/qa-prep/uix652-capability-20261009/desktop-guide-search-d20.png` | 1280×800 | Search `/d20`, one matching command group | 1120×262 | 70895 | `d880e909adeb9e9280d46894f67245b70c960b96652c8ad5e3ce9c3939dafe2d` |
| `.data/qa-prep/uix652-capability-20261009/mobile-guide-search-fog.png` | 390×844 | Search `туман`, GM-only fog controls | 358×805 | 78282 | `c4683cf57545a22ad200472ee878394510679ce14797104732cfc70ba4c81942` |

Screenshots are local QA evidence only, not optimized product assets. Before embedding, produce the responsive optimized variants, intrinsic dimensions, lazy loading, concise factual alt text and payload budget; keep placement behind privacy/source review and owner approval. Re-capture after the corresponding source changes; hashes above bind this set to the source fingerprints at this inspection. The earlier full landing/auth view is deliberately excluded.

## Verification and remaining gates

- Local browser: one short-lived local Vite + headless Chrome run at ephemeral localhost port; no server remains running.
- Screenshots: **3 captured** and visually inspected; desktop expanded/search and mobile search. No feature page, character, campaign, authenticated state, private message, or backend path was included.
- Initial rejected capture: one full landing screenshot showed identity labels and was removed; only the three cropped, reviewed images remain.
- Image optimization/product payload: not done; these raw PNGs are local screenshots, not integrated deliverable assets.
- Coverage: source-only inspection of the named guide, auth gate, character, chat, requests and sidebar modules; role policy and live availability remain unverified beyond explicit source markers.
- Keyboard, responsive layout, login reachability, real/backend behavior, device acceptance, owner content approval, and landing-vs-help-center decision remain open.
- Next: root reviews privacy and placement. A later broader visual set still needs safe role fixtures for GM preparation/character/chat and owner approval; current evidence establishes only the pre-login guide panel. Do not close UIX-652 on this artifact.

## Compact checkpoint

- **Decision:** deliver only guide/search screenshots and a source-backed coverage map; defer broader feature imagery and all authored-copy decisions.
- **Revision:** inspected `094824eef0d6d68f54a31e62ba26f3b6b9cf1b58`; concurrent UIX-264 work remains untouched.
- **Changed artifacts:** this document plus three PNGs in `.data/qa-prep/uix652-capability-20261009/`; no product code or source copy.
- **Verification:** one ephemeral localhost Vite + headless Chrome session; synthetic API only; 3 images visually inspected; zero browser page errors; 390px viewport and guide panel showed no horizontal overflow; final screenshot dimensions/bytes/SHA-256 above.
- **Blockers:** no screenshot proof for feature pages, authenticated role separation, live backend, mobile device, or full login reachability; image optimization and owner review remain outstanding.
- **Next action:** root reviews the safe crop/coverage and decides whether to authorize a separate synthetic role-fixture capture. UIX-652 stays open.
