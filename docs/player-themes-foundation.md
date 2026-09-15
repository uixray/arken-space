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
The whole isolated run took 64 seconds and did not start a database or Docker.
The earlier inspected bundle included a recorded one-string correction; the
rebuilt artifact is retained separately and has not had a second visual pass.

## Acceptance still to perform

- Inspect the pristine final bundle before promoting this foundation to a release.
- Complete real control/text/focus and transition contrast across all seven themes.
- Check light-mode portals, keyboard focus and responsive states.
- Add approved subtle materials and validate contrast against their actual pixels.
- Implement the profile adapter and validate authenticated handoff/persistence.
- Migrate shell/chat/character/GM/canvas-adjacent surfaces in connected pools.

Source-level checks or a Storybook screenshot alone do not close UIX-317.
