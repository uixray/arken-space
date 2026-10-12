import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceFiles } from "./balance-browser-files.mjs";
test("preserves exact file union, deterministic regardless of discovery order", () => {
  const files = ["a", "b", "c", "d", "e"];
  const weights = { a: 10, b: 8, c: 6, d: 4, e: 2 };
  const bins = balanceFiles(files, weights);
  assert.deepEqual(bins, balanceFiles([...files].reverse(), weights));
  assert.deepEqual(bins.flatMap((b) => b.files).sort(), files);
  assert.equal(Math.max(...bins.map((b) => b.durationMs)), 10);
});
test("includes new files with measured median fallback and rejects bad manifests", () => {
  assert.equal(balanceFiles(["new"], { a: 8, b: 12 })[0].durationMs, 12);
  assert.throws(() => balanceFiles(["a", "a"], {}), /Duplicate/);
  assert.throws(() => balanceFiles(["a"], { a: NaN }), /Invalid duration/);
  assert.throws(() => balanceFiles([], {}, 0), /Invalid shard/);
});
import { planDiscoveredTests } from "./balance-browser-files.mjs";
test("plans authoritative discovery and includes unmeasured/new files without stale ones", () => {
  const report = {
    suites: [
      {
        specs: [
          {
            id: "one",
            file: "a.spec.ts",
            tests: [{ projectName: "chromium" }],
          },
          {
            id: "two",
            file: "new.spec.ts",
            tests: [{ projectName: "chromium" }],
          },
          {
            id: "other",
            file: "only-firefox.spec.ts",
            tests: [{ projectName: "firefox" }],
          },
        ],
      },
    ],
  };
  const plans = planDiscoveredTests(report, "chromium", {
    "a.spec.ts": 10,
    "stale.spec.ts": 200,
  });
  assert.deepEqual(plans.flatMap((b) => b.testIds).sort(), ["one", "two"]);
  assert.deepEqual(plans.flatMap((b) => b.files).sort(), [
    "a.spec.ts",
    "new.spec.ts",
  ]);
  assert.throws(
    () => planDiscoveredTests(report, "missing", {}),
    /No discovered/,
  );
  const duplicate = {
    suites: [{ specs: [...report.suites[0].specs, report.suites[0].specs[0]] }],
  };
  assert.throws(
    () => planDiscoveredTests(duplicate, "chromium", {}),
    /Duplicate test ID/,
  );
});
