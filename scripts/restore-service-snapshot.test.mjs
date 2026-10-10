import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateServiceSnapshotManifest } from "./restore-rehearsal-core.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");

function makeSnapshot() {
  const temp = mkdtempSync(path.join(os.tmpdir(), "arken-v1-snapshot-"));
  const root = path.join(temp, "random-restic-path", "capture");
  mkdirSync(path.join(root, "media"), { recursive: true });
  mkdirSync(path.join(root, "images"), { recursive: true });
  const payloads = new Map([
    ["database.dump", "synthetic-dump"],
    ["database-counts.txt", "assets|1\n"],
    ["postgres-version.txt", "17.5\n"],
    ["migration-ledger.txt", "1|" + "a".repeat(64) + "|100\n"],
    ["images/server.tar", "server-image"],
    ["images/postgres.tar", "postgres-image"],
    ["images/web.tar", "web-image"],
    ["images/edge.tar", "edge-image"],
    ["media/asset.bin", "media-bytes"],
  ]);
  const writeManifest = (entries = [...payloads]) => {
    for (const [relative, value] of entries) {
      const file = path.join(root, ...relative.split("/"));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, value);
    }
    const manifest = {
      format: "arken-service-snapshot-v1",
      captureMode: "cloned-review",
      target: {
        containerIds: ["a", "b", "c", "d"].map((c) => c.repeat(64)),
        networkId: "e".repeat(64),
        databaseName: "reviewdb",
        mediaSource: "/private/media",
        mediaContainerPath: "/app/media",
        edgeConfigSource: "/private/nginx.conf",
        edgeConfigContainerPath: "/etc/nginx/default.conf",
      },
      images: {
        server: "sha256:" + "1".repeat(64),
        postgres: "sha256:" + "2".repeat(64),
        web: "sha256:" + "3".repeat(64),
        edge: "sha256:" + "4".repeat(64),
      },
      files: entries.map(([relative, value]) => ({
        path: relative,
        bytes: Buffer.byteLength(value),
        sha256: sha(value),
      })),
    };
    const manifestPath = path.join(root, "capture-manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    return {
      temp,
      root,
      manifest,
      manifestPath,
      digest: sha(readFileSync(manifestPath)),
    };
  };
  return { temp, root, payloads, writeManifest };
}

test("validates a relocated v1 manifest and returns manifest-relative media path", async () => {
  const fixture = makeSnapshot();
  try {
    const { digest, root } = fixture.writeManifest();
    const result = await validateServiceSnapshotManifest(
      path.dirname(path.dirname(root)),
      { expectedManifestSha256: digest },
    );
    assert.equal(result.captureRoot, root);
    assert.equal(result.mediaRootRelativePath, "media");
    assert.equal(result.databaseDumpRelativePath, "database.dump");
    assert.equal(result.files, 9);
    assert.equal(result.manifestSha256, digest);
  } finally {
    rmSync(fixture.temp, { recursive: true, force: true });
  }
});

test("rejects a receipt digest mismatch and tampered file bytes", async () => {
  const fixture = makeSnapshot();
  try {
    const { digest, root } = fixture.writeManifest();
    await assert.rejects(
      validateServiceSnapshotManifest(path.dirname(path.dirname(root)), {
        expectedManifestSha256: "0".repeat(64),
      }),
      /manifest digest/i,
    );
    writeFileSync(path.join(root, "media", "asset.bin"), "tampered");
    await assert.rejects(
      validateServiceSnapshotManifest(path.dirname(path.dirname(root)), {
        expectedManifestSha256: digest,
      }),
      /size mismatch|hash mismatch/i,
    );
  } finally {
    rmSync(fixture.temp, { recursive: true, force: true });
  }
});

test("rejects missing and unlisted files", async () => {
  const fixture = makeSnapshot();
  try {
    const { digest, root } = fixture.writeManifest();
    rmSync(path.join(root, "images", "web.tar"));
    await assert.rejects(
      validateServiceSnapshotManifest(path.dirname(path.dirname(root)), {
        expectedManifestSha256: digest,
      }),
    );
    fixture.writeManifest();
    writeFileSync(path.join(root, "media", "not-listed.bin"), "extra");
    const manifestPath = path.join(root, "capture-manifest.json");
    const freshDigest = sha(readFileSync(manifestPath));
    await assert.rejects(
      validateServiceSnapshotManifest(path.dirname(path.dirname(root)), {
        expectedManifestSha256: freshDigest,
      }),
      /undeclared/i,
    );
  } finally {
    rmSync(fixture.temp, { recursive: true, force: true });
  }
});

test("rejects duplicate, case-colliding, traversal, absolute, drive, UNC, and backslash paths", async () => {
  const invalidPaths = [
    "database.dump/../escape",
    "/absolute/file",
    "C:/drive/file",
    "//server/share/file",
    "media\\file.bin",
    "media/./file.bin",
  ];
  for (const invalid of invalidPaths) {
    const fixture = makeSnapshot();
    try {
      const { manifest, root } = fixture.writeManifest();
      manifest.files[0].path = invalid;
      const manifestPath = path.join(root, "capture-manifest.json");
      writeFileSync(manifestPath, JSON.stringify(manifest));
      await assert.rejects(
        validateServiceSnapshotManifest(path.dirname(path.dirname(root)), {
          expectedManifestSha256: sha(readFileSync(manifestPath)),
        }),
      );
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  }
  for (const collision of ["duplicate", "case"]) {
    const fixture = makeSnapshot();
    try {
      const { manifest, root } = fixture.writeManifest();
      if (collision === "duplicate") manifest.files.push({ ...manifest.files[0] });
      else manifest.files.push({ ...manifest.files.at(-1), path: "Media/asset.bin" });
      const manifestPath = path.join(root, "capture-manifest.json");
      writeFileSync(manifestPath, JSON.stringify(manifest));
      await assert.rejects(
        validateServiceSnapshotManifest(path.dirname(path.dirname(root)), {
          expectedManifestSha256: sha(readFileSync(manifestPath)),
        }),
      );
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  }
});

test("rejects symlinked media files when the platform permits symlink creation", async (t) => {
  const fixture = makeSnapshot();
  try {
    const { digest, root } = fixture.writeManifest();
    try {
      rmSync(path.join(root, "media", "asset.bin"));
      symlinkSync(path.join(root, "database.dump"), path.join(root, "media", "asset.bin"));
    } catch {
      t.skip("symlink creation is unavailable in this environment");
      return;
    }
    await assert.rejects(
      validateServiceSnapshotManifest(path.dirname(path.dirname(root)), {
        expectedManifestSha256: digest,
      }),
      /symlink/i,
    );
  } finally {
    rmSync(fixture.temp, { recursive: true, force: true });
  }
});

test("rejects a Windows directory junction beneath media", async (t) => {
  const fixture = makeSnapshot();
  try {
    const { digest, root } = fixture.writeManifest();
    const outside = path.join(fixture.temp, "outside-media-target");
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, "not-listed.bin"), "synthetic-external-bytes");
    const junction = path.join(root, "media", "external-target");
    try {
      symlinkSync(outside, junction, "junction");
    } catch {
      t.skip("Windows junction creation is unavailable in this environment");
      return;
    }
    await assert.rejects(
      validateServiceSnapshotManifest(path.dirname(path.dirname(root)), {
        expectedManifestSha256: digest,
      }),
      /unsafe/i,
    );
  } finally {
    rmSync(fixture.temp, { recursive: true, force: true });
  }
});
