import process from "node:process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const args of [
  [],
  ["bad", "package.json"],
  ["lint", "."],
  ["lint", "--fix"],
  ["lint", "missing-file"],
  ["test", "tests"],
  ["test", "package.json"],
  ["types", "missing"],
  ["types", "constructor"],
  ["types", "__proto__"],
]) {
  test(`rejects invalid explicit pool ${JSON.stringify(args)}`, () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/qa/dev-check.mjs", ...args],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Explicit pool required|Expected existing explicit file|Expected unit test file|Unknown scope/,
    );
  });
}
