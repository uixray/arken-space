// Hosted-only, single-purpose UIX-414 evidence gate. Never rewrites tests/config.
import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { stripVTControlCharacters } from "node:util";

const BASE = "d9e0a13ef8bc545f2581c32907c3e02e6a91df9c";
const BRANCH = "refs/heads/codex/uix-414-character-role-guards";
const ROOT = process.cwd();
const OUT = path.resolve(
  process.env.RUNNER_TEMP ?? "",
  "character-role-guards",
);
const TEST = "apps/web/src/sidebar/CharacterPanel.role-access.test.tsx";
const RUNTIME = "apps/web/src/sidebar/CharacterWorkspace.tsx";
const APPROVED = [
  ".github/workflows/character-role-guards.yml",
  TEST,
  "scripts/check-character-role-guards.mjs",
];
const STAGES = [
  "source-freeze",
  "install",
  "contracts",
  "system",
  "format",
  "lint",
  "web-types",
  "pool",
  "restore",
];
const CHECKER = "scripts/check-character-role-guards.mjs";
// Capture has no arbitrary-command CLI. These are the only approved hosted
// stage commands; exact branch/base/SHA identity is checked before dispatch.
const STAGE_COMMANDS = {
  "source-freeze": [20, "node", [CHECKER, "freeze"]],
  install: [200, "pnpm", ["install", "--frozen-lockfile"]],
  contracts: [60, "pnpm", ["--filter", "@arken/contracts", "build"]],
  system: [35, "pnpm", ["--filter", "@arken/system", "build"]],
  format: [30, "pnpm", ["exec", "prettier", "--check", ...APPROVED]],
  lint: [35, "pnpm", ["exec", "eslint", CHECKER, TEST]],
  "web-types": [65, "pnpm", ["--filter", "@arken/web", "typecheck"]],
  pool: [300, "node", [CHECKER, "pool"]],
  restore: [20, "node", [CHECKER, "restore"]],
};
const SUITE = "CharacterPanel backstory role and mutation wiring";
const CASES = [
  [
    "GM",
    "lets GM edit another owner's backstory with the rendered character target",
  ],
  [
    "OWNER",
    "lets an owning PLAYER edit backstory and retains owner media access",
  ],
  [
    "CONTROLLER",
    "lets a delegated PLAYER edit backstory without granting media access",
  ],
  [
    "UNRELATED",
    "blocks an unrelated PLAYER's backstory interaction without mutation",
  ],
].map(([actor, title]) => ({ actor, title, fullName: `${SUITE} ${title}` }));
const EDITABLE = `  const editable =
    character &&
    (snapshot.me.role === "GM" ||
      character.ownerMembershipId === snapshot.me.id ||
      character.controllerMembershipIds.includes(snapshot.me.id));`;
const BACKSTORY = `          onBlur={(event) =>
            void runCharacterMutation(() =>
              onPatch(character.id, {
                backstory: event.target.value,
                revision: character.revision,
              }),
            )
          }`;
const FAULTS = [
  {
    id: "gm-denied",
    from: EDITABLE,
    to: EDITABLE.replace('snapshot.me.role === "GM"', "false"),
    failures: { GM: "EDITABLE" },
  },
  {
    id: "owner-denied",
    from: EDITABLE,
    to: EDITABLE.replace(
      "character.ownerMembershipId === snapshot.me.id",
      "false",
    ),
    failures: { OWNER: "EDITABLE" },
  },
  {
    id: "controller-denied",
    from: EDITABLE,
    to: EDITABLE.replace(
      "character.controllerMembershipIds.includes(snapshot.me.id)",
      "false",
    ),
    failures: { CONTROLLER: "EDITABLE" },
  },
  {
    id: "unrelated-enabled",
    from: EDITABLE,
    to: "  const editable = character;",
    failures: { UNRELATED: "READ_ONLY" },
  },
  {
    id: "backstory-target",
    from: BACKSTORY,
    to: BACKSTORY.replace("onPatch(character.id,", "onPatch(selectedId,"),
    failures: {
      GM: "PATCH_TARGET_PAYLOAD",
      OWNER: "PATCH_TARGET_PAYLOAD",
      CONTROLLER: "PATCH_TARGET_PAYLOAD",
    },
  },
];
const ATTEMPTS = [
  { id: "baseline", failures: {} },
  ...FAULTS,
  { id: "restored", failures: {} },
];
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_CHILD_FILE_BYTES = 8 * 1024 * 1024;
let activeChild = null;
let interrupted = false;

