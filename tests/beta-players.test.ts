import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as contracts from "@arken/contracts";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const webSourceRoot = join(repositoryRoot, "apps", "web", "src");
const removedRuntimeExports = [
  "betaPlayerByHandle",
  "betaPlayers",
  "matchesBetaPlayerIdentity",
  "uniqueBetaPlayerIdentity",
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.(?:c|m)?(?:js|ts|tsx)$/.test(entry.name)
        ? [path]
        : [];
  });
}

describe("server demo roster boundary", () => {
  it("does not publish the removed demo aliases through shared contracts", () => {
    for (const exportName of removedRuntimeExports)
      expect(
        exportName in contracts,
        `${exportName} must not be exported`,
      ).toBe(false);

    const publicEntry = readFileSync(
      join(repositoryRoot, "packages", "contracts", "src", "index.ts"),
      "utf8",
    );
    expect(publicEntry).not.toContain("beta-players");
  });

  it("finds no direct source imports of the local demo fixture under browser code", () => {
    const imports = sourceFiles(webSourceRoot).flatMap((path) => {
      const text = readFileSync(path, "utf8");
      const hasServerDemoImport =
        /(?:\bfrom\s*["'][^"']*demo-players|\bimport\s*["'][^"']*demo-players|\bimport\s*\(\s*["'][^"']*demo-players)/.test(
          text,
        );
      return hasServerDemoImport ? [relative(repositoryRoot, path)] : [];
    });

    expect(imports).toEqual([]);
  });
});
