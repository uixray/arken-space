import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const BASE = "768bf10c1b44badd90d2a0706c192f96343b328e";
const VARIANT = "dismissed-modal-popup-candidate";
const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "test-results/uix502-main-baseline");
const RECEIPTS = path.join(ROOT, "test-results/uix502-main-receipts");
const SPEC = "tests/e2e/modal-owner-contract.spec.ts";
const APPROVED = [
  ".github/workflows/e2e.yml",
  ".github/workflows/modal-owner-diagnostic.yml",
  "apps/web/src/ui/gravity-foundation.css",
  "scripts/collect-modal-owner-diagnostic.mjs",
  "tests/e2e/modal-owner-close-lifecycle.spec.ts",
];
const CANDIDATE_CHANGES = [
  "apps/web/src/ui/gravity-foundation.css",
  "tests/e2e/modal-owner-close-lifecycle.spec.ts",
];
const FROZEN = [
  "apps/web",
  "packages/contracts",
  "packages/system",
  "tests/e2e",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "playwright.config.ts",
];
const TITLES = ["sibling", "nested"].map(
  (topology) => `UIX-502 modal-owner contract ${topology} at 390px`,
);
const ATTACHMENTS = new Map([
  ["modal-owner-diagnostics", ["application/json", "json"]],
  ["a-popup-before-completion", ["image/png", "png"]],
  ["b-over-old-popup-area", ["image/png", "png"]],
  ["b-owned-popup", ["image/png", "png"]],
  ["final-state", ["image/png", "png"]],
]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const command = (file, args) =>
  execFileSync(file, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const git = (...args) => command("git", args);
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, value) =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const check = (condition, code) => {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
};

function snapshot() {
  const changed = git("diff", "--name-only", BASE)
    .split("\n")
    .filter(Boolean)
    .sort();
  check(
    JSON.stringify(changed) === JSON.stringify(APPROVED),
    "UNAPPROVED_SOURCE_DIFF",
  );
  git(
    "diff",
    "--exit-code",
    BASE,
    "--",
    ...FROZEN,
    ...CANDIDATE_CHANGES.map((file) => `:(exclude)${file}`),
  );
  const paths = git("ls-files", "-z", "--", ...FROZEN, ...APPROVED)
    .split("\0")
    .filter(Boolean)
    .sort();
  check(
    paths.includes(SPEC) && paths.includes("pnpm-lock.yaml"),
    "FROZEN_SOURCE_MISSING",
  );
  const files = paths.map((file) => {
    check(lstatSync(file).isFile(), "NONREGULAR_SOURCE_FILE");
    return { path: file, sha256: sha256(readFileSync(file)) };
  });
  return { changed, files, digest: sha256(JSON.stringify(files)) };
}

function before() {
  check(
    process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_OS === "Linux",
    "HOSTED_LINUX_ONLY",
  );
  const source = snapshot();
  const version = (file) => json(path.join(ROOT, file)).version;
  const dependencies = {
    node: process.version,
    pnpm: command("pnpm", ["--version"]),
    playwright: version("node_modules/@playwright/test/package.json"),
    uikit: version("apps/web/node_modules/@gravity-ui/uikit/package.json"),
    react: version("apps/web/node_modules/react/package.json"),
    vite: version("apps/web/node_modules/vite/package.json"),
    chromeExecutable: realpathSync(command("which", ["google-chrome"])),
    chromeVersion: command("google-chrome", ["--version"]),
    channel: "chrome",
  };
  check(
    /^v22\./.test(dependencies.node) && dependencies.pnpm === "10.12.1",
    "NODE_OR_PNPM_MISMATCH",
  );
  check(
    dependencies.playwright === "1.62.1" &&
      dependencies.uikit === "7.43.0" &&
      dependencies.react === "19.2.8" &&
      dependencies.vite === "8.2.1",
    "FRONTEND_DEPENDENCY_MISMATCH",
  );
  check(
    /^Google Chrome \d+\./.test(dependencies.chromeVersion),
    "CHROME_CHANNEL_UNAVAILABLE",
  );
  const diagnosticHead = git("rev-parse", "HEAD");
  check(diagnosticHead === process.env.GITHUB_SHA, "RUN_SHA_MISMATCH");
  writeJson(path.join(RECEIPTS, "modal-owner-run-manifest.json"), {
    productBase: BASE,
    diagnosticHead,
    variant: VARIANT,
    unchangedMainBaselineRun: "34267730181",
    candidateChanges: CANDIDATE_CHANGES,
    contract:
      "Only the named modal-popup CSS, new close-lifecycle spec and CI files differ from productBase. The original twenty-case spec, fixture, Playwright config and dependencies remain unchanged. All tracked files in the declared frontend/test and approved CI scope are hashed before and after execution.",
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    runnerImage: process.env.ImageOS,
    runnerImageVersion: process.env.ImageVersion,
    dependencies,
    source,
    selection: {
      titles: TITLES,
      project: "chromium",
      repeatEach: 10,
      retries: 1,
      workers: 1,
    },
  });
}

function collect() {
  const evidenceErrors = [];
  const cases = [];
  let rawExit = null;
  let manifest;
  let report;
  const record = (code, work) => {
    try {
      return work();
    } catch {
      evidenceErrors.push(code);
      return undefined;
    }
  };
  manifest = record("MISSING_OR_INVALID_PREFLIGHT", () => {
    const value = json(path.join(RECEIPTS, "modal-owner-run-manifest.json"));
    check(
      value.productBase === BASE &&
        value.variant === VARIANT &&
        value.diagnosticHead === git("rev-parse", "HEAD"),
      "MANIFEST_IDENTITY",
    );
    return value;
  });
  record("SOURCE_CHANGED_OR_UNVERIFIED", () => {
    const after = snapshot();
    check(
      manifest && after.digest === manifest.source.digest,
      "SOURCE_DIGEST_MISMATCH",
    );
    manifest.sourceAfterDigest = after.digest;
    manifest.sourceUnchangedAfterRun = true;
    writeJson(path.join(RECEIPTS, "modal-owner-run-manifest.json"), manifest);
  });
  record("MISSING_OR_INVALID_RUNNER_EXIT", () => {
    const value = readFileSync(
      path.join(process.env.RUNNER_TEMP, "uix502-playwright.exit"),
      "utf8",
    ).trim();
    check(/^(0|[1-9]\d{0,2})$/.test(value), "INVALID_EXIT");
    rawExit = Number(value);
  });
  report = record("MISSING_OR_INVALID_PLAYWRIGHT_REPORT", () =>
    json(path.join(process.env.RUNNER_TEMP, "uix502-playwright-raw.json")),
  );
  if (report) {
    record("REPORT_CONFIG_OR_GLOBAL_ERROR", () => {
      check(
        Array.isArray(report.errors) && report.errors.length === 0,
        "GLOBAL_ERRORS",
      );
      const projects = report.config.projects.filter(
        (project) => project.name === "chromium",
      );
      check(
        projects.length === 1 &&
          projects[0].retries === 1 &&
          projects[0].repeatEach === 10 &&
          report.config.workers === 1,
        "CONFIG_MISMATCH",
      );
      check(
        path.resolve(report.config.rootDir) === path.join(ROOT, "tests/e2e"),
        "REPORT_ROOT_MISMATCH",
      );
    });
    const visit = (suites) => {
      for (const suite of suites) {
        for (const spec of suite.specs ?? []) {
          for (const test of spec.tests) {
            const ordinal = cases.length + 1;
            const entry = {
              ordinal,
              title: spec.title,
              project: test.projectName,
              expectedStatus: test.expectedStatus,
              outcome: test.status,
              attempts: [],
            };
            cases.push(entry);
            if (
              !TITLES.includes(spec.title) ||
              test.projectName !== "chromium" ||
              path.resolve(report.config.rootDir, spec.file) !==
                path.join(ROOT, SPEC) ||
              test.expectedStatus !== "passed"
            ) {
              evidenceErrors.push("UNEXPECTED_TEST_IDENTITY");
              continue;
            }
            for (const result of test.results) {
              const attempt = {
                retry: result.retry,
                status: result.status,
                duration: result.duration,
                receipts: [],
                missing: [],
              };
              entry.attempts.push(attempt);
              record("INVALID_ATTEMPT_OR_RECEIPT", () => {
                check(
                  Number.isInteger(result.retry) &&
                    result.retry >= 0 &&
                    result.retry <= 1,
                  "INVALID_RETRY",
                );
                check(
                  entry.attempts.filter((item) => item.retry === result.retry)
                    .length === 1,
                  "DUPLICATE_RETRY",
                );
                const target = path.join(
                  RECEIPTS,
                  `case-${String(ordinal).padStart(2, "0")}`,
                  `retry-${result.retry}`,
                );
                mkdirSync(target, { recursive: true });
                const names = new Set();
                for (const attachment of result.attachments ?? []) {
                  const allowed = ATTACHMENTS.get(attachment.name);
                  if (!allowed) continue;
                  record("MISSING_OR_UNSAFE_ATTACHMENT", () => {
                    check(
                      !names.has(attachment.name) &&
                        attachment.contentType === allowed[0] &&
                        typeof attachment.path === "string",
                      "ATTACHMENT_IDENTITY",
                    );
                    names.add(attachment.name);
                    const source = path.resolve(attachment.path);
                    check(
                      source.startsWith(`${OUTPUT}${path.sep}`) &&
                        realpathSync(source) === source &&
                        lstatSync(source).isFile(),
                      "ATTACHMENT_PATH",
                    );
                    const bytes = readFileSync(source);
                    if (allowed[1] === "png") {
                      check(
                        bytes
                          .subarray(0, 8)
                          .equals(
                            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
                          ),
                        "INVALID_PNG",
                      );
                    } else {
                      const diagnostics = JSON.parse(bytes.toString("utf8"));
                      check(
                        diagnostics.viewport?.width === 390 &&
                          spec.title.includes(` ${diagnostics.topology} `),
                        "DIAGNOSTIC_IDENTITY",
                      );
                      attempt.overlapOwned =
                        diagnostics.overlapHit?.owned ?? null;
                    }
                    const filename = `${attachment.name}.${allowed[1]}`;
                    copyFileSync(source, path.join(target, filename));
                    attempt.receipts.push({
                      name: attachment.name,
                      file: filename,
                      source: path.relative(OUTPUT, source),
                      sha256: sha256(bytes),
                    });
                  });
                }
                const requiredNames =
                  result.status === "passed"
                    ? [...ATTACHMENTS.keys()]
                    : ["modal-owner-diagnostics", "final-state"];
                for (const required of requiredNames) {
                  if (
                    !attempt.receipts.some(
                      (receipt) => receipt.name === required,
                    )
                  )
                    attempt.missing.push(required);
                }
                if (attempt.missing.length)
                  evidenceErrors.push("MISSING_ATTEMPT_FINAL_RECEIPTS");
                attempt.failureCategory =
                  result.status === "passed"
                    ? null
                    : attempt.overlapOwned === false
                      ? "OVERLAP_HIT_NOT_OWNED"
                      : "OTHER_TEST_FAILURE";
                writeJson(path.join(target, "modal-owner-attempt.json"), {
                  caseOrdinal: ordinal,
                  title: spec.title,
                  project: test.projectName,
                  ...attempt,
                });
              });
            }
          }
        }
        visit(suite.suites ?? []);
      }
    };
    record("MALFORMED_TEST_INVENTORY", () => visit(report.suites));
  }
  if (
    cases.length !== 20 ||
    TITLES.some(
      (title) => cases.filter((entry) => entry.title === title).length !== 10,
    )
  )
    evidenceErrors.push("EXPECTED_TWENTY_CASES");
  const notClean = cases.filter(
    (entry) =>
      entry.outcome !== "expected" ||
      entry.attempts.length !== 1 ||
      entry.attempts[0]?.retry !== 0 ||
      entry.attempts[0]?.status !== "passed",
  );
  const stats = report?.stats;
  const cleanStats =
    stats?.expected === 20 &&
    stats?.unexpected === 0 &&
    stats?.flaky === 0 &&
    stats?.skipped === 0;
  const clean =
    rawExit === 0 &&
    evidenceErrors.length === 0 &&
    notClean.length === 0 &&
    cleanStats;
  const classification = evidenceErrors.length
    ? "INFRASTRUCTURE_OR_EVIDENCE_FAILURE"
    : clean
      ? "TWENTY_CLEAN_FIRST_ATTEMPTS"
      : "CANDIDATE_NOT_CLEAN";
  writeJson(path.join(RECEIPTS, "modal-owner-run-summary.json"), {
    productBase: BASE,
    variant: VARIANT,
    diagnosticHead: manifest?.diagnosticHead ?? null,
    classification,
    rawExit,
    sourceVerified: manifest?.sourceUnchangedAfterRun === true,
    counts: {
      scheduled: cases.length,
      notClean: notClean.length,
      expected: stats?.expected ?? null,
      unexpected: stats?.unexpected ?? null,
      flaky: stats?.flaky ?? null,
      skipped: stats?.skipped ?? null,
    },
    evidenceErrors: [...new Set(evidenceErrors)],
    cases,
  });
  console.log(
    `${classification}: ${cases.length} cases; ${notClean.length} non-clean cases; raw exit ${rawExit}.`,
  );
  process.exitCode = clean ? 0 : 1;
}

try {
  mkdirSync(RECEIPTS, { recursive: true });
  if (process.argv[2] === "before") before();
  else if (process.argv[2] === "collect") collect();
  else throw new Error("UNKNOWN_MODE");
} catch (error) {
  const reason =
    typeof error?.code === "string" && /^[A-Z_]+$/.test(error.code)
      ? error.code
      : process.argv[2] === "before"
        ? "PREFLIGHT_COMMAND_OR_IO_FAILED"
        : "COLLECTOR_FAILED";
  writeJson(path.join(RECEIPTS, "modal-owner-run-summary.json"), {
    productBase: BASE,
    classification: "INFRASTRUCTURE_OR_EVIDENCE_FAILURE",
    evidenceErrors: [reason],
  });
  console.error(
    `UIX-502 diagnostic failed (${reason}); no clean baseline claimed.`,
  );
  process.exitCode = 1;
}
