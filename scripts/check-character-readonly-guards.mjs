// Hosted-only source-diversion gate. Never changes tests or configuration.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";

const runtime = "apps/web/src/sidebar/CharacterWorkspace.tsx";
const test = "apps/web/src/sidebar/CharacterPanel.role-access.test.tsx";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", timeout: 10000 }).trim();

if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REF !== "refs/heads/codex/uix-414-sheet-readonly" ||
  !process.env.RUNNER_TEMP ||
  git("rev-parse", "HEAD") !== process.env.GITHUB_SHA ||
  git("status", "--porcelain", "--untracked-files=no")
) {
  throw new Error(
    "Only an exact clean authorized hosted checkout may run this gate",
  );
}

const out = path.join(process.env.RUNNER_TEMP, "character-readonly");
mkdirSync(out, { recursive: true });
const original = readFileSync(runtime);
const frozenTest = sha256(readFileSync(test));
const source = original.toString("utf8");
const receipt = {
  sha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
  runtimeBefore: sha256(original),
  testSha: frozenTest,
  runs: [],
  restored: false,
  success: false,
  error: null,
};

const suite = "CharacterPanel identity and portrait role wiring";
const positive = ["GM", "OWNER", "CONTROLLER"].map(
  (actor) =>
    suite +
    " " +
    actor +
    " can rename, choose a portrait, and upload with the character target",
);
const unrelated =
  suite +
  " disables rename, picker and portrait upload for an unrelated player";
const revoked =
  suite +
  " rechecks edit permission before submitting an already-open rename dialog";
const positiveFailures = (marker) =>
  Object.fromEntries(positive.map((name) => [name, marker]));
const selectedRevoked =
  suite +
  " disables an already-selected portrait after edit permission is revoked";
const pendingCases = [
  [
    "does not patch a portrait whose upload resolves after permission loss",
    "UIX414_PORTRAIT_PENDING_REVOKED_PATCH_0",
  ],
  [
    "does not patch a portrait whose upload resolves after unmount",
    "UIX414_PORTRAIT_PENDING_UNMOUNT_PATCH_0",
  ],
  [
    "does not redirect a pending portrait upload to a different character",
    "UIX414_PORTRAIT_PENDING_TARGET_CHANGE_PATCH_0",
  ],
  [
    "does not assign a pending portrait after the active actor changes",
    "UIX414_PORTRAIT_PENDING_ACTOR_CHANGE_PATCH_0",
  ],
].map(([name, marker]) => [suite + " " + name, marker]);
const pendingFailures = Object.fromEntries(pendingCases);
const expectedNames = [
  ...positive,
  selectedRevoked,
  ...pendingCases.map(([name]) => name),
  unrelated,
  revoked,
  ...[
    "lets GM edit another owner's backstory with the rendered character target",
    "lets an owning PLAYER edit backstory and retains owner media access",
    "lets a delegated PLAYER edit backstory without granting media access",
    "blocks an unrelated PLAYER's backstory interaction without mutation",
  ].map((name) => "CharacterPanel backstory role and mutation wiring " + name),
].sort();
const faults = [
  {
    id: "rename-enabled",
    replacements: [
      [
        "<Button disabled={!editable} onClick={() => setRenameOpen(true)}>",
        "<Button onClick={() => setRenameOpen(true)}>",
      ],
    ],
    failures: { [unrelated]: "UIX414_IDENTITY_RENAME_DISABLED" },
  },
  {
    id: "picker-enabled",
    replacements: [
      [
        'noneLabel="Без портрета"\n          disabled={!editable}',
        'noneLabel="Без портрета"',
      ],
    ],
    failures: { [unrelated]: "UIX414_IDENTITY_PICK_DISABLED" },
  },
  {
    id: "upload-enabled",
    replacements: [
      [
        "value={portraitUpload}\n        disabled={!editable}",
        "value={portraitUpload}",
      ],
    ],
    failures: { [unrelated]: "UIX414_IDENTITY_UPLOAD_DISABLED" },
  },
  {
    id: "rename-revocation-ignored",
    replacements: [
      [
        "onApply={async (name) => {\n          if (!editable) return;",
        "onApply={async (name) => {",
      ],
    ],
    failures: { [revoked]: "UIX414_IDENTITY_RECHECK_NO_PATCH" },
  },
  {
    id: "rename-wrong-target",
    replacements: [
      [
        "await onPatch(character.id, {\n            name,",
        "await onPatch(selectedId, {\n            name,",
      ],
    ],
    failures: positiveFailures("UIX414_IDENTITY_RENAME_PATCH_TARGET"),
  },
  {
    id: "picker-wrong-target",
    replacements: [
      [
        "onPatch(character.id, {\n                portraitAssetId: assetId,",
        "onPatch(selectedId, {\n                portraitAssetId: assetId,",
      ],
    ],
    failures: positiveFailures("UIX414_IDENTITY_PICK_PATCH_TARGET"),
  },
  {
    id: "upload-wrong-target",
    replacements: [
      ["const targetId = character.id;", "const targetId = selectedId;"],
    ],
    failures: positiveFailures("UIX414_IDENTITY_UPLOAD_PATCH_TARGET"),
  },
  {
    id: "selected-upload-enabled-after-revoke",
    replacements: [
      ["disabled={!editable || !portraitUpload}", "disabled={!portraitUpload}"],
    ],
    failures: {
      [selectedRevoked]: "UIX414_PORTRAIT_SELECTED_REVOKED_ASSIGN_DISABLED",
    },
  },
  {
    id: "pending-upload-context-ignored",
    replacements: [
      [
        "if (portraitUploadEpochRef.current !== uploadEpoch) return;",
        "void uploadEpoch;",
      ],
    ],
    failures: pendingFailures,
  },
  {
    id: "pending-upload-unmount-ignored",
    replacements: [
      [
        "if (portraitUploadEpochRef.current === epoch) {\n        portraitUploadEpochRef.current = epoch + 1;\n      }",
        "void epoch;",
      ],
    ],
    failures: Object.fromEntries([pendingCases[1]]),
  },
  {
    id: "pending-upload-permission-ignored",
    replacements: [
      ["    editable,\n    portraitUpload,", "    portraitUpload,"],
    ],
    failures: Object.fromEntries([pendingCases[0]]),
  },
  {
    id: "pending-upload-target-ignored",
    replacements: [
      ["    character?.id,\n    editable,", "    editable,"],
    ],
    failures: Object.fromEntries([pendingCases[2]]),
  },
  {
    id: "pending-upload-actor-ignored",
    replacements: [
      [
        "    snapshot.me.id,\n    snapshot.me.role,",
        "    snapshot.me.role,",
      ],
    ],
    failures: Object.fromEntries([pendingCases[3]]),
  },
];

