# Local 2 GiB capacity gate — 2026-10-09

## Decision boundary

Plan only, no execution. Before purchasing a small host, measure the exact accepted4dca5a1 image stack under a declared7-client workload. A local constrained Docker run is not the same CPU/disk/network/kernel as a proposed VPS and cannot guarantee2GB suitability. No production data/users, owner stands, downloads, rebuilds, new dependencies or unbounded sidecars. Root authorizes this finite isolated run separately.

## Resources and bounded ownership

Luna owns disposable compose limits, synthetic load harness and safe receipts only. Use accepted immutable server/web/PostgreSQL IDs from package manifests; gateway should reuse the exact bundled web/nginx image after packaging repair. Separate private Docker network/volumes and loopback endpoint. No public port or SMTP egress; mail off. Do not borrow production recovery data. Target configuration/parser gates must first resolve sensitive gateway routing404. Preserve active workers and source.

Installed socket.io-client4.8.3 is available via web dependency. Reuse protocol/ack/event logic and synthetic entity patterns from `tests/realtime.test.ts` and `tests/multiplayer/game-session.spec.ts`, not their in-process mocked server/PGlite as capacity target. Clients must connect to the real image process through gateway and Socket.IO, authenticate valid synthetic GM/PLAYER identities and observe broadcasts. Do not run `scripts/run-multiplayer-e2e.mjs` blindly: it has a production-health default and broader compose lifecycle. Create only a bounded harness using installed client dependency; missing resolver/client means blocker, not npm install.

Load generator runs on host outside measured server budget, as real user devices would. Record its CPU/RSS and missed schedule deadlines to detect generator bottleneck; no browser fleet or fixture server hidden inside1.5GiB. Setup fixtures before timed measurement, using actual routes where supported or explicitly fixture-provisioned verified accounts/memberships; no direct token-only mock auth. No application seeding/old alias login. Synthetic media generated with installed tools only, map2048x2048 with nontrivial content, several token images and an audio asset with declared bytes/duration. No private author media. Record dataset counts and sizes; a tiny blank image is not realistic map evidence.

## Hard resource budget

Reserve at least512MiB of nominal2GiB for OS/Docker/host services. Aggregate workload hard limits <=1536MiB:
- PostgreSQL512MiB.
- Server768MiB.
- Web64MiB and gateway64MiB combined128MiB (if single edge service used, max128MiB total).
- Unallocated128MiB stays contingency, not permission for unbounded sidecars.

Set each container memory limit and memory-swap equal to its memory limit (no swap allowance), verify actual cgroup memory.max/memory.swap.max or equivalent v1 values. No unlimited `deploy` limits silently ignored by Compose. Record inspect resource fields only, never Env. Verify no OOMKilled/restart already present at baseline. Server V8 heap/PG settings stay accepted defaults for first run; if tuning needed, it is a separate declared configuration and second finite run, not concealed mid-test. Record CPU quota/count and host/engine architecture; absent target CPU specification is a limitation, not an assumption of equivalence.

Host Docker VM must have enough idle resources so unrelated owner work does not cause synthetic contention. Do not alter host swap/VM/system settings; if inability to observe/enforce container swap limits or host contention undermines test, mark invalid/inconclusive.512MiB OS reservation is a budget assumption, not measured Linux host overhead on Windows Desktop. Final purchasing decision needs target-host capacity confirmation.

## Scenario and time budget

Maximum20min total after resources preflight: startup <=3min,2min warmup, **6min measured steady load** including bursts,1min cool-down, cleanup/receipt <=5min. Stop early on safety failure, do not rerun indefinitely.

Seven concurrent authenticated real socket clients:1GM+6PLAYER, one campaign/active scene, at least24 tokens with6 controlled player tokens and GM-owned NPCs. Verify seven connections and role/campaign snapshot before timing; otherwise INVALID, not a low-load PASS.

During warmup fetch map/token media and snapshot; establish normal audio range serving if supported. During6min:
- Each player sends one valid token movement per second; GM one move/second; unique command IDs, actual ACK and broadcast convergence checked. Do not blindly queue overlapping commands to a token with version constraints; use correct protocol revisions.
- Every30s, a5s burst: all7 send up to4 valid movement commands/second each, bounded inflight/backpressure; record scheduled versus issued counts. Never count locally dropped commands as successful throughput.
- GM triggers one supported map/scene refresh event per minute; all clients fetch updated snapshot/map through protected route. Use two declared maps if scene switching supported; no invented event names. Each client performs one representative media fetch/range cycle per minute, with bytes/status/content-type validation, not HEAD-only.
- One client controlled reconnect at minute3, rejoins and catches up; distinguish that intended disconnect from all spontaneous disconnects. No massive synthetic reconnect storm.

