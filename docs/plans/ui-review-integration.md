# Connected UI review candidate — 2026-09-15

Status: source integration only. Not published, deployed, or runtime accepted.

## Inputs and preservation

Released source base: `54b5006a782939ccb9e0c4317d195eda3f07b1e3`.
The prior private candidate `cc58a74d2b492e1f9cba85ff156a63ded4b28dfd`
is being reconciled with that exact base, preserving both histories. Earlier
targeted checks on the private candidate do not prove the new combined source.
The existing forms worktree now holds `codex/ui-review-integration`; no additional
worktree, dependency installation, generated assets, or application process.
The original branch tips remain unchanged:

| Pool              | Preserved source revision                  | Integrated behavior                                                                                  |
| ----------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| UIX-421 / UIX-589 | `fe0af95c7de6b841d4e71b4ab82312b06c2671b9` | Form errors and focus; upload prerequisites; repeat image selection; finite MP3/OGG candidate intake |
| UIX-644           | `d0ff49f02539f6ffb3418abeb9795917276b1dfd` | Owned sticker popup lifecycle; first Escape belongs to nested Select, second to workspace            |
| UIX-645           | `f593a2fc5651be1d9de7adfc43d5753f81901a03` | Shared Lucide/AppIcon; accessible action names and scoped source policy                              |
| UIX-289           | `803602fdcecb94f21ba25716f45420b78f9aa6c4` | Explicit dice semantics and decorative frame validation at the client boundary                       |

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

The owner now permits moderate laptop use. The current memory headroom is too
small for a local connected browser/build pool, and the assessed private server
does not have a ready browser runtime. Do not turn these constraints into repeated
local launches or dependency installations. Prepare the reviewed code-only branch
for hosted exact-lockfile CI, keeping private technical receipts local.

Four shared files require explicit source review after merging the released base:
CharacterWorkspace (portrait/access epochs and pending guards plus icon changes),
ChatPanels (scope-aware drafts, action-specific errors and composer icons),
QuickRollPanel (pending ARIA plus icons), and concept.spec (retain both the upload
and action-context regressions). The released native textarea adapter is unchanged.

The connected browser gate must include all 16 new mock cases from Files intake,
Russian world copy, sticker lifecycle and workspace-select Escape, plus the
released action-context/draft/readonly regressions. The two player-request control
cases require a disposable real backend; they are not covered by mock-only runs.
The observed quick-command trigger Escape gap belongs to UIX-644's existing
lifecycle inventory and needs caller-level and browser regression evidence.

Publishing a reviewed branch for CI is distinct from production release. Do not
merge or deploy this candidate on the strength of the released base's green checks;
require exact-candidate and exact-main gates, backup/restore and scoped postflight.
