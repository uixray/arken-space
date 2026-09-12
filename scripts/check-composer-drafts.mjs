// Hosted-only async draft regression gate. Tests/config stay immutable.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";

const caller = "apps/web/src/sidebar/ChatPanels.tsx";
const hook = "apps/web/src/ui/useSubmissionDraft.ts";
const spec = "tests/e2e/composer-pending-draft.spec.ts";
const focusSpec = "tests/e2e/dialog-focus.spec.ts";
const componentSpec = "apps/web/src/sidebar/ChatPanels.pending-draft.test.tsx";
const tracked = [
  caller,
  hook,
  spec,
  focusSpec,
  componentSpec,
  "tests/e2e/modal-focus.ts",
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
const out = path.join(process.env.RUNNER_TEMP, "composer-drafts");
mkdirSync(out, { recursive: true });
const originals = Object.fromEntries(
  tracked.map((file) => [file, readFileSync(file)]),
);
const frozen = Object.fromEntries(
  tracked.map((file) => [file, hash(originals[file])]),
);
const prefix = "UIX624_COMPOSER_PENDING_DRAFT";
const activityTitle = `${prefix}: late success and failure never overwrite a newer activity draft`;
const streamTitle = `${prefix}: failed table send cannot restore into another stream scope`;
const composerTitles = [activityTitle, streamTitle];
const directPrefix = "UIX624 DirectChatPanel pending draft ownership";
const directSuccess = `${directPrefix} late success keeps newer text and attachment`;
const directFailure = `${directPrefix} failure restores only untouched text and retains its preview`;
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

function run(id, file, titles, failures = {}, repeat = 1, grep = "") {
  const reportFile = path.join(out, `${id}.json`);
  const child = spawnSync(
    "timeout",
    [
      "--signal=TERM",
      "--kill-after=10s",
      "300s",
      "pnpm",
      "exec",
      "playwright",
      "test",
      file,
      "--project=chromium",
      "--workers=1",
      "--retries=0",
      "--fail-on-flaky-tests",
      "--trace=off",
      "--reporter=json",
      `--repeat-each=${repeat}`,
      ...(grep ? ["--grep", grep] : []),
    ],
    {
      encoding: "utf8",
      timeout: 315000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile },
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
        if (!item.file.endsWith(path.basename(file))) {
          throw new Error(`${id}: unexpected file`);
        }
        for (const test of item.tests) {
          if (
            test.projectName !== "chromium" ||
            test.expectedStatus !== "passed" ||
            test.results.length !== 1 ||
            test.results[0].retry !== 0
          ) {
            throw new Error(`${id}: unexpected project/status/retry`);
          }
          const result = test.results[0];
          const marker = failures[item.title];
          const messages = (result.errors ?? [])
            .map((error) => error.message ?? "")
            .join("\n");
          if (
            result.status !== (marker ? "failed" : "passed") ||
            test.status !== (marker ? "unexpected" : "expected") ||
            (marker ? !messages.includes(marker) : Boolean(messages))
          ) {
            console.log(JSON.stringify({ id, title: item.title, messages }));
            throw new Error(`${id}: wrong semantic outcome`);
          }
          cases.push({ title: item.title, status: result.status, marker });
        }
      }
      visit(suite.suites ?? []);
    }
  }
  visit(report.suites);
  const expectedTitles = Array.from({ length: repeat }, () => titles)
    .flat()
    .sort();
  const failureCount = Object.keys(failures).length * repeat;
  if (
    JSON.stringify(cases.map((item) => item.title).sort()) !==
      JSON.stringify(expectedTitles) ||
    report.stats.expected !== expectedTitles.length - failureCount ||
    report.stats.unexpected !== failureCount ||
    report.stats.skipped !== 0 ||
    report.stats.flaky !== 0 ||
    child.status !== (failureCount ? 1 : 0)
  ) {
    throw new Error(`${id}: inventory/count/exit mismatch`);
  }
  if (
    tracked.some(
      (file) =>
        file !== caller &&
        file !== hook &&
        hash(readFileSync(file)) !== frozen[file],
    )
  ) {
    throw new Error(`${id}: immutable tests/config changed`);
  }
  receipt.runs.push({ id, exit: child.status, cases });
  console.log(JSON.stringify(receipt.runs.at(-1)));
}

