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

## Preserved pre-theme appearance: classic-v1 — 2026-09-17

The pre-theme **local candidate appearance** is now archived independently of
Codex's temporary visualization folder at:
`D:/AI/personal/experiments/arken-space/asset-library.local/appearance/classic-v1/`.
This ignored local library is not a new production deployment or public upload.

- Build source: `1ea7051b56092551423546ae9a507a22069f9f62`.
- Last app-rendering change in that build: `7b4af10beef8ec1cbd59d96ecce49c88622cf2c2`.
- Full compiled bundle and source maps, eight synthetic GM/PLAYER shell screenshots
  (1280/390, Chrome/Firefox), and existing verification receipts: 17 archived files,
  8,834,459 bytes. Every copied file was re-read and matched by SHA256/size.
- Archive manifest SHA256:
  `b0fad4cd42bc4fc59e54207883439fa9d3c63a61a10ae365f8099c7ae9352f3d`.
- Compared with the current checkout at preservation time, only the opt-in theme
  resolver and its tests changed under `apps/web/src`; current application entry
  still does not load that resolver. The build was reused, not regenerated.

The archive is versioned and must not be overwritten. It records the agreed
preservation boundary before theme migration, not a frozen copy of the previously
released production application. It has no campaign database, player media or
credentials. Google Fonts Inter remains external; offline pixel-perfect font
reproduction is not established.

**Still required:** implement a selectable, independently versioned classic theme
that reproduces this appearance while keeping current behavior, permissions,
fixes and accessibility. Do not restore the archived JavaScript application to
implement a theme, and do not alias classic-v1 to the mutable `system` fallback.
Registration, selection persistence and actual-theme comparison with these
reference screenshots remain unimplemented. The archive alone does not close
UIX-317 or the owner's “keep the old appearance selectable” requirement.

## Reused-story state gate — 2026-09-17

`apps/web/tests/fixtures/player-themes` mounts the existing
`PlayerThemes.stories.tsx` component with the application stylesheet order.
It does not implement a second theme UI or activate themes in the main app.
The former isolated preview covered field focus and settled colors; the new
`tests/e2e/player-theme-states.spec.ts` covers the missing semantic/keyboard states.

Chrome and Firefox each exercised all seven themes at 390px: read-only owner
remains focusable and immutable; empty/duplicate resource disables Add with an
accessible reason; loading Save is disabled and skipped by Tab; valid resource
makes Add focusable; Cancel resets the field; Space toggles the labeled checkbox.
Theme changes preserve the read-only value, system reset removes the opt-in
attribute, and no API requests/pageerrors occur. Two tests/14 theme-browser
combinations passed in 18.1 seconds. No new contrast or screenshot acceptance is
claimed by this state-only test; inherited opacity, textures and visual distinction
of all states still need rendered measurements. No account/profile persistence or
GM/PLAYER permission boundary is modeled by this story.

## Read-only visual cue — 2026-09-17

The shared Gravity foundation now gives enabled native readonly text inputs and
textareas a dashed frame. It leaves text opacity/color and native selection intact;
disabled controls (including readonly+disabled) keep their existing appearance.
Editable inputs keep solid borders. A readonly keyboard-focus outline explicitly
uses the existing focus tokens; the dashed frame never replaces the focus ring.
The selector uses `[readonly]`, not the broad `:read-only` pseudo-class that would
also match unrelated controls. No permission or mutation behavior is changed.

The existing story adds readonly textarea and disabled input/textarea examples.
Its existing keyboard/invalid/loading tests passed in both browsers after this
change. A new test covers system plus seven palettes in Chrome/Firefox: dashed
versus solid frames, native Tab entry, 2px solid focus, select-all and immutable
Backspace, explicit in-document keyboard exit, and disabled precedence. Final
new-test run: 2/2 PASS, 16 theme/browser combinations, 19.7 seconds. No pageerrors
or API calls. A Firefox test assumption was corrected: Tab from the document's
last enabled control can move into browser chrome while document.activeElement
still names the textarea; the test now checks Shift+Tab to the prior checkbox.

