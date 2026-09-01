import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = await readFile(
  new URL("../apps/server/src/spell-assignment-routes.ts", import.meta.url),
  "utf8",
);

describe("UIX-577 spell assignment lock order", () => {
  it("locks the character before claiming the shared action ledger row", () => {
    const start = source.indexOf("async function runMutation(");
    const end = source.indexOf("function versionDto", start);
    const runMutation = source.slice(start, end);
    const targetLock = runMutation.indexOf("await lockTarget(tx)");
    const actionClaim = runMutation.indexOf("await claimAction(");

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(targetLock).toBeGreaterThanOrEqual(0);
    expect(actionClaim).toBeGreaterThan(targetLock);
  });
});
