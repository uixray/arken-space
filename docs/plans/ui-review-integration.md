# Local UI review candidate — 2026-09-12

Status: source integration only. Not published, deployed, or runtime accepted.

## Inputs and preservation

Accepted source base: `93935933738c78f459b8a0fa1c4d13747f82c8e3`.
The existing forms worktree now holds `codex/ui-review-integration`; no additional
worktree, dependency installation, generated assets, or application process.
The original branch tips remain unchanged:

| Pool | Preserved source revision | Integrated behavior |
| --- | --- | --- |
| UIX-421 / UIX-589 | `fe0af95c7de6b841d4e71b4ab82312b06c2671b9` | Form errors and focus; upload prerequisites; repeat image selection; finite MP3/OGG candidate intake |
| UIX-644 | `d0ff49f02539f6ffb3418abeb9795917276b1dfd` | Owned sticker popup lifecycle; first Escape belongs to nested Select, second to workspace |
| UIX-645 | `f593a2fc5651be1d9de7adfc43d5753f81901a03` | Shared Lucide/AppIcon; accessible action names and scoped source policy |
| UIX-289 | `803602fdcecb94f21ba25716f45420b78f9aa6c4` | Explicit dice semantics and decorative frame validation at the client boundary |

## Integration decisions

- Merge histories retained, not squashed into an unrelated working tree.
- StickerPicker import conflict: preserve BOTH Popup ownership/lifecycle and
  AppIcon. No return to inline positioning, overflow escape, or z-index 1250.
- Image intake test conflict: preserve all reset/reselect/cancel/disabled/URL
  cleanup cases AND the decorative delete-icon assertion. Reuse the per-test URL
  method mocks rather than replacing the global URL class again.
- Automatically merged ArkenDialog keeps nested/portal Escape guards and both
  Lucide window actions. WorldContent keeps validation/control refs and reorder
  icons. Concept browser coverage keeps upload cases and the portalled picker
  locator. Dice semantics do not depend on player theme or the icon migration.
- Audio removal now shares the image field's DeleteIcon and accessible filename
  label. Its real MediaPanel caller test asserts the decorative SVG and disabled
  removal during submission. Scoped icon policy covers 29 source files including
  AudioUploadField; it is not a claim of repository-wide icon coverage.

## Required connected validation

No test in this candidate has been executed on the combined source. Source review
and Git whitespace/conflict checks are not TypeScript, lint, Vitest or browser
acceptance. Prior accepted-base CI does not cover these changes.

1. Prepare an explicitly authorized, isolated environment for THIS candidate's
   exact lockfile. The earlier forms-only dependency comparison is superseded:
   merging Lucide changes both the web manifest and pnpm lock. Do not borrow or
   modify production node_modules or assume existing package dist provenance.
2. Run formatting, lint, type/build and the actual icon source policy, then the
   real DOM/caller suites for image/audio/MediaPanel, WorldContent, ArkenDialog,
   StickerPicker and the dice unit/ChatPanels rendering suites. Do not mock away
   real Gravity controls or substitute static parsers for DOM acceptance.
3. Run the prepared browser scenarios as one connected UI pool: concept uploads,
   workspace-select-escape, sticker-picker-lifecycle, player-requests-controls,
   russian-world-copy and existing overlay/focus/compact-journal regressions.
   Confirm GM/PLAYER, narrow/desktop, role restrictions, focus and no unintended
   writes. Native OS chooser behavior and real audio decoding remain separate.
4. If authorized later for release, retain exact-head CI, integrated-main,
   backup/rollback and deployed role/device acceptance gates. No automatic issue
   closure, publication or production changes are granted by this plan.

## Current blocker and next action

The assessed private test environment lacks the DOM test dependencies. Browser
system-library readiness is separately blocked. No local heavy runner is allowed;
no install or alternate browser/server bypass was attempted. Hold this candidate
for scoped environment preparation and connected verification. Keep private
technical receipts local; external issue synchronization remains subject to its
existing authorization boundary.