function replaceOnce(input, from, to) {
  if (!from || input.split(from).length !== 2 || from === to) {
    throw new Error("Source diversion anchor is missing, ambiguous or inert");
  }
  return input.replace(from, to);
}

function run(id, expectedFailures = {}) {
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
      test,
      "--maxWorkers=1",
      "--no-file-parallelism",
      "--retry=0",
      "--reporter=json",
      `--outputFile=${reportFile}`,
    ],
    { encoding: "utf8", timeout: 80000, maxBuffer: 2 * 1024 * 1024 },
  );
  const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  if (
    child.error ||
    child.signal ||
    /Unhandled (?:Error|Rejection|Exception)/i.test(output)
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
  const expected = Object.keys(expectedFailures).sort();
  const failed = assertions.filter((item) => item.status === "failed");
  const observed = failed.map((item) => item.fullName).sort();
  const names = assertions.map((item) => item.fullName).sort();
  const record = {
    id,
    exit: child.status,
    names,
    failed: observed,
    diagnostics: failed.map((item) => ({
      name: item.fullName,
      message: item.failureMessages.join("\n").slice(0, 2000),
    })),
  };
  receipt.runs.push(record);
  if (
    JSON.stringify(names) !== JSON.stringify(expectedNames) ||
    new Set(names).size !== names.length ||
    assertions.some((item) => !["passed", "failed"].includes(item.status)) ||
    report.numTotalTests !== assertions.length ||
    report.numFailedTests !== failed.length ||
    report.numPassedTests !== assertions.length - failed.length ||
    report.numPendingTests ||
    report.numTodoTests ||
    child.status !== (expected.length ? 1 : 0) ||
    report.success !== (expected.length === 0) ||
    JSON.stringify(expected) !== JSON.stringify(observed)
  ) {
    throw new Error(`${id}: unexpected test outcome; see receipt`);
  }
  for (const assertion of failed) {
    if (
      !assertion.failureMessages
        .join("\n")
        .includes(expectedFailures[assertion.fullName])
    ) {
      throw new Error(
        `${id}: wrong semantic failure for ${assertion.fullName}`,
      );
    }
  }
  if (
    id !== "baseline" &&
    JSON.stringify(names) !== JSON.stringify(receipt.runs[0].names)
  ) {
    throw new Error(`${id}: test inventory drift`);
  }
  if (sha256(readFileSync(test)) !== frozenTest)
    throw new Error("Tests changed");
  console.log(JSON.stringify(record));
}

try {
  if (!faults.length)
    throw new Error("No reviewed negative controls configured");
  run("baseline");
  for (const fault of faults) {
    let mutated = source;
    for (const [from, to] of fault.replacements) {
      mutated = replaceOnce(mutated, from, to);
    }
    writeFileSync(runtime, mutated);
    try {
      run(fault.id, fault.failures);
    } finally {
      writeFileSync(runtime, original);
    }
  }
  run("restored");
  receipt.success = true;
} catch (error) {
  receipt.error = String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(runtime, original);
  receipt.restored =
    sha256(readFileSync(runtime)) === receipt.runtimeBefore &&
    sha256(readFileSync(test)) === frozenTest &&
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
