# UIX-652 procedural guide subset — 2026-10-09

Revision: product base a598f47 (owner slice successor to b6e1e39); concurrent fog/spell work excluded.
Decisions: one typed data source for four workflows and four FAQ, existing map ping/chat/player-request/GM-triage controls only. Source/update references recorded in data. No duplicate gallery/search/shortcuts or unfinished onboarding/mail/school/trim promises.
Changed files: landing-guide-workflows.ts and test; LandingGuide.tsx/test; landing-guide.css; this checkpoint.
Verification: worker guide suite21/21 and Vite build PASS on C product tree. Root reviewed content and integration diff. Worker tsc invocation failed with broader diagnostics, no PASS inferred; another concurrent source gate later reported web/server PASS, exact final connected gate pending. Browser NOT_RUN (local timeout/network access denied), 390/1280/login reachability not verified. Human readability and actual user scenarios remain open; not whole UIX652 acceptance.
Workspace correction: worker initially edited D release source contrary to assignment; moved only owned changes to C then restored D tracked guide bytes. Root observed no content diff in D guide/CSS; unrelated .tmp/map-ping-motion preserved. Earlier D gate evidence not used for C acceptance.
Next: finite actual guide browser gate with existing installed Chrome and owned loopback C Vite once available; human acceptance separate. No frozen package changes, merge, push or deployment.

## Final addressed browser follow-up — fe507a1
Actual installedChrome channel viaPlaywright syntheticAPI-stubbed guidecasePASS at390x844/1280x800:4workflows4FAQ/rolelabels/sign-inreachability,1→2columnlayout/nohorizontaloverflow, keyboardEnterguideanchorhash,shortcutsearch retainsarticles,gallerycollapsed,zeroAPImutations. OwnedloopbackVite5189stopped. Addedonlytests/e2e/uix652-guide-procedures.spec.ts; formatting/diffcheckPASS. Initialambiguousheadinglocator corrected thenfinalrunpassed. No duplicatebuild/unitgate; unchangedguidesource priorreceiptretained, notnewfullproducttest. Humanreadability/realparticipant/comprehensivecoverage remainsopen.
