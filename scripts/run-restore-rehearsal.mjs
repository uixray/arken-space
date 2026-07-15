/* global AbortSignal, fetch, URL */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertIsolatedComposeConfig,
  compareDatabaseCounts,
  parseDatabaseCounts,
  resolveRestoredPath,
  validateRestoreProjectName,
} from "./restore-rehearsal-core.mjs";

const gibibyte = 1024 ** 3;
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const composeFile = path.join(projectRoot, "docker-compose.restore.yml");
const countsSqlPath = path.join(
  projectRoot,
  "infra",
  "backup",
  "database-counts.sql",
);
const reportDirectory = path.join(projectRoot, "test-results", "restore");
const productionHealthUrl =
  process.env.ARKEN_PRODUCTION_HEALTH_URL ??
  "https://arken.uixray.tech/healthz";
const isolatedOnly = process.env.ARKEN_ISOLATED_ONLY === "true";
const minimumFreeBytes = Number(
  process.env.ARKEN_RESTORE_MIN_FREE_BYTES ?? 2 * gibibyte,
);
const projectName = validateRestoreProjectName(
  process.env.ARKEN_RESTORE_PROJECT_NAME ??
    "arken-restore-" + Date.now().toString(36) + "-" + process.pid,
);
const snapshotRequest = process.env.SNAPSHOT_ID ?? "latest";
const backupHost = process.env.BACKUP_HOST ?? "arken-production";
const backupTag = process.env.BACKUP_TAG ?? "arken-space";
const backupMediaRoot =
  process.env.BACKUP_MEDIA_ROOT ??
  process.env.MEDIA_ROOT ??
  "/home/uixray/apps/arken-space-data/media";
const restorePassword =
  process.env.RESTORE_POSTGRES_PASSWORD ?? randomBytes(24).toString("hex");
const workingDirectory = mkdtempSync(
  path.join(tmpdir(), "arken-restore-data-"),
);
const snapshotRoot = path.join(workingDirectory, "snapshot");
const expectedMediaSource = resolveRestoredPath(snapshotRoot, backupMediaRoot);
const report = {
  projectName,
  startedAt: new Date().toISOString(),
  productionHealthUrl,
  isolatedOnly,
  requestedSnapshot: snapshotRequest,
  steps: [],
};
let docker = null;
let buildRevision = "unknown";
let diskPath = projectRoot;
let runSucceeded = false;
let exitCode = 1;

function record(name, status, details = {}) {
  report.steps.push({
    name,
    status,
    at: new Date().toISOString(),
    ...details,
  });
  const suffix = Object.keys(details).length
    ? " " + JSON.stringify(details)
    : "";
  process.stdout.write("[restore] " + status + " " + name + suffix + "\n");
}

function commandError(command, result) {
  const detail = result.stderr?.trim() || result.stdout?.trim() || "no output";
  return new Error(command + " failed: " + detail);
}

function execute(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
    ...options,
  });
}

function capture(command, args, options = {}) {
  const result = execute(command, args, options);
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) throw commandError(command, result);
  return result.stdout.trim();
}

function run(command, args, options = {}) {
  const result = execute(command, args, {
    stdio: "inherit",
    encoding: undefined,
    ...options,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function commandWorks(command, args) {
  const result = execute(command, args, { stdio: "ignore" });
  return !result.error && (result.status ?? 1) === 0;
}

function detectDocker() {
  if (commandWorks("docker", ["info"]))
    return { command: "docker", prefix: [] };
  if (commandWorks("sudo", ["-n", "docker", "info"]))
    return { command: "sudo", prefix: ["-n", "docker"] };
  throw new Error(
    "Docker is unavailable without an interactive privilege prompt",
  );
}

function dockerArgs(args) {
  if (!docker) throw new Error("Docker was not initialized");
  return [...docker.prefix, ...args];
}

function captureDocker(args, options = {}) {
  return capture(docker.command, dockerArgs(args), options);
}

function runDocker(args, options = {}) {
  return run(docker.command, dockerArgs(args), options);
}

function freeBytes(location) {
  const disk = statfsSync(location);
  return Number(disk.bavail) * Number(disk.bsize);
}

async function fetchJson(url, timeoutMs = 15_000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(url + " returned " + response.status);
  return response.json();
}

function resolveBuildRevision() {
  const configured = process.env.RESTORE_BUILD_REVISION?.trim();
  if (configured) return configured;
  const result = execute("git", ["rev-parse", "HEAD"]);
  if (!result.error && (result.status ?? 1) === 0) return result.stdout.trim();
  throw new Error(
    "RESTORE_BUILD_REVISION is required when running from a Git archive",
  );
}

function composeBase() {
  return [
    "compose",
    "--project-name",
    projectName,
    "--project-directory",
    projectRoot,
    "--file",
    composeFile,
  ];
}

function composeEnvironment() {
  return {
    ...process.env,
    RESTORE_POSTGRES_PASSWORD: restorePassword,
    RESTORE_BUILD_REVISION: buildRevision,
    RESTORE_MEDIA_HOST_PATH: expectedMediaSource,
  };
}

function findDumpFiles(directory) {
  const matches = [];
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (/^arken-\d{8}T\d{6}Z\.dump$/.test(entry.name))
        matches.push(target);
    }
  }
  visit(directory);
  return matches.sort();
}

function countFiles(directory) {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += countFiles(target);
    else if (entry.isFile()) total += 1;
  }
  return total;
}

