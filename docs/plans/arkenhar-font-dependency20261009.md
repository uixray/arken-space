# ArkenHar — external font dependency assessment, 2026-10-09

## Scope and evidence

- Read-only inspection at worktree HEAD `d5231ca8b1a48b712b91a11c9eb677a9aad5a927`; no product or runtime files changed.
- The source import is explicit in `apps/web/src/main.tsx`: `@gravity-ui/uikit/styles/fonts.css`, followed by `@gravity-ui/uikit/styles/styles.css`.
- Resolved local package is `@gravity-ui/uikit@7.43.0`. Its `styles/fonts.css` contains `@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap");`. `styles/styles.css` assigns Gravity's sans family as `"Inter", "Helvetica Neue", "Helvetica", "Arial", sans-serif` to body, caption, header, subheader and display roles.
- Built CSS under `apps/web/dist/assets/` includes the same external Google Fonts import. That matches the reported fail-closed QA request to `fonts.googleapis.com`; no external allowlist exception was added.
- ArkenHar's authored `apps/web/src/design-system/tokens.generated.css` separately defines `--font-family-sans` as `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` and documents a system font with no project-loaded faces. The app's normal CSS uses this token; the Gravity kit's own typography defaults to Inter-first.
- File inventory only: no `.woff`, `.woff2`, `.ttf`, `.otf` or `.eot` files were found under `apps/web/src` or the installed Gravity UI kit. `fonts.css` points outward rather than packaging font binaries. The package metadata declares MIT and the package has a LICENSE file; this establishes the library's metadata only, **not** the license/provenance of Google's Inter font files.
- No vendor file contents were opened, downloaded or copied; no web, remote, browser, runtime or integration was used. Exact package version and file presence/length were inspected locally.

## Assessment

- The app has an authored, local system-font stack that remains available when the remote font stylesheet is blocked. This is a fallback, not proof that the intended Gravity UI look/metrics were visually accepted.
- The external request is a real network/privacy and availability dependency: a visitor's browser must reach Google Fonts for Inter to apply; otherwise typography falls through to Helvetica/Arial/system sans. This consequence is inferred from the import and CSS family order, not a measured visual comparison.
- Existing per-file QA reports a fail-closed blocked stylesheet; scoped control/function assertions can pass with fallback, while full visual/font acceptance remains open. Do not convert that into a clean-network or visual PASS.

## Bounded next step / decision

Do **not** silently edit typography or widen external-network policy. At the next approved source pool, choose one explicit contract:

1. **Prefer local/system-only for this small friends service:** remove the `fonts.css` import and explicitly align Gravity's `--g-font-family-sans` with the existing authored system stack (in app-owned CSS, not a node_modules patch). Then rebuild the exact candidate and run a focused visual comparison of representative Gravity UI/login/form/dialog text with network blocked. Owner/design acceptance is still required; the current fallback QA is not that acceptance.
2. **If Inter is a product requirement:** obtain a separately approved, provenance- and license-verified font asset through an authorized source; add it locally with precise weights/subsets and font-display/fallback behavior, remove the third-party runtime stylesheet dependency, and perform the same blocked-network visual check. No font binary or license source is currently present locally, so this path has a sourcing/approval prerequisite.
3. **Retain Google Fonts only by explicit owner decision:** knowingly accept the third-party request and its runtime availability/privacy implications, then separately approve the required egress/CSP policy and repeat network+visual QA. A QA block is not authorization to allow it.

Recommendation is option 1 unless the owner explicitly requires Inter; this is advice, not a typography decision or source change. Native-device, human visual acceptance and full release gate remain distinct.

## Compact checkpoint

- Decision: document the exact external dependency; no source edits or network-policy changes.
- Revision: `d5231ca8b1a48b712b91a11c9eb677a9aad5a927` at inspection; product source lineage remains separately identified by project checkpoints.
- Changed files: this new assessment only.
- Verification: confirmed `main.tsx` import, installed package stylesheet/family order, authored system token, CSS build output import, package metadata, and zero local font binaries in the bounded source/package directories.
- Blockers: no locally verified Inter binary/license provenance; no human visual acceptance under the approved fallback.
- Next: owner chooses the typography/network contract; only then make a narrow source change and run blocked-network visual QA.
