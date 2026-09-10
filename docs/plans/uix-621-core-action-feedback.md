# Core game action context and feedback — UIX-621 / UIX-421

## Current stage

Source implementation, starting from `main@58991cc` on
`codex/uix-621-core-action-feedback`. The first hosted PR gate found
regressions; the correction pool below still requires hosted verification.
This is a connected UX correction, not completion of either broad issue or the
owner's requested visual redesign.

The owner's 2026-09-10 priority is the basic playable UX and a crafted UI based
on the supplied dark-fantasy reference. Read-only inspection is complete and
the proposed main-screen direction awaits alignment. This correction pool
does not implement that visual redesign or replace it with infrastructure work.

## Source-confirmed problems

1. PLAYER quick rolls and resources select the first eligible character in
   snapshot order, even when `snapshot.me.characterId` names a different owned
   character. The nearby composer uses that named character instead. PLAYER
   has no selector to discover or correct this discrepancy.
2. A pending quick roll disables actions without local execution feedback.
3. Composer validation, quick-roll failures and resource failures share one
   error channel. The composer validation alert is not associated with the
   field; a resource failure appears beside an unrelated input.
4. The character sheet's access-save and portrait-upload actions do not explain
   their disabled prerequisites. An empty player-access list has no empty
   state.

These findings establish source-level behavior, not a live-campaign observation
or a failed browser regression. Multiple owned rows are structurally permitted:
the owner foreign key is not unique, and the snapshot builder keeps the last
owned character in `me.characterId` while retaining both visible rows. The
ordinary UI path that produces these rows has not been established. There is
no separate session-level active-character selector to implement here.

The existing textarea adapter also needs its supported Gravity control mapping:
top-level `aria-describedby` and `aria-invalid` do not automatically reach the
real textarea. The focused regression must inspect the actual control, not a
mock that merely echoes props.

## Connected behavior contract

- PLAYER quick actions and resources use `snapshot.me.characterId`, not another
  owned character encountered earlier in the snapshot. If that context is null,
  no implicit first-owned/controller fallback is added to these controls. The
  server's existing dice fallback is separate and remains unchanged.
- GM retains the explicitly selected quick-action character. The visible
  action context identifies the selected character.
- An accepted action keeps its original character and revision. Switching
  from A to B must neither cancel A's accepted resource intent nor send a new B
  action to A. Existing resource batching and rollback remain unchanged.
- Pending feedback and late failures retain the initiating action/character;
  they must not be presented as the newly displayed character's action.
- Quick-roll execution has accessible local feedback while duplicate requests
  remain guarded.
- Composer validation is associated with its field and invalid state.
  Resource and quick-roll failures have their own visible, contextual alerts.
- Access and portrait actions explain missing prerequisites and in-flight
  state visibly and through accessible descriptions. The empty player list
  explains its state without a fabricated action or destination.

## Ownership and boundaries

- Activity action context: `activity-roll-controls.ts`, `ChatPanels.tsx`,
  `QuickRollPanel.tsx`, the `FormTextArea` adapter and focused
  helper/owning-component/real-control tests.
- Character action feedback: `CharacterWorkspace.tsx` and focused
  owning-component tests.
- Integrator: this plan and the project design context. No concurrent edits to
  `App.tsx`, global styles or overlay primitives.

No API, authorization, gameplay-rule, queue, storage or renderer changes.
No new cards, reference content import, Figma writes or production mutation.
The previously released follow-scroll fix is preserved rather than revisited.

## Verification gate — pending, not results

Review the complete source bundle once, then use one off-laptop verification
pool. Do not run local builds, Docker, test runners or formatters.

The caller tests must exercise the real ActivityPanel and owning character
controls with synthetic data, not only helpers or preselected props:

- owned A before the character B named by `me.characterId`, and updates of that
  named snapshot context;
- GM explicit selection and PLAYER with a null named character;
- actual roll/resource mutation target and revision;
- accepted A intent followed by a switch to B and a late A failure;
- pending and duplicate-action feedback;
- composer validation association and separate action errors;
- unchanged access, empty member list, file prerequisite and in-flight action.

Browser follow-up must cover the connected interaction, keyboard behavior,
focus and readability at desktop/compact widths using disposable data. Keep
real-browser, automated, source-review and production evidence distinct.
Required targeted diversions and the shared repository gate still apply;
prepared tests are not evidence that the new behavior works.

## Remaining broader work

UIX-621 still owns the rest of the original core-game acceptance criteria and
their live browser proof. UIX-421 still owns all relevant forms, list empty
states and disabled-action explanations. UIX-317 owns the coherent visual
foundation and theme migration. None is closed by this slice, and the visual
reference/approved-main-screen work remains the next design dependency.

## Source checkpoint — 2026-09-10

The connected implementation is prepared. Independent runtime-source review
identified one missing synchronous guard for access saving; it now guards
before calling the mutation and releases on success, rejection or synchronous
throw. The regression uses two native clicks inside one React `act` boundary,
rather than two already-flushed events. Other reviewed runtime paths had no
actionable source findings. This is not a compiler or runtime PASS.

Prepared tests: 10 ActivityPanel caller cases, 9 character-action cases,
4 helper cases and 1 real textarea-adapter case. One connected Playwright case
was added to the existing `concept.spec.ts` harness. It checks exact dice and
counter URL/method/body, character ID/revision, pending feedback, separate
failures and canonical reload after conflict. Its backend is mocked: it does
not establish SQL, authorization, live-campaign behavior or a UI path to create
the several-owned-rows fixture. Its held response is released in `finally`.

At that source checkpoint all new test cases, formatting, type checking,
builds and browser execution were **UNRUN**. No dependencies, CI framework,
server process or local test runner were added or started. The previous
read-API PR is not a dependency of this UX implementation.

## First hosted gate and connected correction

The owner authorized the public branch and [PR #75](https://github.com/uixray/arken-space/pull/75),
not merge or production deployment. On `7095bd3`, build, typecheck and lint
passed. Formatting failed in three test files, so the full Vitest step was
skipped. Multiplayer passed, including its isolated cleanup checks.

Both browsers rejected invalid `aria-expanded` on the real textarea and the
26px loss of journal space in the calibrated follow-scroll scenario. Chromium
also reported one flaky second-send assertion; a recovered retry is not a pass
under the existing fail-on-flaky gate. Both browser teardowns completed.

Corrections are kept together:

- Remove unsupported expansion state from the two textarea callers, not from
  the generic adapter. The actual disclosure buttons retain their expansion
  state, and the textareas retain descriptions, validation and controls links.
- Show PLAYER context in the existing heading; GM already has a visible named
  selector. Remove the redundant extra paragraph instead of changing the
  calibrated journal-height or follow-scroll oracle.
- Guard composer clearing by its edit revision. Completion of an earlier send
  must not erase a newer draft, even after clearing and retyping identical text.
  The original keyboard/visibility requests and E2E assertion are unchanged.
- Correct source formatting and exercise the real caller with a held first
  response, a new draft and a second Control+Enter submission.

The asynchronous draft-erasure path is source-confirmed; the exact interleaving
of the flaky browser attempt was not traced. These changes do not claim that
all flakes, accessibility states or broader UI acceptance are resolved.

Next: verify this whole correction pool off the laptop, then continue the
approved main-screen design direction. Required targeted source diversions
remain a separate gate; the shared PR workflows do not execute them. Retain
the entire original acceptance scope rather than treating a PR as Done.
