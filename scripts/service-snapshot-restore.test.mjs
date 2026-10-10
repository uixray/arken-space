import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertIsolatedComposeConfig } from "./restore-rehearsal-core.mjs";
import {
  assertPrivateWindowsAcl,
  assertRestoreProjectVacant,
  resolveRestoreMode,
  resolveServiceSnapshot,
  serviceImageOverride,
} from "./service-snapshot-restore.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const temp = mkdtempSync(path.join(os.tmpdir(), "arken-service-restore-"));
  const root = path.join(temp, "restic-layout", "capture");
  mkdirSync(path.join(root, "media"), { recursive: true });
  mkdirSync(path.join(root, "images"), { recursive: true });
  const payloads = new Map([
    ["database.dump", "synthetic-dump"],
    ["database-counts.txt", "assets|1\n"],
    ["postgres-version.txt", "17.5\n"],
    ["migration-ledger.txt", `1|${"a".repeat(64)}|100\n`],
    ["images/server.tar", "server-image"],
    ["images/postgres.tar", "postgres-image"],
    ["images/web.tar", "web-image"],
    ["images/edge.tar", "edge-image"],
    ["media/synthetic.bin", "not-real-user-media"],
  ]);
  for (const [relative, contents] of payloads) {
    const file = path.join(root, ...relative.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  const manifest = {
    format: "arken-service-snapshot-v1",
    captureMode: "cloned-review",
    buildRevision: "a".repeat(40),
    schemaVersion: 2,
    target: {
      containerIds: ["1", "2", "3", "4"].map((id) => id.repeat(64)),
      networkId: "e".repeat(64),
      databaseName: "source_db",
      mediaSource: "/private/source/media",
      mediaContainerPath: "/srv/arken-space/media",
      edgeConfigSource: "/private/nginx.conf",
      edgeConfigContainerPath: "/etc/nginx/default.conf",
    },
    images: {
      server: "sha256:" + "1".repeat(64),
      postgres: "sha256:" + "2".repeat(64),
      web: "sha256:" + "3".repeat(64),
      edge: "sha256:" + "4".repeat(64),
    },
    files: [...payloads].map(([relative, contents]) => ({
      path: relative,
      bytes: Buffer.byteLength(contents),
      sha256: sha(contents),
    })),
  };
  const manifestPath = path.join(root, "capture-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest) + "\n");
  return {
    temp,
    root,
    digest: sha(readFileSync(manifestPath)),
  };
}

test("service-v1 requires explicit isolated mode, full snapshot ID, digest, and private report", () => {
  const snapshotId = "a".repeat(64);
  const receiptText = JSON.stringify({
    format: "arken-service-capture-receipt-v1",
    snapshotId,
    manifestSha256: "b".repeat(64),
    buildRevision: "c".repeat(40),
    schemaVersion: 2,
    imageIds: {
      server: "sha256:" + "1".repeat(64),
      postgres: "sha256:" + "2".repeat(64),
    },
  });
  const temp = mkdtempSync(path.join(os.tmpdir(), "arken-receipt-test-"));
  const receiptPath = path.join(temp, "receipt.json");
  writeFileSync(receiptPath, receiptText);
  const base = {
    ARKEN_ISOLATED_ONLY: "true",
    SNAPSHOT_ID: snapshotId,
    RESTORE_CAPTURE_RECEIPT_PATH: receiptPath,
    RESTORE_CAPTURE_RECEIPT_SHA256: sha(receiptText),
    RESTORE_REPORT_PATH: path.join(os.tmpdir(), "private-report.json"),
  };
  try {
    assert.equal(
      resolveRestoreMode({ ...base, RESTORE_FORMAT: "legacy" }).format,
      "legacy",
    );
    assert.equal(
      resolveRestoreMode({ ...base, RESTORE_FORMAT: "service-v1" }).snapshotId,
      base.SNAPSHOT_ID,
    );
    for (const [key, value] of [
      ["ARKEN_ISOLATED_ONLY", "false"],
      ["SNAPSHOT_ID", "latest"],
      ["RESTORE_CAPTURE_RECEIPT_SHA256", ""],
      ["RESTORE_REPORT_PATH", ""],
    ])
      assert.throws(() =>
        resolveRestoreMode({
          ...base,
          RESTORE_FORMAT: "service-v1",
          [key]: value,
        }),
      );
    assert.throws(() =>
      resolveRestoreMode({
        ...base,
        SNAPSHOT_ID: "c".repeat(64),
        RESTORE_FORMAT: "service-v1",
      }),
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("service-v1 resolves all database and media inputs from digest-pinned manifest", async () => {
  const sample = fixture();
  try {
    const request = {
      format: "service-v1",
      snapshotId: "c".repeat(64),
      manifestSha256: sample.digest,
      receipt: {
        buildRevision: "a".repeat(40),
        schemaVersion: 2,
        imageIds: {
          server: "sha256:" + "1".repeat(64),
          postgres: "sha256:" + "2".repeat(64),
        },
      },
    };
    const resolved = await resolveServiceSnapshot(
      path.dirname(path.dirname(sample.root)),
      request,
    );
    assert.equal(
      resolved.databaseDumpPath,
      path.join(sample.root, "database.dump"),
    );
    assert.equal(resolved.databaseCounts.assets, 1);
    assert.equal(resolved.migrationLedger.length, 1);
    assert.equal(resolved.schemaVersion, 2);
    assert.equal(resolved.buildRevision, "a".repeat(40));
    assert.equal(resolved.serverImageId, "sha256:" + "1".repeat(64));
    const compose = serviceImageOverride({
      serverImage: "arken-restore-smoke-server:service-v1",
      postgresImage: "arken-restore-smoke-postgres:service-v1",
      mediaContainerPath: resolved.mediaContainerPath,
    });
    assert.match(compose, /image: arken-restore-smoke-server:service-v1/);
    assert.match(compose, /image: arken-restore-smoke-postgres:service-v1/);
    assert.match(compose, /build: !reset null/);
  } finally {
    rmSync(sample.temp, { recursive: true, force: true });
  }
});

test("service image override rejects incompatible media mount and malformed image references", () => {
  assert.throws(() =>
    serviceImageOverride({
      serverImage: "arken-restore-smoke-server:service-v1",
      postgresImage: "arken-restore-smoke-postgres:service-v1",
      mediaContainerPath: "/app/../media",
    }),
  );
  assert.throws(() =>
    serviceImageOverride({
      serverImage: "not-an-image",
      postgresImage: "arken-restore-smoke-postgres:service-v1",
      mediaContainerPath: "/srv/arken-space/media",
    }),
  );
  const override = serviceImageOverride({
    serverImage: "arken-restore-smoke-server:service-v1",
    postgresImage: "arken-restore-smoke-postgres:service-v1",
    mediaContainerPath: "/app/media",
  });
  assert.match(override, /volumes: !override/);
  assert.match(override, /MEDIA_ROOT: \$\{RESTORE_MEDIA_CONTAINER_PATH/);
});

test("restore project collision preflight refuses every existing resource before mutation", () => {
  assert.doesNotThrow(() => assertRestoreProjectVacant({}));
  for (const kind of ["containers", "volumes", "networks", "imageTags"]) {
    let mutations = 0;
    assert.throws(() =>
      (() => {
        assertRestoreProjectVacant({ [kind]: ["synthetic-collision"] });
        mutations += 1;
      })(),
    );
    assert.equal(mutations, 0);
  }
});

test("private Windows ACL accepts only a protected current-user FullControl ACE", () => {
  const owner = {
    sid: "S-1-5-21-100-200-300-1001",
    type: "Allow",
    rights: "FullControl",
    inherited: false,
  };
  assert.doesNotThrow(() => assertPrivateWindowsAcl([owner], owner.sid, true));
  assert.throws(() => assertPrivateWindowsAcl([owner], owner.sid, false));
  for (const entries of [
    [owner, { ...owner, sid: "S-1-5-18" }],
    [{ ...owner, inherited: true }],
    [{ ...owner, type: "Deny" }],
    [{ ...owner, rights: "Read, Write" }],
    [],
  ])
    assert.throws(() => assertPrivateWindowsAcl(entries, owner.sid));
});

test("isolated compose validator accepts the captured media target and exact database name only", () => {
  const configFor = (target, databaseName) => ({
    name: "arken-restore-smoke",
    services: {
      postgres: {
        environment: {
          POSTGRES_DB: databaseName,
          POSTGRES_USER: "arken",
          POSTGRES_PASSWORD: "synthetic-only",
        },
        volumes: [
          {
            type: "volume",
            target: "/var/lib/postgresql/data",
            source: "pg-data",
          },
        ],
      },
      server: {
        environment: {
          BUILD_REVISION: "a".repeat(40),
          DATABASE_URL: `postgres://arken:synthetic-only@postgres:5432/${databaseName}`,
          MEDIA_ROOT: target,
        },
        volumes: [
          { type: "bind", source: "C:/private/synthetic/media", target },
        ],
      },
    },
  });
  for (const target of ["/app/media", "/srv/arken-space/media"])
    assert.doesNotThrow(() =>
      assertIsolatedComposeConfig(configFor(target, "source_db"), {
        projectName: "arken-restore-smoke",
        mediaSource: "C:/private/synthetic/media",
        mediaTarget: target,
        buildRevision: "a".repeat(40),
        databaseName: "source_db",
      }),
    );
  assert.throws(() =>
    assertIsolatedComposeConfig(configFor("/app/media", "other_db"), {
      projectName: "arken-restore-smoke",
      mediaSource: "C:/private/synthetic/media",
      mediaTarget: "/app/media",
      buildRevision: "a".repeat(40),
      databaseName: "source_db",
    }),
  );
});
