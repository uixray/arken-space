import process from "node:process";
import console from "node:console";
import { readFileSync } from "node:fs";

/**
 * UIX-690/691: an opt-in integration contour is only worth its runner if it
 * actually ran. Vitest `describe.skip`/`skipIf` and Playwright `test.skip`
 * report success with zero assertions, so these suites silently rotted while
 * their environment was missing. Fail when a report has no executed tests or
 * any skipped/pending/todo one.
 */
export function countReport(report) {
  // Vitest JSON reporter.
  if (Array.isArray(report?.testResults)) {
    let passed = 0;
    let failed = 0;
    const skipped = [];
    for (const file of report.testResults)
      for (const test of file.assertionResults ?? []) {
        if (test.status === "passed") passed++;
        else if (test.status === "failed") failed++;
        else skipped.push(test.fullName ?? test.title ?? "(unnamed)");
      }
    return { passed, failed, skipped };
  }
  // Playwright JSON reporter.
  if (Array.isArray(report?.suites)) {
    let passed = 0;
    let failed = 0;
    const skipped = [];
    const visit = (suite, parent) => {
      const path = [...parent, suite.title];
      for (const spec of suite.specs ?? [])
        for (const test of spec.tests ?? []) {
          const name = [...path, spec.title, test.projectName]
            .filter(Boolean)
            .join(" › ");
          if (test.status === "skipped") skipped.push(name);
          else if (test.status === "expected" || test.status === "flaky")
            passed++;
          else failed++;
        }
      for (const child of suite.suites ?? []) visit(child, path);
    };
    for (const suite of report.suites) visit(suite, []);
    return { passed, failed, skipped };
  }
  throw new Error("Unknown report format: expected Vitest or Playwright JSON");
}

export function assertNoSkips(report, { minimum = 1 } = {}) {
  const { passed, failed, skipped } = countReport(report);
  const problems = [];
  if (skipped.length)
    problems.push(
      `${skipped.length} skipped:\n${skipped.map((name) => `  - ${name}`).join("\n")}`,
    );
  if (failed) problems.push(`${failed} failed`);
  if (passed < minimum)
    problems.push(`only ${passed} passed, expected at least ${minimum}`);
  return { passed, failed, skipped, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [path, minimumArg] = process.argv.slice(2);
  if (!path) {
    console.error("usage: assert-no-skips.mjs <report.json> [minimum]");
    process.exit(2);
  }
  const result = assertNoSkips(JSON.parse(readFileSync(path, "utf8")), {
    minimum: minimumArg ? Number(minimumArg) : 1,
  });
  if (result.problems.length) {
    console.error(`Integration contour did not fully run (${path}):`);
    for (const problem of result.problems) console.error(problem);
    process.exit(1);
  }
  console.log(`${path}: ${result.passed} passed, 0 skipped`);
}
