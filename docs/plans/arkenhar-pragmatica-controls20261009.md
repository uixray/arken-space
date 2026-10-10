# Pragmatica Next + remaining-controls pool — 2026-10-09

## Decisions and implementation
- Owner chose supplied local Pragmatica Next; public auth remains deferred. Local QA media gaps do not block unrelated development.
- Exact supplied WOFF copied to `apps/web/public/assets/pragmatica-next_vf.woff`: 343,264 bytes; SHA256 `7B4E50EC50C782077EE147CA5D8DB8C4843BC7DD72FF8F133C2458E45347252D`.
- Actual `fvar`: `wght` min/default/max 100/400/900; `wdth` 10/100/400. Declare variable ranges in one face, retain normal width 100%; no static-weight file substitution. Existing normal/bold CSS weights remain within range.
- Canonical `tokens/typography.tokens.json` updated and CSS regenerated; remove Gravity Google Inter import. Override Gravity family at `.g-root`, where its own variables otherwise shadow `:root`; fix foundation alias to canonical `--font-family-sans`. Monospace preserved.
- Public redistribution rights for this supplied font have not been independently verified; do not invent a license. This does not stop authorized local integration.

## Connected verification
- Root six related Vitest files: **34/34 PASS** (font contract, WorkspaceNav, GravityFormControls, GlobalStickerPackManager, ScenePicker, PlayerRequestsWorkspace). No mass failure observed in this scoped pool; no claim that all repository tests ran.
- Root **full `pnpm typecheck` PASS**, including all workspace packages, E2E and config TypeScript. Earlier sandbox/dependency diagnostics are not confirmed repository defects.
- Fresh root `pnpm --filter @arken/web build` **PASS**, 4,760 modules; existing large-chunk warning retained. Local WOFF included, no production Google font import. This is a local web build, not a deployed image.
- Font browser gate: **4/4 PASS**, Chromium/Firefox ×390/1440. Actual local WOFF200; loaded Cyrillic/Latin at400/600/800; body/Gravity family verified; no Google font requests. Desktop and compact screenshots inspected; no typography clipping found in observed shell. Mocked API/socket, not campaign/public-auth acceptance.
- First font browser run failed an over-strict CSS custom-variable whitespace assertion in all four cells. Normalize whitespace only; semantic family expectation unchanged. Retain failure as test assertion defect, not mass product breakage.
- Controls gate: **4 PASS / 2 SKIP**, Chromium/Firefox. Desktop1024 actual pointer+Home/End/Enter scene selection, emitted `scene:view` IDs, Escape/focus return. Compact PlayerRequests six custom comboboxes use actual `page.keyboard` navigation, intermediate option-focus assertions, Enter selection/focus return and resize state retention. No target-option `press` refocusing shortcut.
- Two explicit skips: desktop ScenePicker intentionally hidden at390; never promoted to PASS. Reachable compact scene-manager path is a separate next pool. API/socket fully mocked; no credentials/backend mutations/native OS proof.
- Exact-worktree owned Vite: loopback14243, root session27924. Do not reuse unrelated14183 UI as revision proof.

## Artifacts and next action
Tracked: font asset, canonical/generated typography, main import, styles/foundation and three regression tests. Private local browser artifacts: `.data/qa-prep/pragmatica-controls-20261009-final/`; corrected keyboard run uses `.data/qa-prep/remaining-controls-20261009-keyboard-final/`.

Next connected pool: reachable compact scene editor and StatLayoutCard owner lifecycles; operator local ACL/browser regression. Original historical RO FAIL, native/true zoom/human acceptance and trusted remote/report verification are separate unclosed criteria. No deploy, push, merge, remote start or task closure inferred.
