# UIX-644 offline RO comparison checkpoint — 2026-10-09

## Gate result

**Blocked before browser.** Neither historical app reached a listening state, so no Playwright cell ran, no RO observation exists, and this is neither a reproduction nor a non-reproduction. Preserve the earlier failure unchanged; do not infer causality.

## Evidence / revisions

- Checkout: `HEAD 30bbb5b`; product source used for the prior runtime gate remains `52013d4`.
- Historical arms: old `452f5f162da51f10fbafcedef92f5d85fc9d36cf`; new `e03b60e2be3c95f5f18033b2760284587160e566`.
- Isolation root (ignored): `.data/qa-prep/uix644-ro-isolated-20261009/7f5a4e90-4ac4-49ba-8f78-3b3d6c1d5d42/`.
- Both exact locked installs and contracts/system builds completed in the preceding preparation gate. Playwright `--list` identified exactly one case per arm; this was list-only.
- Preflight proved equality of the normalized generated case (`285d45be2cdf1905aa3a2e68c06e64a0df35e9ba0272e51b638296043592b72d`), all three helper source hashes (see receipt), and synthetic inline SVG asset bytes (`de46f29ed609ef492a6e067f4520294e7219a7fae380f6fab1fb36606159459e`). The case mocks `characters=[]`, `tokens=[]`, one synthetic TOKEN asset; viewport is 1280×900, DPR 1. No external asset references.

## Launch attempt and blocker

Both owned Vite launches used the isolated exports only, `127.0.0.1`, strict ports 14231/14232, empty proxy map, and no current API/DB connection. Launcher was `node.exe apps/web/node_modules/vite/bin/vite.js --config apps/web/vite.ro-isolated.config.mts --host 127.0.0.1 --port <port> --strictPort`; Playwright config is `playwright.ro-isolated.config.mjs`. Harness is `tests/e2e/uix644-ro-isolated-harness.spec.ts` in each export.

Both processes exited before binding/listening with `ERR_PACKAGE_IMPORT_NOT_DEFINED` for Vite 8.2.1 import-map specifier `#module-sync-enabled`; the failing package location is `node_modules/.pnpm/vite@8.2.1_.../node_modules/vite/dist/node/chunks/node.js`, resolving against that package's `package.json` imports map. Runtime was Node v24.15.0. The same error class occurred in both arms. This does **not** establish a Node incompatibility or package-root cause; launcher/module-resolution diagnosis is still open. No retry, package reinstall, version/condition substitution, or browser run was performed.

Owned PIDs 18456 and 26072 exited; final owned-listener count was zero. Ports 14231 and 14232 are free. Error logs remain inside the ignored export directories. No current server was restarted or contacted.

## Changed files and artifacts

- New checkpoint: `docs/plans/uix644-ro-comparison20261009.md`.
- Ignored-only harness/config/receipt changes under the isolation root listed above. No product source, current runtime, fixture, Linear, or other agent files were changed.
- Sanitized receipt: `.data/qa-prep/uix644-ro-isolated-20261009/7f5a4e90-4ac4-49ba-8f78-3b3d6c1d5d42/comparison-receipt.json` SHA-256 `4DE9077A95DFDABB8A033F56EFD52036E01164152A613749278FD6AEA109688E`. Private stdout/stderr are retained only as ignored local logs; their hashes are in the receipt.

## Evidence limits and next action

The old/new source trees differ across 81 files; the package contract build outputs also differ (new adds `CHARACTER_RESOURCE`), while the system outputs match. Thus even a future paired result must state those confounds; it cannot make a one-line causal claim. Current result is only a pre-browser launcher blocker.

**Next:** root to inspect the same Vite package `imports` map and captured launch error, then authorize a single corrected launcher attempt only if that diagnosis yields a supported path. Keep exact commits, exports, fixture, and failure logs; do not change Node/package versions or retry blindly. After successful startup, exercise only the already-defined one cell per arm and stop only owned processes.

## Follow-up: offline launcher diagnosis

Root identified a harness/config issue after the original failure: the guard's `new URL` base had a trailing colon without the arm port. Both isolated Vite configs now use their exact loopback origin (`http://127.0.0.1:14231` / `:14232`). Offline assertions verified both URL construction sites per config preserve the expected arm origin. This fix is isolated to the ignored QA config; it does not establish the cause of the earlier import error.

A no-server Node probe used each export's `createRequire.resolve('vite')`, then `import(pathToFileURL(resolved).href)`. Both historical exports still fail with `ERR_PACKAGE_IMPORT_NOT_DEFINED`; resolved paths are 278 characters. The same method in the current checkout succeeds with a 187-character resolved path. Root confirmed the Vite 8.2.1 package import maps are identical and the dist subtree has no nested `package.json`. A long-export-path/package-scope resolution issue is now a **hypothesis only**; this evidence is not sufficient to name a root cause. No server or browser was launched, and no Node version, package bytes, lockfile, or export was changed. The original launch failure receipt and logs remain intact.