System Chromium and light Firefox screenshots were inspected: no clipping in the
390px fixture, readonly remains readable without disabled dimming. This is not
all-theme contrast certification, real clipboard permission coverage, application
ACL verification, or full application theme migration. The archived classic-v1
reference remains immutable; this accessibility change is part of the current
candidate, not a replacement of its archived historical bundle.

## Versioned classic color adapter — 2026-09-17

`classic-v1` / **Прежнее оформление** is now a separate registry choice in the
existing real-controls story, not an alias for `system`. Its 16 presentation
colors are frozen as resolved DTCG values in
`tokens/player-themes/classic-v1.tokens.json`, derived from
`tokens/color.tokens.json` at archived build revision
`1ea7051b56092551423546ae9a507a22069f9f62`. Git confirmed that source had not changed
before extraction. Generation reads this frozen file, never the current base
palette. The unit guard fixes its version and token-content digest. Success,
card/game colors, geometry, responsive overrides and layer ordering are not
captured or overridden by the color adapter.

The existing generator emits classic into the same CSS and typed registry outputs;
its classic-specific allowlist does not relax the seven personal palettes' exact
key validation. Existing `tokens:check` already includes both generated outputs.
The personal Gravity bridge excludes classic: classic retains the original UIKit
dark appearance, while the seven approved palettes retain their bridge. Explicit
classic overrides a profile default; explicit system still overrides classic as a
default. These are configuration rules, not persistence claims.

### Verification and limits

- 26 focused unit tests passed (registry/resolver/frozen classic plus the original
  seven-palette contrast suite). Classic is **not** added to the personal-palette
  contrast certificate: preserving the old palette does not establish every
  legacy text/control state meets the newer contrast requirements.
- Six Chrome/Firefox browser tests passed in 46.5s with one worker: existing state
  tests now loop eight registry themes; readonly tests cover system plus eight;
  the new classic test checks a light-to-classic switch, preserved draft, exact
  computed rendered styles/geometry and byte-identical section screenshots versus
  current system in each browser. Test-only system color drift changes system but
  not classic; gameplay success color continues inheriting outside the adapter.
- Initial screenshot comparison differed by two corner pixels; simply disabling
  animations did not settle it. Final captures freeze animations before both
  images and sample computed styles/geometry before capture. The final test retains
  exact comparisons: no pixel allowance, no masking. The cause of the transient
  two-pixel raster difference is not proven; traces/reports were retained.
- Scoped lint, web and E2E typechecks, format and deterministic generator checks
  passed. The cleanup of the injected test stylesheet was adjusted to the generic
  DOM Node type after the browser run; no product behavior changed in that fix.

This is the **color/registry adapter**, not the completed selectable classic theme
in the application. Full shell/chat/character/canvas-adjacent migration, stable
classic typography/materials/component styles, comparison to the archived full
application screenshots, user-facing application selection, account storage and
reload/relogin remain open. The application entry still does not activate themes.
The classic archive is unchanged; new accessibility fixes are not rolled back.

## Baseline text-control focus — 2026-09-17

A native Tab regression confirmed that baseline editable TextInput had no computed
wrapper outline: UIKit's dedicated focus hooks were mapped only in the opt-in
personal-theme bridge. The native input selector in styles.css did not provide the
component wrapper's ring. This was not merely a missing theme-preview assertion.

The two dedicated outline-color hooks now live once in the shared Gravity
foundation's `.g-root`, referencing `--color-focus`. Removed the duplicate mappings
from the opt-in bridge. This applies to the currently loaded application without
activating themes; theme colors are inherited normally. Readonly-specific dashed
frames and focus geometry, control sizes, palette values and permissions remain
unchanged. Blur removes the outline. No focus-management JavaScript was added.

Verification: initial Chromium RED (native Tab reached Name, outline none), then
8/8 connected browser cases PASS68.274089s in Chrome/Firefox, one worker/retries0:

- New real-controls case checks input and textarea native Tab focus, solid2px ring,
  canonical focus color, full opacity, solid editable border, viewport horizontal
  fit and no lingering ring after Tab leaves. Covers system plus8registry choices
  at1280/390 in both browsers (36appearance/viewport/browser combinations).
- Existing actual-App GM character-template cases additionally check keyboard
  return to the name field and2px ring, at1280/360 in both browsers, preserving
  the original popup/resize/Escape assertions.