const check = (condition, code) => {
  if (!condition) throw new Error(code);
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 });
const gitText = (...args) =>
  git(...args)
    .toString("utf8")
    .trim();
const writeJson = (name, data) => {
  const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`);
  if (bytes.length > MAX_JSON_BYTES) {
    writeFileSync(
      path.join(OUT, name),
      JSON.stringify({
        status: "FAILED_OR_INCOMPLETE",
        reason: "JSON_OUTPUT_LIMIT",
        generatedBytes: bytes.length,
        generatedSha256: sha(bytes),
      }),
    );
    throw new Error(`JSON_OUTPUT_LIMIT:${name}`);
  }
  writeFileSync(path.join(OUT, name), bytes);
};
const readJson = (name) => {
  const file = path.join(OUT, name);
  check(statSync(file).size <= MAX_JSON_BYTES, `OVERSIZED_JSON:${name}`);
  return JSON.parse(readFileSync(file, "utf8"));
};
const readExit = (stage) => {
  const file = path.join(OUT, `${stage}.exit`);
  const raw = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  return /^\d{1,3}$/.test(raw) ? Number(raw) : null;
};
const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");

function hostedIdentity() {
  check(
    process.env.GITHUB_ACTIONS === "true" &&
      process.env.GITHUB_EVENT_NAME === "push" &&
      process.env.GITHUB_REF === BRANCH &&
      process.env.RUNNER_TEMP &&
      process.env.OUT === OUT &&
      /^v22\./.test(process.version),
    "HOSTED_BRANCH_NODE_OR_OUTPUT_MISMATCH",
  );
  check(
    gitText("rev-parse", "HEAD") === process.env.GITHUB_SHA,
    "HEAD_MISMATCH",
  );
  git("merge-base", "--is-ancestor", BASE, "HEAD");
  const changed = gitText("diff", "--name-only", BASE, "HEAD")
    .split("\n")
    .filter(Boolean)
    .sort();
  check(
    JSON.stringify(changed) === JSON.stringify(APPROVED),
    "CHANGED_PATH_SCOPE_MISMATCH",
  );
}

function frozenFiles() {
  const explicit = new Set([
    ...APPROVED,
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "vitest.config.ts",
    "eslint.config.js",
  ]);
  return gitText("ls-files", "-z")
    .split("\0")
    .filter(
      (file) =>
        explicit.has(file) ||
        file.startsWith("apps/web/") ||
        file.startsWith("packages/contracts/") ||
        file.startsWith("packages/system/") ||
        /^(?:tsconfig[^/]*\.json|\.prettier[^/]*|\.npmrc|\.gitattributes)$/.test(
          file,
        ),
    )
    .sort();
}

function freeze() {
  hostedIdentity();
  check(
    !gitText("status", "--porcelain", "--untracked-files=no"),
    "DIRTY_SOURCE",
  );
  const original = readFileSync(RUNTIME);
  // Windows worktree CRLF hashes are not Linux checkout hashes. Bind to the
  // pinned Git blob, then preserve the actual hosted bytes without conversion.
  check(
    original.equals(git("show", `${BASE}:${RUNTIME}`)),
    "RUNTIME_NOT_EXACT_BASE_BLOB",
  );
  const text = original.toString("utf8");
  check(Buffer.from(text).equals(original), "NON_UTF8_RUNTIME");
  for (const fault of FAULTS) {
    check(
      text.split(fault.from).length === 2,
      `FAULT_ANCHOR_NOT_UNIQUE:${fault.id}`,
    );
  }
  const files = frozenFiles().map((file) => ({
    file,
    sha256: sha(readFileSync(file)),
  }));
  check(
    [RUNTIME, TEST, "pnpm-lock.yaml", "vitest.config.ts"].every((file) =>
      files.some((entry) => entry.file === file),
    ),
    "REQUIRED_FROZEN_INPUT_MISSING",
  );
  writeFileSync(path.join(OUT, "runtime-original.bin"), original);
  writeJson("source-before.json", {
    base: BASE,
    head: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    node: process.version,
    changed: APPROVED,
    runtime: {
      file: RUNTIME,
      sha256: sha(original),
      gitBlob: gitText("rev-parse", `${BASE}:${RUNTIME}`),
    },
    files,
  });
  console.log(
    `Frozen ${files.length} inputs; runtime matches the exact base blob.`,
  );
}

function loadSource() {
  hostedIdentity();
  const source = readJson("source-before.json");
  check(
    source.base === BASE &&
      source.head === process.env.GITHUB_SHA &&
      source.runId === process.env.GITHUB_RUN_ID &&
      source.runAttempt === process.env.GITHUB_RUN_ATTEMPT,
    "SOURCE_IDENTITY_MISMATCH",
  );
  check(
    JSON.stringify(source.files.map((entry) => entry.file)) ===
      JSON.stringify(frozenFiles()),
    "FROZEN_INVENTORY_MISMATCH",
  );
  const original = readFileSync(path.join(OUT, "runtime-original.bin"));
  check(
    original.equals(git("show", `${BASE}:${RUNTIME}`)) &&
      source.runtime.file === RUNTIME &&
      source.runtime.sha256 === sha(original),
    "RESTORE_BYTES_NOT_EXACT_BASE",
  );
  return { source, original };
}

function immutable(source, runtimeSha = source.runtime.sha256) {
  for (const entry of source.files) {
    const expected = entry.file === RUNTIME ? runtimeSha : entry.sha256;
    check(
      sha(readFileSync(entry.file)) === expected,
      `FROZEN_INPUT_CHANGED:${entry.file}`,
    );
  }
}

function restore(source, original) {
  // Deliberately restore only this one temporary runtime edit, never a test,
  // config, Git checkout, or unrelated file. The immutable check is fail-closed.
  writeFileSync(RUNTIME, original);
  check(
    readFileSync(RUNTIME).equals(original),
    "RUNTIME_RESTORE_NOT_BYTE_EXACT",
  );
  immutable(source);
}

function captureReceipt(id) {
  const receipt = readJson(`${id}-capture.json`);
  check(
    receipt.id === id &&
      receipt.rawExit === readExit(id) &&
      receipt.signal === null &&
      receipt.errors.length === 0 &&
      receipt.complete === true &&
      receipt.observedBytes === receipt.retainedBytes &&
      receipt.retainedBytes <= MAX_LOG_BYTES,
    `CAPTURE_INCOMPLETE_OR_OVERFLOW:${id}`,
  );
  check(
    receipt.retainedSha256 === sha(readFileSync(path.join(OUT, `${id}.log`))),
    `CAPTURE_LOG_CHANGED:${id}`,
  );
  return receipt;
}

async function capture(id, seconds, command, args) {
  const fd = openSync(path.join(OUT, `${id}.log`), "w");
  const observedHash = createHash("sha256");
  const receipt = {
    id,
    rawExit: null,
    signal: null,
    errors: [],
    complete: false,
    observedBytes: 0,
    retainedBytes: 0,
    observedSha256: null,
    retainedSha256: null,
  };
  let killTimer;
  let child;
  const terminate = (reason) => {
    if (!receipt.errors.includes(reason)) receipt.errors.push(reason);
    if (!child?.pid || killTimer) return;
    // detached gives this exact child its own process group. Kill only that
    // owned group, including descendants; never a process-name-wide cleanup.
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already exited */
    }
    killTimer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already exited */
      }
    }, 2000);
  };
  const stop = () => {
    interrupted = true;
    terminate("CAPTURE_INTERRUPTED");
  };
  const consume = (bytes) => {
    observedHash.update(bytes);
    receipt.observedBytes += bytes.length;
    const remaining = MAX_LOG_BYTES - receipt.retainedBytes;
    if (remaining > 0) {
      const count = Math.min(remaining, bytes.length);
      try {
        let written = 0;
        while (written < count) {
          const next = writeSync(fd, bytes, written, count - written);
          check(next > 0, "CAPTURE_SHORT_WRITE");
          written += next;
        }
        receipt.retainedBytes += written;
      } catch {
        terminate("CAPTURE_WRITE_FAILED");
      }
    }
    if (receipt.observedBytes > MAX_LOG_BYTES) terminate("LOG_OUTPUT_LIMIT");
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const result = await new Promise((resolve) => {
      child = spawn(
        "timeout",
        ["--signal=TERM", "--kill-after=5s", `${seconds}s`, command, ...args],
        {
          cwd: ROOT,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, FORCE_COLOR: "0" },
        },
      );
      activeChild = child;
      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      child.once("error", () => {
        receipt.errors.push("CAPTURE_SPAWN_ERROR");
        resolve({ code: null, signal: "SPAWN_ERROR" });
      });
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    receipt.rawExit = result.code;
    receipt.signal = result.signal;
    receipt.complete = receipt.errors.length === 0 && result.signal === null;
  } finally {
    clearTimeout(killTimer);
    activeChild = null;
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    closeSync(fd);
    receipt.observedSha256 = observedHash.digest("hex");
    receipt.retainedSha256 = sha(readFileSync(path.join(OUT, `${id}.log`)));
    writeFileSync(
      path.join(OUT, `${id}.exit`),
      `${receipt.rawExit ?? "missing"}\n`,
    );
    writeJson(`${id}-capture.json`, receipt);
  }
  return receipt;
}

function inspectAttempt(attempt) {
  const errors = [];
  const rawExit = readExit(attempt.id);
  const failures = Object.keys(attempt.failures).length;
  const expectedExit = failures ? 1 : 0;
  if (rawExit !== expectedExit)
    errors.push(`RAW_EXIT_NOT_${expectedExit}:${rawExit}`);
  let counts = null;
  let inventory = [];
  let logBytes = null;
  try {
    captureReceipt(attempt.id);
    const logFile = path.join(OUT, `${attempt.id}.log`);
    logBytes = statSync(logFile).size;
    check(logBytes <= MAX_LOG_BYTES, "OVERSIZED_LOG");
    const log = stripVTControlCharacters(readFileSync(logFile, "utf8"));
    check(
      !/Unhandled Errors|Unhandled Rejection|Uncaught Exception|\bErrors\s+[1-9]\d*\s+errors?/i.test(
        log,
      ),
      "UNHANDLED_OR_RUNNER_ERRORS",
    );
    const report = readJson(`${attempt.id}.json`);
    counts = Object.fromEntries(
      [
        "numTotalTests",
        "numPassedTests",
        "numFailedTests",
        "numPendingTests",
        "numTodoTests",
        "numTotalTestSuites",
        "numFailedTestSuites",
        "numPendingTestSuites",
      ].map((key) => [key, report[key]]),
    );
    check(
      counts.numTotalTests === 4 &&
        counts.numPassedTests === 4 - failures &&
        counts.numFailedTests === failures &&
        counts.numPendingTests === 0 &&
        counts.numTodoTests === 0 &&
        counts.numPendingTestSuites === 0 &&
        counts.numTotalTestSuites === 2 &&
        counts.numFailedTestSuites === (failures ? 2 : 0) &&
        report.success === !failures,
      "WRONG_EXACT_COUNTS",
    );
    check(report.testResults.length === 1, "WRONG_FILE_COUNT");
    const file = report.testResults[0];
    check(
      relative(file.name) === TEST &&
        file.message === "" &&
        file.status === (failures ? "failed" : "passed"),
      "FILE_OR_SUITE_ERROR",
    );
    check(file.assertionResults.length === 4, "WRONG_ASSERTION_COUNT");
    const seen = new Set();
    for (const test of file.assertionResults) {
      const expected = CASES.find((entry) => entry.fullName === test.fullName);
      check(
        expected &&
          !seen.has(test.fullName) &&
          test.title === expected.title &&
          JSON.stringify(test.ancestorTitles) === JSON.stringify([SUITE]),
        "UNEXPECTED_TEST_NAME",
      );
      seen.add(test.fullName);
      const semantic = attempt.failures[expected.actor];
      check(
        test.status === (semantic ? "failed" : "passed"),
        `WRONG_TEST_STATUS:${expected.actor}`,
      );
      if (semantic) {
        check(
          test.failureMessages.length === 1,
          `EXTRA_OR_MISSING_TEST_ERROR:${expected.actor}`,
        );
        const message = stripVTControlCharacters(test.failureMessages[0]);
        const marker = `UIX414_${expected.actor}_${semantic}`;
        const signature =
          semantic === "PATCH_TARGET_PAYLOAD"
            ? /expected "[^"]+" to be called with arguments:/
            : semantic === "READ_ONLY"
              ? /Received element is not disabled:/
              : /Received element is not enabled:/;
        check(
          message.includes(marker) &&
            signature.test(message) &&
            message.includes("CharacterPanel.role-access.test.tsx"),
          `WRONG_SEMANTIC_FAILURE:${expected.actor}`,
        );
      } else {
        check(
          test.failureMessages.length === 0,
          `ERROR_ON_PASS:${expected.actor}`,
        );
      }
      inventory.push({
        actor: expected.actor,
        name: test.fullName,
        status: test.status,
        semantic: semantic ?? null,
      });
    }
    check(seen.size === CASES.length, "MISSING_EXPECTED_TEST");
  } catch (error) {
    errors.push(error.message);
  }
  return {
    id: attempt.id,
    rawExit,
    expectedExit,
    counts,
    inventory,
    logBytes,
    errors,
    accepted: errors.length === 0,
  };
}

async function runAttempt(attempt) {
  check(!interrupted, "POOL_INTERRUPTED");
  const started = Date.now();
  // The kernel cap bounds report generation, not just later acceptance. It
  // also limits each Vitest/Vite cache file; a limit hit is a harness failure,
  // never a product fault. Install/build do not inherit this file-size limit.
  const captured = await capture(attempt.id, 35, "prlimit", [
    `--fsize=${MAX_CHILD_FILE_BYTES}:${MAX_CHILD_FILE_BYTES}`,
    "--",
    "pnpm",
    "exec",
    "vitest",
    "run",
    TEST,
    "--maxWorkers=1",
    "--retry=0",
    "--dangerouslyIgnoreUnhandledErrors=false",
    "--reporter=verbose",
    "--reporter=json",
    `--outputFile.json=${path.join(OUT, `${attempt.id}.json`)}`,
  ]);
  const result = inspectAttempt(attempt);
  result.elapsedMs = Date.now() - started;
  result.signal = captured.signal;
  if (interrupted || captured.signal) {
    result.errors.push(
      interrupted ? "POOL_INTERRUPTED" : `CHILD_SIGNAL:${captured.signal}`,
    );
    result.accepted = false;
  }
  return result;
}

async function pool() {
  const { source, original } = loadSource();
  const originalText = original.toString("utf8");
  const summary = {
    head: process.env.GITHUB_SHA,
    sourceBeforeSha256: sha(readFileSync(path.join(OUT, "source-before.json"))),
    attempts: [],
    diversions: [],
    errors: [],
    restored: false,
  };
  const stop = () => {
    interrupted = true;
    activeChild?.kill("SIGTERM");
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    immutable(source);
    const baseline = await runAttempt(ATTEMPTS[0]);
    summary.attempts.push(baseline);
    check(baseline.accepted, "BASELINE_NOT_FOUR_CLEAN_TESTS");
    for (const fault of FAULTS) {
      immutable(source);
      check(!interrupted, "POOL_INTERRUPTED");
      check(
        originalText.split(fault.from).length === 2,
        `FAULT_ANCHOR_NOT_UNIQUE:${fault.id}`,
      );
      const mutated = Buffer.from(originalText.replace(fault.from, fault.to));
      const record = {
        id: fault.id,
        runtimeBeforeSha256: sha(original),
        runtimeDuringSha256: sha(mutated),
        runtimeAfterSha256: null,
        restored: false,
      };
      summary.diversions.push(record);
      check(
        record.runtimeBeforeSha256 !== record.runtimeDuringSha256,
        `NO_SOURCE_FAULT:${fault.id}`,
      );
      try {
        writeFileSync(RUNTIME, mutated);
        immutable(source, record.runtimeDuringSha256);
        summary.attempts.push(await runAttempt(fault));
        immutable(source, record.runtimeDuringSha256);
      } finally {
        restore(source, original);
        record.runtimeAfterSha256 = sha(readFileSync(RUNTIME));
        record.restored = true;
        writeJson("pool-summary.json", summary);
      }
    }
    immutable(source);
    summary.attempts.push(await runAttempt(ATTEMPTS.at(-1)));
  } catch (error) {
    summary.errors.push(error.message);
  } finally {
    try {
      restore(source, original);
      summary.restored = true;
    } catch (error) {
      summary.errors.push(error.message);
    }
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    summary.accepted =
      !interrupted &&
      summary.restored &&
      summary.errors.length === 0 &&
      summary.attempts.length === ATTEMPTS.length &&
      summary.attempts.every((attempt) => attempt.accepted) &&
      summary.diversions.length === FAULTS.length &&
      summary.diversions.every((fault) => fault.restored);
    writeJson("pool-summary.json", summary);
    console.log(
      summary.accepted
        ? "Four controls PASS; five semantic source faults proved; bytes restored."
        : "POOL_FAILED_OR_INCOMPLETE",
    );
    process.exitCode = summary.accepted ? 0 : 1;
  }
}

function verify() {
  const exits = Object.fromEntries(
    STAGES.map((stage) => [stage, readExit(stage)]),
  );
  const errors = STAGES.filter((stage) => exits[stage] !== 0).map(
    (stage) => `STAGE_NOT_PASSED:${stage}`,
  );
  const attempts = ATTEMPTS.map(inspectAttempt);
  for (const attempt of attempts) {
    errors.push(...attempt.errors.map((error) => `${attempt.id}:${error}`));
  }
  let sourceVerified = false;
  let diversions = [];
  try {
    const { source, original } = loadSource();
    immutable(source);
    check(
      !gitText("status", "--porcelain", "--untracked-files=no"),
      "FINAL_DIRTY_SOURCE",
    );
    const receipt = readJson("pool-summary.json");
    check(
      receipt.head === process.env.GITHUB_SHA &&
        receipt.accepted === true &&
        receipt.restored === true &&
        receipt.errors.length === 0 &&
        receipt.sourceBeforeSha256 ===
          sha(readFileSync(path.join(OUT, "source-before.json"))),
      "POOL_RECEIPT_NOT_ACCEPTED_OR_IMMUTABLE",
    );
    check(
      receipt.attempts.length === ATTEMPTS.length &&
        receipt.attempts.every(
          (attempt, index) =>
            attempt.id === ATTEMPTS[index].id &&
            attempt.accepted === true &&
            attempt.signal === null,
        ),
      "POOL_ATTEMPT_IDENTITY_OR_SIGNAL",
    );
    diversions = receipt.diversions;
    check(diversions.length === FAULTS.length, "MISSING_DIVERSION_RECEIPT");
    for (const [index, fault] of FAULTS.entries()) {
      const record = diversions[index];
      const expectedMutation = Buffer.from(
        original.toString("utf8").replace(fault.from, fault.to),
      );
      check(
        record.id === fault.id &&
          record.restored === true &&
          record.runtimeBeforeSha256 === source.runtime.sha256 &&
          record.runtimeAfterSha256 === source.runtime.sha256 &&
          record.runtimeDuringSha256 === sha(expectedMutation) &&
          record.runtimeDuringSha256 !== source.runtime.sha256,
        `INVALID_DIVERSION_OR_RESTORE:${fault.id}`,
      );
    }
    sourceVerified = true;
  } catch (error) {
    errors.push(error.message);
  }
  for (const stage of STAGES) {
    try {
      captureReceipt(stage);
    } catch (error) {
      errors.push(error.message);
    }
    const wrapper = path.join(OUT, `${stage}.capture.exit`);
    if (!existsSync(wrapper) || readFileSync(wrapper, "utf8").trim() !== "0")
      errors.push(`CAPTURE_WRAPPER_NOT_PASSED:${stage}`);
    const file = path.join(OUT, `${stage}.log`);
    if (!existsSync(file) || statSync(file).size > MAX_LOG_BYTES)
      errors.push(`STAGE_LOG_MISSING_OR_OVERSIZED:${stage}`);
  }
  const status = errors.length
    ? "FAILED_OR_INCOMPLETE"
    : "FOUR_CLEAN_TESTS_AND_FIVE_PROVED_SOURCE_FAULTS";
  writeJson("gate-summary.json", {
    status,
    head: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    exits,
    sourceVerified,
    attempts,
    diversions,
    errors,
    unhandledErrorGate:
      "Control exit 0; fault exit 1 plus exact semantic failures, empty suite error, no unhandled banner; retries 0",
  });
  const summary =
    `${status}\n${STAGES.map((stage) => `${stage}: ${exits[stage] ?? "not recorded"}`).join("\n")}\n` +
    "Expected: baseline 4 PASS, four guard faults 1 FAIL/3 PASS each, target fault 3 FAIL/1 PASS, restored 4 PASS; no skips.\n" +
    `${errors.join("\n")}\n`;
  writeFileSync(path.join(OUT, "summary.txt"), summary);
  console.log(summary);
  process.exitCode = errors.length ? 1 : 0;
}

function retain() {
  const destination = path.join(OUT, "artifacts");
  mkdirSync(destination, { recursive: true });
  const names = [
    "source-before.json",
    "pool-summary.json",
    "gate-summary.json",
    "summary.txt",
    ...ATTEMPTS.flatMap(({ id }) => [
      `${id}.json`,
      `${id}.log`,
      `${id}-capture.json`,
    ]),
    ...STAGES.flatMap((id) => [`${id}.log`, `${id}-capture.json`]),
  ];
  const records = [];
  const errors = [];
  for (const name of names) {
    const file = path.join(OUT, name);
    if (!existsSync(file)) continue; // Missing stages already fail verification.
    const bytes = statSync(file).size;
    const limit = name.endsWith(".json") ? MAX_JSON_BYTES : MAX_LOG_BYTES;
    const retained = Buffer.alloc(Math.min(bytes, limit));
    const fd = openSync(file, "r");
    try {
      let read = 0;
      while (read < retained.length) {
        const count = readSync(
          fd,
          retained,
          read,
          retained.length - read,
          read,
        );
        check(count > 0, `ARTIFACT_SHORT_READ:${name}`);
        read += count;
      }
    } finally {
      closeSync(fd);
    }
    writeFileSync(path.join(destination, name), retained);
    records.push({
      name,
      sourceBytes: bytes,
      retainedBytes: retained.length,
      retainedSha256: sha(retained),
      truncated: bytes > limit,
    });
    if (bytes > limit) errors.push(`ARTIFACT_OUTPUT_LIMIT:${name}`);
  }
  if (errors.length) {
    // The retained gate must not look green next to a truncation receipt.
    const failed = {
      status: "FAILED_OR_INCOMPLETE",
      head: process.env.GITHUB_SHA,
      reason: "ARTIFACT_OUTPUT_LIMIT",
      errors,
    };
    writeFileSync(
      path.join(destination, "gate-summary.json"),
      `${JSON.stringify(failed, null, 2)}\n`,
    );
  }
  const receipt = {
    status: errors.length ? "FAILED_OR_INCOMPLETE" : "BOUNDED_ARTIFACTS",
    limits: {
      logBytes: MAX_LOG_BYTES,
      jsonBytes: MAX_JSON_BYTES,
      vitestFileBytes: MAX_CHILD_FILE_BYTES,
    },
    records,
    errors,
  };
  writeJson("retention-summary.json", receipt);
  writeFileSync(
    path.join(destination, "retention-summary.json"),
    readFileSync(path.join(OUT, "retention-summary.json")),
  );
  console.log(receipt.status);
  process.exitCode = errors.length ? 1 : 0;
}

try {
  check(
    process.env.RUNNER_TEMP && process.env.OUT === OUT,
    "OUTPUT_NOT_OWNED_RUNNER_TEMP",
  );
  mkdirSync(OUT, { recursive: true });
  const mode = process.argv[2];
  if (mode === "capture") {
    hostedIdentity();
    const id = process.argv[3];
    check(
      process.argv.length === 4 && STAGES.includes(id),
      "INVALID_CAPTURE_STAGE",
    );
    const [seconds, command, args] = STAGE_COMMANDS[id];
    const result = await capture(id, seconds, command, args);
    console.log(
      `${id}: raw exit ${result.rawExit ?? "missing"}; ${result.errors.join(",") || "capture complete"}`,
    );
    process.exitCode = result.complete && result.rawExit === 0 ? 0 : 1;
  } else if (mode === "freeze") freeze();
  else if (mode === "pool") await pool();
  else if (mode === "restore") {
    const { source, original } = loadSource();
    restore(source, original);
    console.log("Runtime restored byte-exactly; all frozen inputs unchanged.");
  } else if (mode === "verify") verify();
  else if (mode === "retain") {
    hostedIdentity();
    retain();
  } else
    throw new Error("EXPECTED_CAPTURE_FREEZE_POOL_RESTORE_VERIFY_OR_RETAIN");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
