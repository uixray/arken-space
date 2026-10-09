import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  exportExactCandidateContext,
  validateCandidateContextRequest,
} from "../scripts/exact-candidate-context.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";

describe("exact candidate context allowlist", () => {
  it("requires an explicit immutable SHA and reviewed positive file list", () => {
    expect(() =>
      validateCandidateContextRequest({ sha: "HEAD", files: ["README.md"] }),
    ).toThrow(/full immutable/);
    expect(() =>
      validateCandidateContextRequest({ sha, files: ["README.md", "../.env"] }),
    ).toThrow(/Unsafe/);
    expect(() =>
      validateCandidateContextRequest({ sha, files: [".data/private.json"] }),
    ).toThrow(/Unsafe/);
    expect(() =>
      validateCandidateContextRequest({
        sha,
        files: ["packages/web/.env.local"],
      }),
    ).toThrow(/Unsafe/);
    expect(() =>
      validateCandidateContextRequest({
        sha,
        files: ["node_modules/pkg/index.js"],
      }),
    ).toThrow(/Unsafe/);
    expect(() =>
      validateCandidateContextRequest({
        sha,
        files: ["apps/web/public/guide.webp"],
      }),
    ).not.toThrow();
    for (const file of [
      "apps/server/config/local-private.json",
      "infra/certificates/tls.key",
      "infra/certificates/tls.pem",
      "apps/server/data/local.db",
      "apps/server/config/service-account.json",
    ])
      expect(() =>
        validateCandidateContextRequest({ sha, files: [file] }),
      ).toThrow(/Unsafe/);
    expect(() =>
      validateCandidateContextRequest({
        sha,
        files: ["packages/web/src/main.ts"],
        requiredImports: ["packages/web/package.json"],
      }),
    ).toThrow(/Required import/);
  });

  it("reports reviewed allowlist additions in plan mode without reading Git or writing", () => {
    const result = exportExactCandidateContext({
      sha,
      files: ["packages/web/package.json", "packages/web/src/main.ts"],
      requiredImports: ["packages/web/package.json"],
      historicalFiles: ["packages/web/package.json"],
    });
    expect(result).toMatchObject({
      mode: "plan",
      sha,
      additions: ["packages/web/src/main.ts"],
      blobs: [],
    });
    expect(() =>
      validateCandidateContextRequest({
        sha,
        files: [
          "Dockerfile.server",
          "Dockerfile.web",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig.base.json",
        ],
        requiredImports: [
          "Dockerfile.server",
          "Dockerfile.web",
          "pnpm-lock.yaml",
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a reparse/symlink escape before consulting Git or writing", () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "arken-context-test-"));
    try {
      const qaRoot = path.join(temp, ".data", "qa-prep");
      const outside = path.join(temp, "outside");
      mkdirSync(qaRoot, { recursive: true });
      mkdirSync(outside);
      const link = path.join(qaRoot, "linked");
      symlinkSync(
        outside,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
      expect(() =>
        exportExactCandidateContext({
          sha,
          files: ["packages/app/package.json"],
          repositoryRoot: temp,
          artifactRoot: qaRoot,
          outputDirectory: path.join(link, "context"),
          write: true,
        }),
      ).toThrow(/Symlink or reparse/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("exports only committed blobs from an exact synthetic Git commit", () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), "arken-context-git-"));
    const runGit = (args: string[]) =>
      execFileSync("git", args, {
        cwd: repo,
        stdio: "ignore",
        env: {
          PATH: process.env.PATH ?? "",
          SYSTEMROOT: process.env.SYSTEMROOT ?? "",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_NAME: "Synthetic Test",
          GIT_AUTHOR_EMAIL: "synthetic@example.invalid",
          GIT_COMMITTER_NAME: "Synthetic Test",
          GIT_COMMITTER_EMAIL: "synthetic@example.invalid",
        },
      });
    try {
      const sourcePath = path.join(repo, "apps", "server", "package.json");
      const dockerfilePath = path.join(repo, "Dockerfile.server");
      mkdirSync(path.dirname(sourcePath), { recursive: true });
      writeFileSync(sourcePath, '{"name":"synthetic-server"}\n');
      writeFileSync(dockerfilePath, "FROM synthetic\n");
      runGit(["init", "--quiet"]);
      runGit(["add", "--", "apps/server/package.json", "Dockerfile.server"]);
      runGit(["commit", "--quiet", "-m", "synthetic context fixture"]);
      const commit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SYSTEMROOT: process.env.SYSTEMROOT ?? "",
          GIT_CONFIG_NOSYSTEM: "1",
        },
      }).trim();
      const artifactRoot = path.join(repo, ".data", "qa-prep", "fixture-001");
      mkdirSync(artifactRoot, { recursive: true });
      writeFileSync(sourcePath, '{"name":"dirty-overlay-must-not-leak"}\n');
      const output = path.join(artifactRoot, "server-context");
      const manifest = exportExactCandidateContext({
        sha: commit,
        files: ["Dockerfile.server", "apps/server/package.json"],
        requiredImports: ["apps/server/package.json"],
        historicalFiles: ["Dockerfile.server"],
        repositoryRoot: repo,
        artifactRoot,
        outputDirectory: output,
        write: true,
      });
      expect(manifest.mode).toBe("exported");
      expect(manifest.additions).toEqual(["apps/server/package.json"]);
      expect(
        readFileSync(
          path.join(output, "apps", "server", "package.json"),
          "utf8",
        ),
      ).toBe('{"name":"synthetic-server"}\n');
      expect(manifest.blobs.map((blob) => blob.path)).toEqual([
        "Dockerfile.server",
        "apps/server/package.json",
      ]);
      expect(() =>
        exportExactCandidateContext({
          sha: commit,
          files: ["Dockerfile.server", "apps/server/package.json"],
          repositoryRoot: repo,
          artifactRoot,
          outputDirectory: output,
          write: true,
        }),
      ).toThrow(/new exclusive directory/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
