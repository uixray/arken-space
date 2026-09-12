// Hosted-only real-layout negative control; never mutates tests or config.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";

const runtime = "apps/web/src/mobile-foundation.css";
const spec = "tests/e2e/compact-journal-budget.spec.ts";
const tracked = [
  runtime,
  spec,
  "apps/web/src/styles.css",
  "apps/web/src/sidebar/ChatPanels.tsx",
  "playwright.config.ts",
  "pnpm-lock.yaml",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", timeout: 10000 }).trim();
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REF !== "refs/heads/codex/uix-624-compact-journal" ||
  !process.env.RUNNER_TEMP ||
  process.env.WEB_ORIGIN !== "http://localhost:5173" ||
  process.env.DATABASE_URL !== "postgres://arken:arken@localhost:5432/arken" ||
  git("rev-parse", "HEAD") !== process.env.GITHUB_SHA ||
  git("status", "--porcelain", "--untracked-files=no")
) {
  throw new Error("Exact clean hosted checkout and isolated fixture required");
}

const out = path.join(process.env.RUNNER_TEMP, "compact-journal-budget");
mkdirSync(out, { recursive: true });
const original = readFileSync(runtime);
const frozen = Object.fromEntries(
  tracked.map((file) => [file, hash(readFileSync(file))]),
);
const titles = [
  "PLAYER 650x698: UIX624_JOURNAL_VISIBLE_BUDGET",
  "PLAYER 360x640: UIX624_JOURNAL_VISIBLE_BUDGET",
  "desktop 1280x900 preserves journal flex layout",
].sort();
const receipt = {
  sha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
  frozen,
  runs: [],
  success: false,
  restored: false,
  error: null,
};

function run(id, broken = false) {
  const reportFile = path.join(out, `${id}.json`);
  const child = spawnSync(
    "timeout",
    [
      "--signal=TERM",
      "--kill-after=10s",
      "240s",
      "pnpm",
      "exec",
      "playwright",
      "test",
      spec,
      "--project=chromium",
      "--workers=1",
      "--retries=0",
      "--fail-on-flaky-tests",
      "--trace=off",
      "--reporter=json",
    ],
    {
      encoding: "utf8",
      timeout: 255000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
      },
    },
  );
  if (child.error || child.signal || ![0, 1].includes(child.status)) {
    throw new Error(`${id}: process failed or timed out`);
  }
  const raw = readFileSync(reportFile);
  if (raw.length > 1024 * 1024) throw new Error(`${id}: oversized report`);
  const report = JSON.parse(raw);
  if (report.errors.length) throw new Error(`${id}: unhandled suite error`);
  const cases = [];
  function visit(suites) {
    for (const suite of suites) {
      for (const item of suite.specs ?? []) {
        if (
          !item.file.endsWith("compact-journal-budget.spec.ts") ||
          item.tests.length !== 1
        ) {
          throw new Error(`${id}: unexpected file or project inventory`);
        }
        const test = item.tests[0];
        if (
          test.projectName !== "chromium" ||
          test.expectedStatus !== "passed" ||
          test.results.length !== 1 ||
          test.results[0].retry !== 0
        ) {
          throw new Error(
            `${id}: unexpected project, expected status or retry`,
          );
        }
        const result = test.results[0];
        const shouldFail = broken && item.title.startsWith("PLAYER ");
        const messages = (result.errors ?? [])
          .map((error) => error.message ?? "")
          .join("\n");
        cases.push({
          title: item.title,
          status: result.status,
          expectedFailure: shouldFail,
          semanticFailure: messages.includes("UIX624_JOURNAL_VISIBLE_BUDGET"),
        });
        if (
          result.status !== (shouldFail ? "failed" : "passed") ||
          test.status !== (shouldFail ? "unexpected" : "expected") ||
          item.ok !== !shouldFail ||
          (shouldFail && !messages.includes("UIX624_JOURNAL_VISIBLE_BUDGET")) ||
          (!shouldFail && messages)
        ) {
          console.log(JSON.stringify({ id, title: item.title, messages }));
          throw new Error(`${id}: wrong semantic outcome for ${item.title}`);
        }
      }
      visit(suite.suites ?? []);
    }
  }
  visit(report.suites);
  const names = cases.map((item) => item.title).sort();
  if (
    JSON.stringify(names) !== JSON.stringify(titles) ||
    report.stats.expected !== (broken ? 1 : 3) ||
    report.stats.unexpected !== (broken ? 2 : 0) ||
    report.stats.skipped !== 0 ||
    report.stats.flaky !== 0 ||
    child.status !== (broken ? 1 : 0)
  ) {
    throw new Error(`${id}: inventory or total-count mismatch`);
  }
  if (
    tracked.some(
      (file) => file !== runtime && hash(readFileSync(file)) !== frozen[file],
    )
  ) {
    throw new Error(`${id}: frozen source/test/config changed`);
  }
  receipt.runs.push({ id, exit: child.status, cases });
  console.log(JSON.stringify(receipt.runs.at(-1)));
}

try {
  run("baseline");
  const source = original.toString("utf8");
  const from =
    ".app-shell--compact .activity-feed__controls {\n    display: flex;\n    flex: 0 1 220px;\n    flex-direction: column;\n    min-height: 0;\n    max-height: 220px;";
  const to = from
    .replace("flex: 0 1 220px;", "flex: 0 0 auto;")
    .replace("max-height: 220px;", "max-height: none;");
  if (source.split(from).length !== 2) {
    throw new Error("Deliberate runtime fault anchor must match exactly once");
  }
  writeFileSync(runtime, source.replace(from, to));
  try {
    run("unbounded-controls", true);
  } finally {
    writeFileSync(runtime, original);
  }
  run("restored");
  receipt.success = true;
} catch (error) {
  receipt.error = String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(runtime, original);
  receipt.restored =
    tracked.every((file) => hash(readFileSync(file)) === frozen[file]) &&
    !git("status", "--porcelain", "--untracked-files=no");
  if (!receipt.restored) {
    receipt.success = false;
    process.exitCode = 1;
  }
  writeFileSync(
    path.join(out, "receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt));
}
