import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyReleaseFont } from "./font-release-preflight.mjs";

test("release font preflight rejects absent private source", async () => {
  await assert.rejects(
    verifyReleaseFont({
      sourceRoot: "/absent-font-source",
      distRoot: "/absent-font-dist",
    }),
    /Missing required private source font/,
  );
});
test("release font preflight rejects corrupt or substitute source bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "arken-font-test-"));
  try {
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets/pragmatica-next_vf.woff"), "not a font");
    await assert.rejects(
      verifyReleaseFont({ sourceRoot: root, distRoot: root }),
      /Invalid WOFF signature/,
    );
    await writeFile(
      join(root, "assets/pragmatica-next_vf.woff"),
      "wOFFsubstitute",
    );
    await assert.rejects(
      verifyReleaseFont({ sourceRoot: root, distRoot: root }),
      /SHA-256 mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