Use actual contract names from frozen fixture/source once when implementing; freeze workload schedule before starting. Emit safe counts/timing only, no session tokens/cookies/bearers. No DB mutation from harness during measured phase except application commands. If app limits intentionally reject a schedule, report it and lower declared workload only for a separately labeled rerun.

## Measurements / pass-fail criteria

Sample every1s with timestamp: per-container cgroup current/peak memory, OOM/oom_kill events, RSS separately where available, CPU/throttling, restart count, DB connection/activity counts only, request/socket metrics. Docker stats working-set view alone is not memory peak proof: retain cgroup high-water value to catch subsecond peaks. Aggregate simultaneous usage over time, plus sum of individual peaks conservatively. Record cgroup cache memory separately if available; do not subtract caches to manufacture budget fit.

Proposed local gate thresholds (fixed before run, not prior measured SLO):
- **FAIL:** any OOM, restart, unexpected container exit, swap use, missed authenticated client, unplanned socket disconnect, lost/incorrect final token state or broadcast divergence after2s, unhandled server error, HTTP5xx, ACK timeout >2s. Report intended policy4xx separately; unexplained rejection fails functional workload.
- **Latency PASS:** steady ACK p95<=250ms/p99<=750ms; burst p95<=500ms/p99<=1500ms; broadcast convergence p95<=500ms/p99<=1500ms. Report samples/counts and monotonic timings from harness; no cross-clock subtraction. HTTP snapshot/API p95<=500ms/p99<=1500ms. Media completion thresholds depend declared file size: use <=2s for each <=5MiB loopback transfer, larger assets report throughput explicitly, not blanket PASS.
- **Capacity PASS:** every cgroup peak <=90% of assigned hard limit, maximum observed simultaneous sum <=90% of1408MiB assigned workload limit, zero swap/OOM; no sustained memory growth >5% of assigned limit between comparable last2min windows after media warmup. Six-minute stability is not a leak soak.
- **INVALID/inconclusive:** load generator misses >1% scheduled workload due generator CPU/backpressure unrelated to app, samples missing >1%, unenforced limits/unknown swap counters, external workload materially dominates engine. Preserve result rather than presenting lower offered load as PASS.

Healthy stop after workload: SIGTERM with >8s supervisor grace, report shutdown category/exit. DB-stall fault injection is not in capacity gate;8s forced exit is not graceful acceptance. Do not artificially constrain DB to force hang and then claim2GB passed.

## Output / purchase guidance

One safe receipt: immutable images/source, workload/dataset manifest, exact enforced limits and swap configuration, host/engine/CPU caveats, duration and actual7-client counts, offered/completed rates, latency quantiles, cgroup/RSS peaks, errors/reconnects/restarts/OOM, memory trend, stop result and PASS/FAIL/INVALID. Raw synthetic-only metrics are allowed; no auth material. Cleanup only exact owned resources after root retention decision; never prune globally.

PASS supports only “this exact local constrained stack sustained this declared7-client scenario with headroom.” It does not prove real VPS hardware, internet RTT, browser rendering, concurrent campaigns, SMTP spikes, backups/migrations or OS usage fits2GB. Backup/maintenance must not overlap a small-host game session without separate budget evidence. If memory headroom/latency fails, recommend **one4GB server**, not several servers, with the same measured workload replay when available; do not guarantee4GB fixes CPU/disk/network bottlenecks. If2GB passes narrowly or real host overhead is unknown, still present4GB as safer headroom option, owner decides cost/risk.

## Checkpoint

Only this plan changed. Bounded source pointers confirmed installed-client manifest and existing real-socket fixtures; no runtime, benchmark or hardware promise. Next: root resolves packaging gate and dispatches one finite synthetic capacity run with exact resources; no repeated old54/65auth/recovery matrix.

## Pre-run scope update — added player, 2026-10-09

Owner added Илья as one additional player to the recovered six-player party. Before timed measurement begins, freeze capacity workload at eight synthetic authenticated clients: 1 GM + 7 PLAYER (rather than the initial seven total). Resource limits, duration, thresholds and scope limitations stay unchanged. Additional synthetic identity/token control must pass preflight; do not count seven-client results as eight-client evidence. Actual recovered party data is not used in this capacity fixture.