Follow-up receipt: `.data/qa-prep/uix644-ro-isolated-20261009/7f5a4e90-4ac4-49ba-8f78-3b3d6c1d5d42/launcher-diagnosis.json`. Before any shortened-root copy, reinstallation, or launch, root should define and verify a fresh exclusive contained target path and authorize that step. Current next action is root diagnosis/approval; no retry is in scope.

## Follow-up: short-root preparation (offline only)

Root provided the exact destination `.data/ro9-a241` and verified it absent/contained before creation. I repeated the containment/nonexistence check, extracted the previously hash-verified immutable historical archives into fresh exclusive `o/` and `n/` subdirectories (original exports/archives remain intact), and copied only the already-reviewed external Playwright harness/config plus the fixed per-arm-origin Vite guard config. No server or browser was started.

Both exports installed from the locked local store using pnpm 10.12.1 with `--offline --frozen-lockfile --ignore-scripts`; each resolved/reused 667 packages, downloaded zero, ran no lifecycle scripts, and retained the shared lock SHA `402501F0C54ADA218EA268CD804BA65439800A3E330F9F3A8C0510DC72D4B329`. The contracts and system packages built successfully in both arms. Contracts/system hashes match the first preparation receipt. Harness and all three helper hashes remain identical after path relocation; the synthetic fixture still has empty characters/tokens and the same inline asset bytes. The corrected loopback origins pass offline assertions.

With Node v24.15.0, an offline `createRequire.resolve('vite')` followed by `import(pathToFileURL(resolved).href)` now succeeds in both historical exports at resolved path length 204 (Vite 8.2.1; `defineConfig` exported). The same probe had failed at path length 278 in the prior longer export root; current checkout import succeeds at length 187. This supports—but does not prove—the path-dependent module-resolution hypothesis. It is **not** a server launch, browser result, or RO evidence. No Node/package/lockfile changes and no current runtime contact occurred.

Short-root receipt: `.data/ro9-a241/short-root-preparation-receipt.json` SHA-256 `60AC4B5E94D129DC2784D5076222400A7884002FFCA3B9DBF1B1947D41C722CA`. Build/install logs and outputs remain in the exclusive ignored `o/` and `n/` subdirectories. The original failure receipt and long-root evidence are unchanged.

**Stop at this gate.** Parent required no Vite startup/browser until a separate root gate because the P1 browser owner is active. Next action: root may decide whether the successful path probe justifies authorizing one isolated server startup; no launch is performed here.

## Follow-up: isolated server guard validation (no browser)

After root authorization, revalidated ports 14231/14232 free and the short-root configs' exact origins plus `proxy: {}`. Started only the two hidden short-export Vite processes (PIDs 24428/26188). During one no-auth synthetic GET sequence per arm, app root returned 200 and `/api/__guard_probe`, `/healthz`, and `/socket.io/__guard_probe` each returned 503. The app-owned guard counters were exactly `{api:1, health:1, websocket:1}` per arm; the config-owned status/reset route returned zeroes, and follow-up status remained zero. No browser ran and no current API/server was contacted.

At the subsequent process check both launched PIDs were gone and ports had no owned listeners; stderr was empty. The processes served the requested guard sequence but did not persist past the tool boundary. I did not restart them or attempt an alternate launcher. Root has the live P1 runtime inventory; an earlier sandbox listener snapshot is not evidence of an outage and no current runtime was changed.

Receipts/metadata are under `.data/ro9-a241/`: `server-start-guard-receipt.json` SHA-256 `1DA1DDE972A7029F376E0D1F08036DE613F38F97867D677F35F773790DFC0638`, `frontend-process-metadata.json` SHA `11507F9D8F9844D96BB9A656EACB6CD560110403F392CBC1FAF837AB239AE273`, and raw-count-only `guard-validation-receipt.json` SHA `6C5D5030FE775EF6F9176849F3AD33CF8227AACF07D29DF94FFFD1562B29293E`. The guard success does not establish RO behavior. Next step requires root to decide whether to keep servers in a persistent exec session; no browser cell is run until root gates it after P1 release.

### Process-status correction

A sandbox-level process/listener check incorrectly reported the isolated servers gone. Do not treat that check as authoritative: the same two processes remain alive and their expected listeners are present, confirmed by elevated local inspection (PIDs 24428 on 14231 and 26188 on 14232). No restart occurred. The earlier sandbox observation and receipt remain preserved with this correction. Keep these exact processes; do not restart, alter the current runtime, or run a browser until root authorizes after P1 release.

Correction receipt: `.data/ro9-a241/authoritative-process-correction.json` SHA-256 `11497E5724D8231B73A129BF949A70818E1B91D108A19661D734ABFDF0C8A8D5`.