function runComponent(id, failures = {}) {
  const reportFile = path.join(out, `${id}.json`);
  const child = spawnSync(
    "timeout",
    [
      "--signal=TERM",
      "--kill-after=5s",
      "70s",
      "pnpm",
      "exec",
      "vitest",
      "run",
      componentSpec,
      "--maxWorkers=1",
      "--no-file-parallelism",
      "--retry=0",
      "--reporter=json",
      `--outputFile=${reportFile}`,
    ],
    { encoding: "utf8", timeout: 80000, maxBuffer: 2 * 1024 * 1024 },
  );
  if (
    child.error ||
    child.signal ||
    /Unhandled (?:Error|Rejection|Exception)/i.test(
      `${child.stdout ?? ""}\n${child.stderr ?? ""}`,
    )
  ) {
    throw new Error(`${id}: process or unhandled-error failure`);
  }
  const raw = readFileSync(reportFile);
  if (raw.length > 1024 * 1024) throw new Error(`${id}: oversized report`);
  const report = JSON.parse(raw);
  const assertions = report.testResults.flatMap((suite) => {
    if (suite.message) throw new Error(`${id}: suite-load error`);
    return suite.assertionResults;
  });
  const names = assertions.map((item) => item.fullName).sort();
  const failed = assertions.filter((item) => item.status === "failed");
  const record = {
    id,
    exit: child.status,
    names,
    failed: failed.map((item) => item.fullName).sort(),
    diagnostics: failed.map((item) => ({
      name: item.fullName,
      message: item.failureMessages.join("\n").slice(0, 2000),
    })),
  };
  receipt.runs.push(record);
  console.log(JSON.stringify(record));
  if (
    JSON.stringify(names) !==
      JSON.stringify([directSuccess, directFailure].sort()) ||
    JSON.stringify(record.failed) !==
      JSON.stringify(Object.keys(failures).sort()) ||
    assertions.some((item) => !["passed", "failed"].includes(item.status)) ||
    report.numTotalTests !== 2 ||
    report.numFailedTests !== failed.length ||
    report.numPassedTests !== 2 - failed.length ||
    report.numPendingTests ||
    report.numTodoTests ||
    child.status !== (failed.length ? 1 : 0) ||
    report.success !== (failed.length === 0)
  ) {
    throw new Error(`${id}: inventory/count/exit mismatch`);
  }
  for (const assertion of failed) {
    if (
      !assertion.failureMessages
        .join("\n")
        .includes(failures[assertion.fullName])
    ) {
      throw new Error(`${id}: wrong semantic failure`);
    }
  }
  if (hash(readFileSync(componentSpec)) !== frozen[componentSpec]) {
    throw new Error(`${id}: component tests changed`);
  }
}

function fault(file, from, to, check) {
  const source = originals[file].toString("utf8");
  if (source.split(from).length !== 2) {
    throw new Error("Runtime fault anchor must match exactly once");
  }
  writeFileSync(file, source.replace(from, to));
  try {
    check();
  } finally {
    writeFileSync(file, originals[file]);
  }
}

try {
  runComponent("direct-baseline");
  const directAck = "if (directDraft.isUntouched(consumed.token)) {";
  fault(caller, directAck, `setComposer("");\n      ${directAck}`, () =>
    runComponent("direct-late-ack-clear", {
      [directSuccess]: "UIX624_DIRECT_NEWER_DRAFT",
    }),
  );
  const directRestore = "directDraft.restore(consumed.token, consumed.value);";
  fault(caller, directRestore, "// Deliberately omit direct recovery.", () =>
    runComponent("direct-no-failure-restore", {
      [directFailure]: "UIX624_DIRECT_RESTORED_DRAFT",
    }),
  );
  runComponent("direct-restored");
  run("baseline", spec, composerTitles);
  const lateAck = 'else await onChat(intent.body, visibility, "TABLE");';
  fault(caller, lateAck, `${lateAck}\n      setComposer("");`, () =>
    run("late-ack-clear", spec, composerTitles, {
      [activityTitle]: `${prefix}: late success preserves newer nonempty draft`,
    }),
  );
  fault(
    hook,
    "if (!isUntouched(token)) return false;",
    "// Deliberate stale restore fault.",
    () =>
      run("unguarded-restore", spec, composerTitles, {
        [activityTitle]: `${prefix}: intentional newer empty draft is not old failure restore`,
        [streamTitle]: `${prefix}: late failure is invalid outside submission scope`,
      }),
  );
  run("restored", spec, composerTitles);
  run(
    "modal-twenty-tab-ten-runs",
    focusSpec,
    ["модальный диалог держит Tab внутри себя"],
    {},
    10,
    "модальный диалог держит Tab внутри себя",
  );
  receipt.success = true;
} catch (error) {
  receipt.error = String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(caller, originals[caller]);
  writeFileSync(hook, originals[hook]);
  receipt.restored =
    tracked.every((file) => hash(readFileSync(file)) === frozen[file]) &&
    !git("status", "--porcelain", "--untracked-files=no");
  if (!receipt.restored) {
    receipt.success = false;
    process.exitCode = 1;
  }
  writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
}
