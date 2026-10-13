import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function verifyStagedPool(root, manifest) {
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.equal(git("rev-parse", "HEAD"), manifest.baseSha, "Wrong pool base");
  const entries = manifest.changedFiles;
  assert.ok(entries?.length, "Empty pool");
  const paths = entries.map((entry) => entry.path).sort();
  assert.equal(new Set(paths).size, paths.length, "Duplicate pool path");
  const staged = git("diff", "--cached", "--name-only", "-z")
    .split("\0")
    .filter(Boolean)
    .sort();
  assert.deepEqual(staged, paths, "Staged diff differs from reviewed scope");
  assert.equal(git("diff", "--name-only"), "", "Unstaged tracked changes");
  const blobs = {};
  for (const entry of entries) {
    assert.equal(entry.reviewed, true, "Unreviewed file");
    const object = git("rev-parse", `:${entry.path}`);
    assert.equal(object, entry.gitBlob, `Staged bytes changed: ${entry.path}`);
    assert.equal(
      git("hash-object", "--path", entry.path, entry.path),
      object,
      `Working/index normalized bytes differ: ${entry.path}`,
    );
    blobs[entry.path] = object;
  }
  return { baseSha: manifest.baseSha, tree: git("write-tree"), blobs };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const manifest = JSON.parse(
    readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""),
  );
  const receipt = verifyStagedPool(process.cwd(), manifest);
  writeFileSync(process.argv[3], JSON.stringify(receipt, null, 2));
  console.log(`Reviewed staged tree PASS: ${receipt.tree}`);
}
