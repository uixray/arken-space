import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { collectImpactInputs } from "../scripts/qa/impact-report.mjs";

describe("read-only Git impact input collection", () => {
  it("uses a resolved commit and preserves NUL-delimited modified and untracked paths", () => {
    const root = resolve("synthetic root");
    const revision = "a".repeat(40);
    const git = vi
      .fn()
      .mockReturnValueOnce(root + "\n")
      .mockReturnValueOnce(revision + "\n")
      .mockReturnValueOnce("a.ts\0space file.ts\0")
      .mockReturnValueOnce("z-new.ts\0space file.ts\0");
    expect(collectImpactInputs("HEAD~1", root, git)).toEqual({
      root,
      revision,
      paths: ["a.ts", "space file.ts", "z-new.ts"],
    });
    expect(git.mock.calls.map(([args]) => args)).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["rev-parse", "--verify", "--end-of-options", "HEAD~1^{commit}"],
      ["diff", "--name-only", "-z", "--no-renames", revision, "--"],
      ["ls-files", "--others", "--exclude-standard", "-z", "--"],
    ]);
  });
  it("rejects option-shaped bases before Git and rejects an unresolved hash before diff", () => {
    const git = vi.fn();
    expect(() => collectImpactInputs("--all", resolve("."), git)).toThrow();
    expect(git).not.toHaveBeenCalled();
    git.mockReturnValueOnce(resolve(".")).mockReturnValueOnce("bad ref");
    expect(() => collectImpactInputs("HEAD", resolve("."), git)).toThrow(
      /full commit ID/,
    );
    expect(git).toHaveBeenCalledTimes(2);
  });
});

it("maps the account boundary while keeping database and rollout paths for review", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { selectImpact, UIX694_IMPACT_MAP } =
    await import("../scripts/qa/impact-map.mjs");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = selectImpact(
    UIX694_IMPACT_MAP,
    [
      "apps/server/src/auth.ts",
      "packages/db/src/schema.ts",
      "packages/db/drizzle/0089_campaign_archive.sql",
    ],
    { readText: (path: string) => readFileSync(resolve(root, path), "utf8") },
  );
  expect(result.validationErrors).toEqual([]);
  expect(result.matchedRules.map((rule) => rule.id)).toEqual([
    "account-campaign-boundary",
  ]);
  expect(result.journeys).toHaveLength(3);
  expect(result.unmatchedPaths).toEqual([
    "packages/db/src/schema.ts",
    "packages/db/drizzle/0089_campaign_archive.sql",
  ]);
  expect(result.reviewRequired).toBe(true);
});
