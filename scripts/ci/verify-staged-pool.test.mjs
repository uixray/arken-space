import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyStagedPool } from "./verify-staged-pool.mjs";

test("binds normalized Git blobs, exact scope and staged tree; rejects tampering", () => {
  const root = mkdtempSync(join(tmpdir(), "arken-pool-git-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git("init");
    git("config", "user.name", "Synthetic pool test");
    git("config", "user.email", "pool@example.invalid");
    writeFileSync(join(root, ".gitattributes"), "*.txt text eol=lf\n");
    git("add", ".gitattributes");
    git("commit", "-m", "base");
    writeFileSync(join(root, "probe.txt"), "normalized\r\n");
    git("add", "probe.txt");
    const manifest = {
      baseSha: git("rev-parse", "HEAD"),
      changedFiles: [
        {
          path: "probe.txt",
          reviewed: true,
          gitBlob: git("rev-parse", ":probe.txt"),
        },
      ],
    };
    assert.equal(verifyStagedPool(root, manifest).tree, git("write-tree"));
    assert.throws(
      () => verifyStagedPool(root, { ...manifest, changedFiles: [] }),
      /Empty pool/,
    );
    assert.throws(
      () =>
        verifyStagedPool(root, {
          ...manifest,
          changedFiles: [{ ...manifest.changedFiles[0], gitBlob: "wrong" }],
        }),
      /Staged bytes changed/,
    );
    writeFileSync(join(root, "extra.txt"), "unreviewed\n");
    git("add", "extra.txt");
    assert.throws(() => verifyStagedPool(root, manifest), /reviewed scope/);
    git("reset", "--", "extra.txt");
    writeFileSync(join(root, "probe.txt"), "tampered\n");
    assert.throws(
      () => verifyStagedPool(root, manifest),
      /Unstaged tracked changes/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