## One-cell Chromium attempt and origin-guard correction

After root's P1 release, one no-retry Chromium cell was run in each arm against the already verified owned servers. Both failed before app load: the Playwright config had `baseURL` `http://127.0.0.1:` without the arm port. The fail-closed hook correctly recorded one origin mismatch/block per cell. Sanitized totals per arm: page/window/console/RO errors 0; request failures 1; blocked external 1; API requests 0; no first-popup geometry; app-server guard counters remained 0. These are **harness failures**, not RO reproduction/non-reproduction and not product evidence. Original reports remain preserved with hashes in `.data/ro9-a241/browser-cell-receipt.json`; no retry or extra cell was run.

Offline-only correction: `playwright.ro-isolated.config.mjs` now has the exact arm port. Independent Node guard test `.data/ro9-a241/verify-origin-config.mjs` imports each exported Playwright config in its own Node process and checks baseURL origin/port, testDir/testMatch (one case), retries0, Chromium, viewport/DPR, no webServer, exact Vite host/strict port/empty proxy, both `new URL` origins, route allow-origin, and status endpoint origin. Both arms pass. Captured output `.data/ro9-a241/verify-origin-output.txt` SHA-256 `36699df7d543e85649fb543a59e6c02ae13f8dc24bd7bfcb24e79f45111c7dce`; guard receipt `.data/ro9-a241/origin-guard-receipt.json` SHA-256 `ee35c17ab84c5c2bca601b48279a22f50aebad6235e475dff576b0bd68010917`.

No browser rerun is authorized in this checkpoint. Both owned Vite PIDs were identity-verified and stopped after the cells; elevated cleanup confirmed both ports free. Root decides if a separate later gate should rerun with the corrected baseURL. Preserve the original failed cells and do not ascribe their result to either historical source.

## Corrected one-cell paired run — 2026-10-09

Root approved a single corrected Chromium cell per arm after the port-correct origin guard passed. On checkout `HEAD 691d352`, exact historical arms `452f5f162da51f10fbafcedef92f5d85fc9d36cf` and `e03b60e2be3c95f5f18033b2760284587160e566` used the same normalized one-case harness, synthetic empty characters/tokens and inline asset, fixed viewport 1280×900/DPR 1, retries 0, no zoom change, strict loopback-only Vite with empty proxy, no HMR, fail-closed external/API/WebSocket guards. Both cells passed once; there were no retries or additional warm/cold runs.

**Verdict: NONREPRO for this selected first-open case. Original RO failure remains open.** This is not a release pass or evidence that the historical defect is resolved. The trees still differ across 81 files and contract build outputs differ; no one-line causal claim is justified.

- Both tests: status `passed`, 0 test errors, page/window/unhandled errors 0, `ResizeObserver` error/failure count 0. At the 500 ms first-open measurement, visual viewport scale was 1 and all popup bounds fit the 1280×900 viewport.
- Old popup: 98.77×92 px, scrollWidth 99/clientWidth 99; new popup: 145.91×92 px, scrollWidth 146/clientWidth 146. The width changed but both cases passed the existing layout assertions.
- Observer trace: old 19 callbacks/22 entries/0 failures; new 12 callbacks/15 entries/0 failures. It recorded four select-control entries per arm and no entry whose class identified the popup itself, limiting direct attribution.
- Network/error audit: per arm 7 console errors and 3 request failures were captured, all before first popup visibility; zero of those events occurred at/after popup visibility. One external request was blocked and three WebSocket attempts were closed. There were 11 mocked/intercepted API requests (9 GET, 2 POST); the only blocked writes were two `/api/chat/read` markers. Client-log payload count 0 and Vite API/health/socket guard counters stayed 0, so no backend request reached a live API/DB. Raw error strings, fixture payloads, and screenshot content are not included in this checkpoint.

Immutable sanitized result: `.data/ro9-a241/corrected-comparison-receipt.json` SHA-256 `F8F7D758599F18B7F0934FC7358727C87FB9AD024B340E35AF1B82CAA3A72949`. Exact process metadata: `.data/ro9-a241/corrected-gate-process-metadata.json` SHA-256 `547336E193E4FCABF2ED5FF529713AD504F3A7084AA0038293299BDE628A46E3`. Elevated cleanup receipt: `.data/ro9-a241/corrected-gate-cleanup-receipt.json` SHA-256 `4ECEAF67DBFBC2AA02871B8A8A194ED181AAFBBA68729B991313361688F9D9D4`; only identity-matched owned PIDs 3780/32176 were stopped, with both ports verified free. Earlier bad-baseURL failures remain preserved and are not counted as source failures.

**Stop here:** one paired case complete. Preserve the historical RO failure and request a separately gated follow-up only if more evidence is needed; no sweep, product edit, Linear update, or commit was made.
