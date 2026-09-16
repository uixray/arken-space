# Player themes: opt-in foundation

UIX-317, implementation started 2026-09-15. This is a migration step, not
completion of the profile/theme feature or approval of the full design system.

## Preserve the approved direction

The owner approved six dark palettes (forest, dragons, ice, fire, gold, silver)
and one light palette. Their source is the existing `ui-foundation-01` design
configuration, derived from the approved controls/game-screen concepts.
Do not invent replacement colors while transferring them to product tokens.

The product's `--color-*` vocabulary remains canonical. Compatibility aliases
point toward it, never back. An absent `data-player-theme` attribute preserves
the existing system appearance. Choosing `system` must not silently mean forest.

The opt-in Gravity bridge maps presentation roles only. It does not change
portal ownership, layer numbers, saved drawing colors, fog, ruler operations,
critical outcomes, magic schools, permissions or gameplay. Choosing a player
theme does not mean choosing a different player.

## First consumer

`Design system/Player themes` in Storybook uses the real product form wrappers
and Gravity controls. It provides editable/read-only/invalid/disabled/loading
states and the seven palette choices. Its state is local to the story and its
root attribute is restored on unmount. It does not save an account preference.

Neither the generated theme stylesheet nor the bridge is activated in the main
application by this first step. Texture assets, typography and layout migration
are not completed by transferring color values. Existing generated base tokens
must remain unchanged and both generated outputs must be covered by drift checks.

## Persistence is still required, not replaced

The current authenticated identity is a campaign membership. There is no editable
cross-campaign account/profile preference model or theme publication API yet.
Existing localStorage preferences cannot satisfy UIX-317's persistence criteria.

Do not infer cross-campaign identity from display names, character ownership or
the static beta-player directory. Do not store a durable default on a session,
character or shared campaign merely because those tables already exist. The
profile/authentication mapping and persistence scope must be settled before
implementing the server adapter; this foundation does not settle them implicitly.

The complete feature still needs profile defaults, authenticated save/reset,
published-only theme projection, safe fallback, no-flash application and shared-PC
cleanup/late-response handling. Public catalog data must omit private profile data.

## Scoped verification

The initial isolated preflight passed registry tests (4/4), web typechecking,
scoped lint/format and byte-for-byte generation checks for all three generated
outputs, including the unchanged base stylesheet. It did not run the full suite.

Browser inspection of the real controls found and corrected an error-text token:
text on a normal surface uses `--state-error-ink`, not the white text intended
for a filled danger button. The corrected light-theme error measures 4.77:1.
Enabled primary-button text measures 7.73, 6.19, 8.26, 5.67, 8.86, 10.21 and
4.65:1 in forest, dragons, ice, fire, gold, silver and light respectively.
These are settled, solid-color states, not an all-states accessibility claim.
Measurements taken during the 150ms color transition are not steady-state ratios.

The final connected preflight also passed after the source correction and early
CI token-drift step: scoped format/lint, full web typecheck, 4/4 focused tests,
three deterministic generated outputs and the actual-controls preview build.
Native keyboard QA then found a missing UIKit text-input/text-area outline hook;
the bridge now maps those hooks and active/error borders explicitly. Both fields
show a solid 2px focus ring in all seven themes; measured ring-to-surface contrast
is 6.18–15.43:1. The 390px control fixture has no horizontal overflow. The light
select popup is opaque and readable; arrow/Enter selection, Escape dismissal and
system fallback preserve form data. These are scoped controls checks, not full
mobile, layered-dialog or device acceptance.

The corrective gate passed all five focused tests, formatting, lint, web types,
deterministic token generation and the preview build in 64 seconds. It did not
start a database or Docker. The pristine rebuilt artifact was independently
opened to confirm input/textarea focus and the light error state. Earlier patched
QA assets and original build artifacts are retained separately in the checkpoint.

## Acceptance still to perform

- Complete real control/text/focus and transition contrast across all seven themes.
- Check light-mode portals, keyboard focus and responsive states.
- Add approved subtle materials and validate contrast against their actual pixels.
- Implement the profile adapter and validate authenticated handoff/persistence.
- Migrate shell/chat/character/GM/canvas-adjacent surfaces in connected pools.

Source-level checks or a Storybook screenshot alone do not close UIX-317.

## 2026-09-16 — deterministic token contrast guard

`tests/player-theme-contrast.test.ts` now guards all seven configured palettes.
It composites rgba surfaces before sRGB linear-luminance comparison, enforces
4.5:1 for normal/muted/faint/error text on canvas/surface/overlay/raised roles,
field text, enabled primary default/hover/active text and filled-danger text;
focus-to-surrounding-surface and field-border contrast must reach 3:1.
Black/white, equal colors, translucent black and a below-threshold gray calibrate
the calculation. All eight focused cases passed, plus scoped lint and format.
No palette, generated output, runtime stylesheet or identity preference changed.

This is steady-state configured-color evidence only. It does not establish actual
cascade, textures, animated transitions, focus geometry, disabled/read-only
semantics or shared-PC privacy. Existing runtime and persistence gaps remain.

## Explicit baseline preference — 2026-09-17

An explicit `selectedThemeId: "system"` wins over any supplied personal default. Clearing the override is `null`/absence, not `"system"`: only clearing returns to the personal default. This distinction is tested for all seven theme defaults, including a serialized preference round trip. It is a configuration-resolution test, not proof of database persistence or shared-PC handoff. `system` continues to mean no data-player-theme attribute; it is not a separately versioned frozen legacy theme. The requested permanently selectable old appearance still requires that distinct preservation/migration gate. Account-versus-membership persistence remains unresolved and is not chosen by this fix.

## Semantic contrast guard — 2026-09-17

`tests/player-theme-contrast.test.ts` checks 47 declared role pairs for each of the seven
palettes (329 comparisons): primary/muted/faint/accent text over seven flat
surfaces; focus over those surfaces; error copy over form/raised/overlay surfaces;
field text/border/focus; primary button text on default/hover/active fills. Text
uses 4.5:1 and the checked non-text roles 3:1, without rounding passing values up.
RGBA layers are composited onto the declared surface before luminance is measured.
Missing tokens, low-contrast field ink and lost focus are negative test cases;
black/white, near-threshold gray and alpha arithmetic validate the calculation.

This is a configuration guard, not WCAG certification or rendered-pixel acceptance.
It does not cover images/textures, opacity inherited from ancestors, animation
intermediates, all disabled/read-only states, actual focus-ring geometry, or the
whole CSS cascade. Palette source and generated outputs were not changed.

**Known conditional risk, not a current screen failure:** light `state-error-ink`
on the hover/active/selected tint composited over `color-surface` measures about
4.1866:1. Those are not the current error-copy surface contract checked above.
Do not put small error text on those tinted surfaces without a rendered check and
a contrast-safe treatment. Keep this open in the component migration; do not
claim that every possible combination of the approved tokens is accessible.

### Consolidation, preserving prior coverage

The earlier root test already guarded theme contrast. The later overlapping test
under `apps/web/src/design-system` was merged back into that original root suite,
not left running twice. The unified 47-pair matrix retains the original extra
cases: error text on canvas, field border against its surrounding surface, and
filled destructive-button text. Equal-color and black-alpha calibration cases
are retained alongside the new negative/missing-token cases. No palette changed,
no prior acceptance scope was removed, and the conditional light error-on-tint
risk remains open.
