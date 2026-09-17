# UIX-318 — private viewer lifetime

## Scope

Original existing task requires explicit, authorized opening of sensitive report
data and attachments. Local source inspection found asynchronous responses could
outlive that opening: reveal/export/attachment completion or an old list failure
could act after close, unmount or reopen. No production access was used.

## Change

`OperatorFeedbackWorkspace` now gives each viewing scope a generation. Closing,
clearing the selected report or unmounting invalidates pending completions. List,
detail, reveal, transition refresh, export and attachment results check the scope
before updating UI or starting clipboard work. Old completions also cannot clear
a newer pending state. Attachment object URLs are revoked directly from a ref,
including unmount; cleanup no longer relies on a state updater running on unmount.

This does not cancel a server mutation already submitted, nor undo a clipboard
write already started while the view was valid. It prevents a late export response
from **starting** that write after the view has closed. Server ACL and redaction
contracts are unchanged.

## Evidence — 2026-09-17

- New five-case component regression suite on original `23ebef4` source: **5/5
  fail**, confirming stale revealed contact, late clipboard write, late image URL
  allocation, missing unmount revocation and old list failure closing a new view.
  Fixed source was restored in `finally`; no other source was reverted.
- Fixed component suite plus existing operator client boundary: **8/8 PASS**,
  12.12s, one worker. Domain API calls and dialog shell are mocked; this is lifetime
  evidence, not server authorization or focus/geometry proof.
- Actual App/ArkenDialog close and reopen in Chrome/Firefox: **2/2 PASS**, 11.4s,
  one worker, no retries. Export response held until after close; no clipboard
  invocation or stale details/notice on reopen. Synthetic API/socket and clipboard
  invocation observer, not OS clipboard or production data.
- Web/E2E typecheck, scoped ESLint/Prettier and diff check PASS. Owned Vite stopped.
- Local evidence folder: `operator-privacy-scope` under the current session
  artifacts; baseline log and fixed browser report retained. All test data synthetic.

## Remaining boundaries

This closes a viewer-lifetime defect, not the whole UIX-318. Independent host trust
verification, production acceptance and all other original criteria require their
own evidence. No infrastructure identifiers, actual reports or private attachment
paths are included here. No full project rerun, external write, publication or
deployment was performed. The protected untracked selection test is unchanged.

## Follow-up — link draft belongs to one report

The existing viewer retained `linearKey`/`linearUrl` when selecting another report.
With two acknowledged reports, a valid draft for the first immediately enabled
the second report's Link action. A focused regression on `bb4f203` reproduced the
wrong carried value (`UIX-318` instead of empty); no server write was performed.

Clearing the viewing scope now also clears both draft fields. The new test verifies
that switching requires fresh input, linking remains disabled meanwhile, and the
eventual mutation contains only the second report ID and its newly entered link.
Existing server link validation and user-authored values are not rewritten.

Connected component/client pool: **9/9 PASS**, 14.20s, one worker; evidence in local
`operator-link-draft/baseline.log` and `fixed.log`. This is component/mock evidence,
not an actual Linear write or backend integration. No repeated browser/full suite.

Next original-criteria gap found by source inspection: backend list supports bounded
`from/to/kind/status/build/cursor/limit` and returns `nextCursor`, but the current
viewer only calls the unfiltered first page and discards `nextCursor`. A later UI
pool should expose those existing controls without adding new endpoints or changing
authorization, privacy or task scope.

## List filters and pagination — 2026-09-17

The gap above is now implemented in the local viewer, reusing the existing GET
contract. Filters cover local date/time interval (sent as UTC), kind, status and
build version/revision. Inverted ranges are rejected before a request; build input
is bounded to 64 characters. Reset returns to the unfiltered first page. Backend
default page limit remains 25; no new endpoint or authorization change.

Next-page cursor is retained and URL-encoded, rows append with ID de-duplication.
Page failure preserves loaded rows and offers retry with the same cursor. Initial
network failure also offers retry rather than pretending that access was revoked.
Only actual 401/403 clears private detail/list and closes the viewer. New filters
clear selected detail/link drafts and start from the first page. Close clears list
filter state and still invalidates pending responses. A status mutation refreshes
the active filter's first page. Build appears in each row; dates use Russian locale.
Narrow screens stack list/details instead of forcing the desktop two-column grid.

Evidence:

- Component/client pool **14/14 PASS**, 16.08s: cursor encoding, duplicate guard,
  filter/draft clearing, exact page retry, revoked authorization, invalid/valid
  date range and reset, plus earlier privacy and linking safeguards.
- Chrome/Firefox × desktop1280/narrow390 list flows plus previous close/export
  scenario: **6/6 PASS**, 24.7s, one worker, no retries. Actual native controls and
  App/ArkenDialog, mocked API/socket, exact query receipts, no mutations, horizontal
  field bounds checked. Not physical mobile or server ACL proof.
- Two earlier rounds stopped on test assumptions, not weakened product gates:
  first assumed only one initial GET (StrictMode issues another); second used an
  exact label-text query for a nested select instead of its actual accessible
  combobox name. Final assertions check the most recent completed query and exact
  accessible names. Logs/traces retained, failures not relabeled green.
- Web/E2E types, scoped lint/format/diff PASS; initial desktop failure screenshot
  inspected for layout. No claim of full visual/device acceptance.
- Local artifact folder `operator-list-gate`; own Vite stopped after every round.
  No full suite/build/CI/publication or production request. Original host-trust and
  other unverified UIX-318 criteria remain separate.