function assertManifestFiles(dumpFile) {
  const prefix = dumpFile.slice(0, -".dump".length);
  const files = {
    dumpChecksum: dumpFile + ".sha256",
    databaseCounts: prefix + ".database-counts.txt",
    mediaChecksums: prefix + ".media-sha256.txt",
  };
  for (const [name, file] of Object.entries(files)) {
    if (!existsSync(file))
      throw new Error("Backup snapshot is missing " + name + " manifest");
  }
  return files;
}

function verifyChecksums(dumpFile, manifests, restoredMedia) {
  capture("sha256sum", ["--check", path.basename(manifests.dumpChecksum)], {
    cwd: path.dirname(dumpFile),
  });
  record("database-dump-checksum", "passed");

  const mediaManifest = readFileSync(manifests.mediaChecksums, "utf8");
  if (mediaManifest.trim())
    capture("sha256sum", ["--check", manifests.mediaChecksums], {
      cwd: restoredMedia,
    });
  else if (countFiles(restoredMedia) !== 0)
    throw new Error("Media manifest is empty but restored media has files");
  record("media-checksums", "passed", {
    files: countFiles(restoredMedia),
  });
}

function restoreDatabase(dumpFile) {
  const descriptor = openSync(dumpFile, "r");
  try {
    const status = runDocker(
      [
        ...composeBase(),
        "exec",
        "-T",
        "postgres",
        "pg_restore",
        "--exit-on-error",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--username",
        "arken",
        "--dbname",
        "arken",
      ],
      {
        env: composeEnvironment(),
        stdio: [descriptor, "inherit", "inherit"],
      },
    );
    if (status !== 0) throw new Error("pg_restore exited " + status);
  } finally {
    closeSync(descriptor);
  }
}

function readRestoredCounts() {
  const query = readFileSync(countsSqlPath, "utf8");
  const output = captureDocker(
    [
      ...composeBase(),
      "exec",
      "-T",
      "postgres",
      "psql",
      "--username",
      "arken",
      "--dbname",
      "arken",
      "--no-align",
      "--tuples-only",
      "--field-separator=|",
    ],
    {
      env: composeEnvironment(),
      input: query,
    },
  );
  return parseDatabaseCounts(output);
}

function inspectLeftovers() {
  const containers = captureDocker([
    "ps",
    "--all",
    "--quiet",
    "--filter",
    "label=com.docker.compose.project=" + projectName,
  ]);
  const volumes = captureDocker([
    "volume",
    "ls",
    "--quiet",
    "--filter",
    "label=com.docker.compose.project=" + projectName,
  ]);
  return {
    containers: containers ? containers.split(/\s+/) : [],
    volumes: volumes ? volumes.split(/\s+/) : [],
  };
}

function removeWorkingDirectory() {
  const resolved = path.resolve(workingDirectory);
  const allowedPrefix =
    path.resolve(tmpdir()) + path.sep + "arken-restore-data-";
  if (!resolved.startsWith(allowedPrefix))
    throw new Error("Refusing to remove unexpected restore working directory");
  rmSync(resolved, { recursive: true, force: true });
}

