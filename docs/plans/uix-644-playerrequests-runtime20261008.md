# UIX-644 — PlayerRequests local runtime delta, 2026-10-08

Overall issue: **INCOMPLETE**. This delta does not replace the full 48-bucket/90-occurrence registry or transfer historical PASS to current HEAD.

## Revision and scope
- Product revision: `3ed0f51966e0c547b33311387c10e52f4e42391f`; later `f3944d3` is documentation-only.
- Existing isolated local QA API/Vite; Chromium and Firefox; desktop1280×900, compact390×844.
- Prepared ignored spec/config/receipts under `.data/qa-prep/uix644-playerrequests-formselect-*`.
- No submissions or domain mutations. Auth is real local synthetic; chat-read POST is intercepted with a synthetic marker and does not establish real chat-read behavior.

## Terminal evidence and limitations
- Initial session97923: EXIT1,8/8 failures after pointer-open then ArrowDown/Enter from trigger. This keyboard route remains unproved; it is not erased by the Home-route result.
- Corrected Home/focus/ArrowDown/Enter session97842: EXIT1,4GM cells passed;4PLAYER cells failed. Desktop character select lacked an alternative; compact hit-test measured a control before scrolling.
- Misfiltered `--grep PLAYER` attempt matched the common PlayerRequests title and was interrupted. It is not a completed gate. Corrected grep `PLAYER (desktop|compact)` was verified with --list to select exactly4PLAYER tests.
- Session40597 at HEAD `f3944d352011fe21d91ef46a287ff050488cbd83` (app source unchanged): EXIT0,4/4PLAYER tests,58.9s, after QA-only scrollIntoViewIfNeeded and explicit fixture-gap reporting. Product source and campaign fixtures unchanged.
- PLAYER each cell exercised all6controls;5could change value. Character (optional) had only None with bootstrap ownedCharacterCount0: Escape/outside/focus-return/reopen verified, **value-change pending**. This is a partial evidence gate, not full control acceptance.
- GM3shared filters: Home-route selection/Escape/outside/focus/reopen in4engine/viewport cells passed at97842.
- No page errors or blocked domain writes recorded; no native OS popup acceptance claim.

## Compact diagnosis
After normal scroll, Audience trigger x21,y651.390625 (Chrome) /651.4000244 (Firefox),width348,height38, center195,670.39/670.4. Actual hit is child SPAN.arken-select__value inside combobox. Popup x26,y698,width348,height≈86.78,bottom≈784.8 within390×844. Saved initial failure occurred before scrolling; no permanent product overlay demonstrated.

## Still required
- A fixture with an owned character for character value-change, separately authorized; do not modify existing party merely to turn a test green.
- Initial ArrowDown-from-trigger semantics characterization.
- Remaining full registry, real scene selection, true browser zoom, causal ResizeObserver replay and owner-deferred native Firefox popup/manual acceptance.
- No full E2E or production gate claimed; remote remains stopped.


## Saved initial ArrowDown trace diagnosis
Luna inspected initial GM desktop Chromium trace: ArrowDown call897 aftersnapshot8870.809 highlights selectedCurrentOpen option (aria-selectedtrue,tabindex0,data-highlighted); Enter call899 snapshot8949.862 closespopup and preservesCurrentOpen. Thus initial no-value-change assertion was invalid as a productfailure criterion for this case: the first ArrowDown focused the currentoption. Initial failedexecution receipts remain preserved. This one intermediate DOM trace does not prove everycontrol/browser; actual available alternativevaluechanges remain covered by correctedHome-route matrix. Select wrapper delegates arrows toBaseUI and handlesHome explicitly. No productsourceedit.
