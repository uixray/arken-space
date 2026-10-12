import process from "node:process";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { runLogged } from "./run-logged.mjs";
import { planDiscoveredTests } from "./balance-browser-files.mjs";
const require = createRequire(import.meta.url);
const cli = require.resolve("@playwright/test/cli");
const [project, shardText, countText = "3", mode = "run"] =
  process.argv.slice(2);
const shard = Number(shardText),
  count = Number(countText);
const discoveryEnv = { ...process.env };
delete discoveryEnv.PLAYWRIGHT_JSON_OUTPUT_NAME;
if (
  !["chromium", "firefox"].includes(project) ||
  !Number.isSafeInteger(shard) ||
  shard < 1 ||
  shard > count ||
  !["run", "plan"].includes(mode)
)
  throw new Error(
    "Usage: node scripts/ci/run-balanced-browser.mjs chromium|firefox shard count [plan|run]",
  );
const discovery = spawnSync(
  process.execPath,
  [cli, "test", "--list", `--project=${project}`, "--reporter=json"],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: discoveryEnv },
);
if (discovery.status !== 0) {
  process.stderr.write(discovery.stderr);
  process.stdout.write(discovery.stdout);
  process.exit(discovery.status ?? 1);
}
const report = JSON.parse(discovery.stdout);
if (report.errors?.length)
  throw new Error(`Discovery failed: ${JSON.stringify(report.errors)}`);
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./browser-file-durations.json", import.meta.url)),
    "utf8",
  ).replace(/^\uFEFF/, ""),
);
const plans = planDiscoveredTests(
  report,
  project,
  manifest.projects[project],
  count,
);
writeFileSync(
  `e2e-plan-${project}-${shard}.json`,
  JSON.stringify(
    { project, shard, count, sourceSha: manifest.sourceSha, plans },
    null,
    2,
  ),
);

const selected = plans[shard - 1];
if (!selected.files.length)
  throw new Error("Empty shard is not a passing browser gate");
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Playwright CLI file filters are regular expressions matching full normalized paths.
const filters = selected.files.map(
  (file) => `(?:^|[/\\\\])${escape(file).replaceAll("/", "[/\\\\]")}$`,
);
const filtered = spawnSync(
  process.execPath,
  [
    cli,
    "test",
    ...filters,
    `--project=${project}`,
    "--list",
    "--reporter=json",
  ],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: discoveryEnv },
);
if (filtered.status !== 0)
  throw new Error(`Selected discovery failed: ${filtered.stderr}`);
const selectedReport = JSON.parse(filtered.stdout);
if (selectedReport.errors?.length)
  throw new Error("Selected discovery has errors");
const actualIds = planDiscoveredTests(
  selectedReport,
  project,
  manifest.projects[project],
  1,
)[0].testIds;
if (JSON.stringify(actualIds) !== JSON.stringify(selected.testIds))
  throw new Error(
    "Actual Playwright file filter does not match planned test IDs",
  );
if (mode === "plan") {
  console.log(
    JSON.stringify({
      plans: plans.map((p) => ({
        index: p.index,
        files: p.files.length,
        tests: p.testIds.length,
        durationMs: p.durationMs,
      })),
      selectedDiscoveryVerified: true,
    }),
  );
  process.exit(0);
}
const status = await runLogged(
  process.execPath,
  [
    cli,
    "test",
    ...filters,
    `--project=${project}`,
    "--workers=1",
    // Leave time for JSON/diagnostic uploads before the 45-minute job deadline.
    "--global-timeout=2400000",
    "--fail-on-flaky-tests",
    "--reporter=line,json",
  ],
  "browser-run.log",
);
process.exit(status);