- Existing actual-App PLAYER pending-backstory cases additionally check native
  Tab from disclosure into textarea and2px ring, preserving journal/rotation,
  target-size and pending-draft assertions.

26focused registry/contrast tests, scoped lint, E2E typecheck and format/diff checks
passed. Baseline Chrome name and light Firefox textarea screenshots were visually
inspected: clear uncut focus with no layout displacement. No new all-state contrast,
physical-device or every-caller visual acceptance is claimed. No full suite, build,
CI or deployment. The immutable classic reference archive remains unchanged;
current shared accessibility fixes are intentionally not rolled back by classic.

## Reduced-motion dialog lifecycle — 2026-09-17

A new case in the existing workspace-select-escape.spec.ts exercises the actual
App character-creation dialog, not the isolated theme story. With the browser's
prefers-reduced-motion initially enabled, it types the draft, selects a template
with Arrow/End/Enter, reopens the menu, changes the preference off/on while open,
resizes1280×800→360×640, and verifies option hit-testing, Escape at both levels,
return focus, preserved name and the current2px field ring. No save is submitted.

Both Chromium and Firefox passed (2/2,14.615086s, one worker/retries0). At initial
open and after live preference change/resize, document.getAnimations reports no
running DOM animations; dialog/popup computed transition-duration is0s,
animation-name none and scroll-behavior auto. No additional CSS override, mocked
matchMedia, forced-open state or animation suppression was installed by the test:
it exercises the existing product media query. No pageerrors or unexpected API
mutations occurred. The compact Firefox screenshot was visually inspected: the
name field, template, explanatory text and footer fit the dialog.

This confirms one real modal/select lifecycle, not every UI or canvas animation,
physical OS/device settings, a theme transition, or the complete reduced-motion
acceptance of UIX-317/316. Runtime code did not need changing. Scoped ESLint,
E2E typecheck, Prettier and diffcheck passed; no full suite/build/CI rerun.

## Startup error semantics and recovery — 2026-09-17

The shared ErrorState now exposes `role="alert"` and `aria-atomic="true"` on
its existing root, so asynchronous failures have explicit important-message
semantics. EmptyState stays non-live; LoadingState keeps its existing status
semantics. No extra wrapper, CSS, focus movement, retry implementation or server
behavior was added. The same ErrorState is used by campaign bootstrap and music
upload failure; this gate exercises bootstrap, not audio upload.

A new real-App startup-recovery.spec.ts holds the retry response: a503bootstrap
failure renders the error title/message and retry; Enter starts exactly one
retry, error/retry disappear while loading status is present; releasing a valid
snapshot opens the application and removes the old loading/error screen.
Chrome and Firefox at1280/390 passed4/4 in17.26082s. Every receipt records one
retry, no pageerrors and no writes. The fixture explicitly permits diagnostic
client-logs for the deliberately induced API failure and bootstrap chat/read;
neither was emitted in these four runs. Other writes are blocked/rejected.

Initial Chromium RED confirmed the missing alert role. Final web/E2E typechecks,
scoped ESLint, Prettier and diffcheck passed. This proves browser DOM semantics
and mocked-network recovery, not spoken VoiceOver/NVDA output, real-server outage
recovery, music upload failure behavior or completion of the full state matrix.
No full suite/build/CI/deployment was performed.

## Image intake error association — 2026-09-17

ImageUploadField now associates its hint and current validation error with the
native file input, visible picker button and enabled empty-state dropzone using
instance-local IDs. The native input exposes aria-invalid only while an intake
error exists. The existing alert remains; no MIME policy, preview lifecycle,
file callback, network request or layout changed.

The connected component gate passed 17/17 tests (44.41s, one worker), including
new accessible-description assertions before rejection, after rejection, after
successful recovery and after removing a retained file. Rejecting an invalid
replacement preserves the previous image. The existing cancellation, repeated
file, picker/drop/paste, disabled and object-URL cleanup tests also passed.
Scoped ESLint, web TypeScript, formatting and diffcheck passed.

Scope: jsdom with the existing native-button Gravity mock, not real browser
accessibility-tree or spoken screen-reader verification. No full suite/build,
production upload, publication or Linear completion is claimed.