function writeReport() {
  report.finishedAt = new Date().toISOString();
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(
    path.join(reportDirectory, "runner.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}

try {
  if (process.env.ARKEN_RESTORE_CONFIRM !== "isolated-clean-target")
    throw new Error(
      "Refusing restore without ARKEN_RESTORE_CONFIRM=isolated-clean-target",
    );
  if (!process.env.RESTIC_REPOSITORY)
    throw new Error("RESTIC_REPOSITORY is required");
  if (!process.env.RESTIC_PASSWORD && !process.env.RESTIC_PASSWORD_FILE)
    throw new Error("RESTIC_PASSWORD or RESTIC_PASSWORD_FILE is required");
  if (!Number.isFinite(minimumFreeBytes) || minimumFreeBytes < gibibyte)
    throw new Error("ARKEN_RESTORE_MIN_FREE_BYTES must be at least 1 GiB");

  buildRevision = resolveBuildRevision();
  docker = detectDocker();
  record("docker-permission", "passed");
  record("restic-version", "passed", {
    version: capture("restic", ["version"]),
  });
  capture("sha256sum", ["--version"]);

  const dockerRoot = captureDocker(["info", "--format", "{{.DockerRootDir}}"]);
  try {
    diskPath = dockerRoot;
    report.diskBefore = { path: diskPath, freeBytes: freeBytes(diskPath) };
  } catch {
    diskPath = projectRoot;
    report.diskBefore = { path: diskPath, freeBytes: freeBytes(diskPath) };
  }
  if (report.diskBefore.freeBytes < minimumFreeBytes)
    throw new Error(
      "LOW_DISK_SPACE: " +
        report.diskBefore.freeBytes +
        " bytes free; " +
        minimumFreeBytes +
        " required",
    );
  record("disk-threshold", "passed", {
    freeGiB: Number((report.diskBefore.freeBytes / gibibyte).toFixed(2)),
    minimumGiB: Number((minimumFreeBytes / gibibyte).toFixed(2)),
  });

  if (isolatedOnly)
    record("production-health-before", "skipped", { reason: "isolated-only" });
  else {
    const productionBefore = await fetchJson(productionHealthUrl);
    if (productionBefore.status !== "ok" || productionBefore.database !== "ok")
      throw new Error("Production health preflight is not healthy");
    report.productionBefore = productionBefore;
    record("production-health-before", "passed", {
      buildRevision: productionBefore.buildRevision,
      schemaVersion: productionBefore.schemaVersion,
    });
  }

  const environment = composeEnvironment();
  const config = JSON.parse(
    captureDocker([...composeBase(), "config", "--format", "json"], {
      env: environment,
    }),
  );
  assertIsolatedComposeConfig(config, {
    projectName,
    mediaSource: expectedMediaSource,
    buildRevision,
  });
  record("isolated-compose-config", "passed");

  capture("restic", ["check"]);
  record("restic-check", "passed");

  const snapshots = JSON.parse(
    capture("restic", [
      "snapshots",
      "--json",
      "--latest",
      "1",
      "--host",
      backupHost,
      "--tag",
      backupTag,
    ]),
  );
  if (!Array.isArray(snapshots) || snapshots.length !== 1)
    throw new Error("Exactly one latest arken-space snapshot was expected");
  const selectedSnapshot =
    snapshotRequest === "latest"
      ? snapshots[0]
      : { id: snapshotRequest, short_id: snapshotRequest };
  report.snapshot = {
    id: selectedSnapshot.id,
    shortId: selectedSnapshot.short_id,
    time: selectedSnapshot.time,
  };
  record("snapshot-selected", "passed", {
    shortId: selectedSnapshot.short_id,
    time: selectedSnapshot.time,
  });

  mkdirSync(snapshotRoot, { recursive: true });
  const restoreStatus = run(
    "restic",
    [
      "restore",
      selectedSnapshot.id,
      "--host",
      backupHost,
      "--tag",
      backupTag,
      "--target",
      snapshotRoot,
    ],
    { env: process.env },
  );
  if (restoreStatus !== 0)
    throw new Error("restic restore exited " + restoreStatus);
  record("restic-restore", "passed");

  const dumps = findDumpFiles(snapshotRoot);
  if (dumps.length !== 1)
    throw new Error(
      "Expected one PostgreSQL dump in snapshot, found " + dumps.length,
    );
  if (!existsSync(expectedMediaSource))
    throw new Error("Restored media directory was not found");
  const manifests = assertManifestFiles(dumps[0]);
  verifyChecksums(dumps[0], manifests, expectedMediaSource);

  const postgresUp = runDocker(
    [...composeBase(), "up", "--detach", "--wait", "postgres"],
    { env: environment },
  );
  if (postgresUp !== 0)
    throw new Error("Isolated PostgreSQL startup exited " + postgresUp);
  record("isolated-postgres", "passed");

  restoreDatabase(dumps[0]);
  record("postgresql-restore", "passed");

  const expectedCounts = parseDatabaseCounts(
    readFileSync(manifests.databaseCounts, "utf8"),
  );
  const restoredCounts = readRestoredCounts();
  compareDatabaseCounts(expectedCounts, restoredCounts);
  report.databaseCounts = restoredCounts;
  record("database-counts", "passed", restoredCounts);

  const serverUp = runDocker(
    [...composeBase(), "up", "--detach", "--build", "--wait", "server"],
    { env: environment },
  );
  if (serverUp !== 0)
    throw new Error("Isolated server startup exited " + serverUp);
  record("isolated-server", "passed");

  const healthScript =
    "fetch('http://127.0.0.1:4100/healthz')" +
    ".then(async r=>{const body=await r.text();" +
    "if(!r.ok){process.stderr.write(body);process.exit(1)}" +
    "process.stdout.write(body)})" +
    ".catch(e=>{process.stderr.write(String(e));process.exit(1)})";
  const restoredHealth = JSON.parse(
    captureDocker(
      [...composeBase(), "exec", "-T", "server", "node", "-e", healthScript],
      { env: environment },
    ),
  );
  if (
    restoredHealth.status !== "ok" ||
    restoredHealth.database !== "ok" ||
    restoredHealth.buildRevision !== buildRevision ||
    restoredHealth.schemaVersion !== 2
  )
    throw new Error("Restored application health is not authoritative");
  report.restoredHealth = restoredHealth;
  record("restored-application-health", "passed", {
    buildRevision: restoredHealth.buildRevision,
    schemaVersion: restoredHealth.schemaVersion,
  });

  runSucceeded = true;
  exitCode = 0;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  record("run", "failed", { error: report.error });
} finally {
  if (docker) {
    const cleanup = runDocker(
      [
        ...composeBase(),
        "down",
        "--volumes",
        "--remove-orphans",
        "--rmi",
        "local",
      ],
      { env: composeEnvironment() },
    );
    report.cleanupExitCode = cleanup;
    if (cleanup !== 0) exitCode = cleanup;
    else record("compose-cleanup", "passed");

    try {
      const remaining = inspectLeftovers();
      report.leftovers = remaining;
      if (remaining.containers.length || remaining.volumes.length) {
        exitCode = 1;
        record("resource-leak-check", "failed", remaining);
      } else record("resource-leak-check", "passed");
    } catch (error) {
      exitCode = 1;
      record("resource-leak-check", "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    removeWorkingDirectory();
    record("restored-data-cleanup", "passed");
  } catch (error) {
    exitCode = 1;
    record("restored-data-cleanup", "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if (isolatedOnly) {
      record("production-health-after", "skipped", {
        reason: "isolated-only",
      });
    } else {
      const productionAfter = await fetchJson(productionHealthUrl);
      report.productionAfter = productionAfter;
      if (
        productionAfter.status !== "ok" ||
        productionAfter.database !== "ok"
      ) {
        exitCode = 1;
        record("production-health-after", "failed", productionAfter);
      } else
        record("production-health-after", "passed", {
          buildRevision: productionAfter.buildRevision,
          schemaVersion: productionAfter.schemaVersion,
        });
    }
  } catch (error) {
    exitCode = 1;
    record("production-health-after", "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const available = freeBytes(diskPath);
    report.diskAfter = { path: diskPath, freeBytes: available };
    record("disk-after", "passed", {
      freeGiB: Number((available / gibibyte).toFixed(2)),
    });
  } catch (error) {
    exitCode = 1;
    record("disk-after", "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  report.runSucceeded = runSucceeded;
  writeReport();
}

process.exitCode = exitCode;
