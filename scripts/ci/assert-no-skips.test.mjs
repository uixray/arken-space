import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNoSkips } from "./assert-no-skips.mjs";

const vitest = (...statuses) => ({
  testResults: [
    {
      assertionResults: statuses.map((status, index) => ({
        status,
        fullName: `case ${index}`,
      })),
    },
  ],
});

test("passes a Vitest report where every test ran", () => {
  assert.deepEqual(assertNoSkips(vitest("passed", "passed")).problems, []);
});

test("rejects skipped, todo and pending Vitest tests by name", () => {
  const { problems, skipped } = assertNoSkips(
    vitest("passed", "skipped", "todo", "pending"),
  );
  assert.equal(skipped.length, 3);
  assert.match(problems[0], /3 skipped/);
  assert.match(problems[0], /case 1/);
});

test("rejects an empty run and enforces the minimum", () => {
  assert.match(assertNoSkips(vitest()).problems[0], /only 0 passed/);
  assert.match(
    assertNoSkips(vitest("passed"), { minimum: 2 }).problems[0],
    /expected at least 2/,
  );
});

test("reads nested Playwright suites, counting flaky as run", () => {
  const report = {
    suites: [
      {
        title: "live.spec.ts",
        specs: [],
        suites: [
          {
            title: "group",
            specs: [
              {
                title: "a",
                tests: [
                  { projectName: "chromium", status: "expected" },
                  { projectName: "firefox", status: "flaky" },
                ],
              },
              {
                title: "b",
                tests: [{ projectName: "chromium", status: "skipped" }],
              },
            ],
          },
        ],
      },
    ],
  };
  const { passed, skipped, problems } = assertNoSkips(report);
  assert.equal(passed, 2);
  assert.deepEqual(skipped, ["live.spec.ts › group › b › chromium"]);
  assert.equal(problems.length, 1);
});

test("fails loudly on an unknown report", () => {
  assert.throws(() => assertNoSkips({}), /Unknown report format/);
});
