# UIX-652 guide screenshot gallery — 2026-10-09

## Checkpoint

- **Scope:** integrate the three previously reviewed, privacy-safe guide captures into the existing pre-login `LandingGuide`. No authored prose was changed; captions are short state labels. Gallery is collapsed by default and responsive when expanded.
- **Starting source:** checkout revision `094824eef0d6d68f54a31e62ba26f3b6b9cf1b58`; concurrent UIX-264/audio/backend edits remain out of ownership. This is a dirty local checkout, not a candidate build.
- **Product files:** `apps/web/src/LandingGuide.tsx`, `apps/web/src/landing-guide.css`, `apps/web/src/LandingGuide.test.tsx`, `tests/e2e/uix652-guide-gallery.spec.ts`; optimized public assets under `apps/web/public/assets/guide/`.
- **Optimization:** PNG captures retained as local QA evidence under `.data/qa-prep/uix652-capability-20261009/`. Derived lossily encoded WebP assets preserve the actual pixel dimensions. Aggregate source PNG size 329,914 bytes → WebP 101,804 bytes (~69.1% reduction):

| Asset | Intrinsic size | Bytes | SHA-256 |
|---|---:|---:|---|
| `desktop-guide-expanded.webp` | 1120×1214 | 61,720 | `e57dcfcc18dd7da3f1cba40088fa5d765cf533163f5177e22b2a2328d6cdfe28` |
| `desktop-guide-search-d20.webp` | 1120×262 | 14,946 | `710ce9161ac0a3a4e0401c470d73ffaeb824b9be86576131089a6f8824fff86f` |
| `mobile-guide-search-fog.webp` | 358×807 | 25,138 | `67a99c9ce861602b4a80c4ff34dafa1eb6f3a6ad4928b335247f3ddbec6e6383` |

  Intrinsic sizes were decoded from the actual PNG/WebP pixels in Chrome; they correct the earlier screenshot table's stale 1213/805 height values. No pixels were redrawn or cropped. Alt text identifies visible UI state and role marker; image `width`/`height`, `loading="lazy"`, `decoding="async"`, responsive `sizes`, and mobile single-column CSS are present.
- **Unit test:** `apps/web/src/LandingGuide.test.tsx` asserts 3 nonempty alt descriptions, lazy/async loading, positive intrinsic attributes and local WebP paths.
- **Build:** from `apps/web`, `node node_modules/vite/bin/vite.js build` — PASS, Vite 8.2.1, 4,768 modules transformed. Built output contains all three exact WebP files.
- **Unit verification:** from `apps/web`, with `TEMP`/`TMP` redirected to `.data/qa-prep/uix652-guide-gallery-20261009/tmp`, `..\..\node_modules\.bin\vitest.CMD run src/LandingGuide.test.tsx` — 1 file / 6 tests PASS.
- **Browser render:** Headless Chrome rendered the exact gallery markup with the new asset payloads, generated design tokens and owned guide CSS at 390×844 and 1280×800. Both viewports passed intrinsic-dimension equality, lazy/alt checks, and document/gallery overflow checks. Visual receipts: `.data/qa-prep/uix652-guide-gallery-20261009/mobile-gallery-preview.png`, `desktop-gallery-preview.png`; machine receipt `browser-render-receipt.json`. Scope is the standalone gallery render, not an app/session/backend acceptance.
- **Full app E2E limitation:** added `tests/e2e/uix652-guide-gallery.spec.ts` for the normal Chromium E2E runner, synthetic API stubs, successful local image responses, responsive overflow checks and browser screenshots. It was not run: available shell/browser network permissions reject localhost sockets (`ERR_NETWORK_ACCESS_DENIED` / socket access denied), and the E2E configured port was busy despite no enumerated listener. A Vite port-0 process was briefly tested and stopped; no server remains running. Do not count the standalone Chrome gallery render as full-app integration E2E.
- **Privacy boundary:** gallery reuses only the three already-reviewed crops from the cited capability evidence. They show anonymous guide content and visible public keyboard hints; no account/campaign/person identity or API payload is included. No backend, remote service, credentials, authored campaign content, or private captures used.
- **Blockers / non-claims:** this does not provide screenshot proof for character/chat/GM preparation feature pages, role-specific authenticated behavior, full landing/login access, live API, external host, mobile-device or owner acceptance. Source screenshot images are evidence from the prior guide capture state, not a newly captured runtime after UI integration. UIX-652 remains open.
- **Next:** root reviews gallery placement/captions and the connected browser result when localhost browser QA is available; reconcile this pool to a later candidate before any release evidence. Do not close the issue from this slice.

## Root integration gate (supersedes full-app limitation above)
- 2026-10-09, root used a dedicated elevated loopback Vite at 127.0.0.1:14246, not retained QA/production or the user stand. Initial sandbox listener was not reachable by elevated runner; its configured webServer timed out. No product test failure claimed from that environment timeout.
- Updated only this pool's E2E stub to provide explicit account capabilities for the newly introduced AuthGate mode selection; no real account/token involved.
- `E2E_PORT=14246 E2E_BASE_URL=http://127.0.0.1:14246 node node_modules/@playwright/test/cli.js test tests/e2e/uix652-guide-gallery.spec.ts --project=chromium --reporter=line`: PASS 2/2, 5.9s test duration. Real app markup and WebP asset HTTP responses at mobile390/desktop1280, no overflow or unexpected mutations; API remains mocked.
- Root visually inspected mobile-gallery.png: all three images/captions render within the compact column. Small text inside screenshot previews is illustrative, not a substitute for the accessible actual guide.
- This removes the gallery full-app integration blocker only. It does not prove real authentication/backend, device usability, all feature screenshots or full UIX-652 acceptance.
