/* global AbortSignal, fetch, URL */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { platform } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertIsolatedComposeConfig,
  buildDatabaseCountsQuery,
  compareDatabaseCounts,
  compareMigrationLedger,
  compareMigrationLedgerPrefix,
  describeDatabaseCountCoverage,
  parseDatabaseCounts,
  parseMigrationLedger,
  readExpectedMigrationLedger,
  isTransientPostgresStartupError,
  resolvePostgresReadinessPolicy,
  resolveRestoredPath,
  selectResticSnapshot,
  stripRetiredCounts,
  stripSupersedingOnlyCounts,
  verifyRetiredTableMigration,
  validateRestoreProjectName,
} from "./restore-rehearsal-core.mjs";
import {
  assertPrivateWindowsAcl,
  assertRestoreProjectVacant,
  resolveRestoreMode,
  resolveServiceSnapshot,
  serviceImageOverride,
} from "./service-snapshot-restore.mjs";

const gibibyte = 1024 ** 3;
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const composeFile = path.join(projectRoot, "docker-compose.restore.yml");
const reportDirectory = path.join(projectRoot, "test-results", "restore");
const migrationsDirectory = path.join(projectRoot, "packages", "db", "drizzle");
function readCheckoutMigrationLedger() {
  return readExpectedMigrationLedger({
    journalPath: path.join(migrationsDirectory, "meta", "_journal.json"),
    migrationsDirectory,
  });
}
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
const restoreFormat = process.env.RESTORE_FORMAT ?? "legacy";
const snapshotRequest = process.env.SNAPSHOT_ID ?? "latest";
const backupHost =
  process.env.BACKUP_HOST ??
  (restoreFormat === "service-v1" ? "arken-space-service" : "arken-production");
const backupTag = process.env.BACKUP_TAG ?? "arken-space";
const backupMediaRoot =
  process.env.BACKUP_MEDIA_ROOT ??
  process.env.MEDIA_ROOT ??
  "/home/uixray/apps/arken-space-data/media";
const restorePassword =
  process.env.RESTORE_POSTGRES_PASSWORD ?? randomBytes(24).toString("hex");
const postgresReadinessPolicy = resolvePostgresReadinessPolicy(process.env);
let workingDirectory = null;
let snapshotRoot = null;
let expectedMediaSource = null;
let serviceComposeOverride = null;
let serviceSnapshot = null;
let migrationLedgerExpected = null;
let privateReportPath = null;
let privateReportDirectory = null;
const newlyLoadedCapturedImages = [];
const capturedImageTags = [];
const report = {
  projectName,
  startedAt: new Date().toISOString(),
  restoreFormat,
  ...(restoreFormat === "legacy" ? { productionHealthUrl } : {}),
  isolatedOnly,
  requestedSnapshot: snapshotRequest,
  steps: [],
};
let docker = null;
let buildRevision = "unknown";
let diskPath = projectRoot;
let runSucceeded = false;
let exitCode = 1;
let projectMayHaveResources = false;

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

function currentWindowsSid() {
  const identity = capture("whoami", ["/user", "/fo", "csv", "/nh"]);
  const match = identity.match(/S-1-[0-9-]+/i);
  if (!match) throw new Error("Could not resolve current Windows user SID");
  return match[0];
}

function verifyWindowsAcl(target) {
  const script =
    "$p=$env:ARKEN_ACL_PATH; $a=Get-Acl -LiteralPath $p; " +
    "$r=@($a.Access | ForEach-Object { [pscustomobject]@{ " +
    "sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; " +
    "type=$_.AccessControlType.ToString(); rights=$_.FileSystemRights.ToString(); " +
    "inherited=$_.IsInherited } }); " +
    "[pscustomobject]@{ protected=$a.AreAccessRulesProtected; entries=$r } | ConvertTo-Json -Compress";
  const result = execute(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { env: { ...process.env, ARKEN_ACL_PATH: target } },
  );
  if (result.error || (result.status ?? 1) !== 0)
    throw new Error("Could not inspect protected restore ACL");
  let entries;
  try {
    const acl = JSON.parse(result.stdout || "null");
    entries = Array.isArray(acl?.entries) ? acl.entries : [acl?.entries];
    assertPrivateWindowsAcl(
      entries,
      currentWindowsSid(),
      acl?.protected === true,
    );
  } catch {
    throw new Error(
      "Protected restore ACL is invalid or allows inherited access",
    );
  }
}

function protectPath(target, { directory }) {
  if (platform() === "win32") {
    const sid = currentWindowsSid();
    const grant = directory ? "(OI)(CI)F" : "F";
    const reset = execute("icacls", [target, "/reset"], { stdio: "ignore" });
    if (reset.error || (reset.status ?? 1) !== 0)
      throw new Error("Could not reset restore path ACL safely");
    const inheritance = execute("icacls", [target, "/inheritance:r"], {
      stdio: "ignore",
    });
    if (inheritance.error || (inheritance.status ?? 1) !== 0)
      throw new Error("Could not disable restore path ACL inheritance");
    const grantResult = execute(
      "icacls",
      [target, "/grant:r", `*${sid}:${grant}`],
      { stdio: "ignore" },
    );
    if (grantResult.error || (grantResult.status ?? 1) !== 0)
      throw new Error("Could not apply protected restore path ACL");
    verifyWindowsAcl(target);
    return;
  }

  chmodSync(target, directory ? 0o700 : 0o600);
  const mode = statSync(target).mode & 0o777;
  const forbidden = directory ? 0o077 : 0o177;
  if (mode & forbidden)
    throw new Error("Restore path permissions are not private");
}

function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}

function createProtectedWorkingDirectory() {
  const privateRoot = realpathSync(
    path.resolve(projectRoot, ".data", "qa-prep"),
  );
  const directory = mkdtempSync(path.join(privateRoot, "restore-run-"));
  try {
    protectPath(directory, { directory: true });
    if (!isPathWithin(privateRoot, realpathSync(directory)))
      throw new Error("Restore staging path escaped private workspace root");
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function prepareProtectedReportDirectory(reportPath, privateRoot) {
  const reportParent = path.dirname(reportPath);
  if (
    path.dirname(reportParent) !== privateRoot ||
    !isPathWithin(privateRoot, reportParent) ||
    existsSync(reportParent)
  )
    throw new Error(
      "Private report directory must be a new path inside .data/qa-prep",
    );
  mkdirSync(reportParent);
  try {
    protectPath(reportParent, { directory: true });
    if (!isPathWithin(privateRoot, realpathSync(reportParent)))
      throw new Error("Private report directory escaped .data/qa-prep");
  } catch (error) {
    rmdirSync(reportParent);
    throw error;
  }
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

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForPostgresReady() {
  const deadline = Date.now() + postgresReadinessPolicy.timeoutMs;
  let consecutiveSuccesses = 0;
  let attempts = 0;
  let lastError = "no readiness probe completed";
  while (Date.now() < deadline) {
    attempts += 1;
    const probe = execute(
      docker.command,
      dockerArgs([
        ...composeBase(),
        "exec",
        "-T",
        "postgres",
        "psql",
        "--username",
        "arken",
        "--dbname",
        serviceSnapshot?.databaseName ?? "arken",
        "--no-align",
        "--tuples-only",
        "--command",
        "SELECT 1;",
      ]),
      { env: composeEnvironment() },
    );
    if (
      !probe.error &&
      (probe.status ?? 1) === 0 &&
      probe.stdout.trim() === "1"
    ) {
      consecutiveSuccesses += 1;
      if (consecutiveSuccesses >= 2) return { attempts };
    } else {
      consecutiveSuccesses = 0;
      lastError =
        probe.error?.message ||
        probe.stderr?.trim() ||
        probe.stdout?.trim() ||
        "readiness probe exited " + probe.status;
    }
    sleep(postgresReadinessPolicy.retryDelayMs);
  }
  throw new Error(
    "Isolated PostgreSQL did not become stably ready within " +
      postgresReadinessPolicy.timeoutMs +
      "ms: " +
      lastError,
  );
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
  const args = [
    "compose",
    "--project-name",
    projectName,
    "--project-directory",
    projectRoot,
    "--file",
    composeFile,
  ];
  if (serviceComposeOverride) args.push("--file", serviceComposeOverride);
  return args;
}

function composeEnvironment() {
  const databaseName = serviceSnapshot?.databaseName ?? "arken";
  const mediaTarget =
    serviceSnapshot?.mediaContainerPath ?? "/srv/arken-space/media";
  return {
    ...process.env,
    RESTORE_POSTGRES_PASSWORD: restorePassword,
    RESTORE_BUILD_REVISION: buildRevision,
    RESTORE_MEDIA_HOST_PATH: expectedMediaSource,
    RESTORE_MEDIA_CONTAINER_PATH: mediaTarget,
    RESTORE_DATABASE_NAME: databaseName,
    RESTORE_DATABASE_URL:
      `postgres://arken:${encodeURIComponent(restorePassword)}` +
      `@postgres:5432/${encodeURIComponent(databaseName)}`,
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

function restoreDatabase(dumpFile, databaseName) {
  for (
    let attempt = 1;
    attempt <= postgresReadinessPolicy.restoreAttempts;
    attempt += 1
  ) {
    const descriptor = openSync(dumpFile, "r");
    let result;
    try {
      result = execute(
        docker.command,
        dockerArgs([
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
          databaseName,
        ]),
        { env: composeEnvironment(), stdio: [descriptor, "pipe", "pipe"] },
      );
    } finally {
      closeSync(descriptor);
    }
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if ((result.status ?? 1) === 0) return { attempts: attempt };
    const output = (result.stderr ?? "") + "\n" + (result.stdout ?? "");
    if (
      attempt >= postgresReadinessPolicy.restoreAttempts ||
      !isTransientPostgresStartupError(output)
    )
      throw commandError("pg_restore", result);
    record("postgresql-restore-retry", "waiting", {
      attempt,
      reason: "database-starting-up",
    });
    sleep(postgresReadinessPolicy.retryDelayMs);
    waitForPostgresReady();
  }
}

function readRestoredCounts(expectedCounts, databaseName) {
  const query = buildDatabaseCountsQuery(expectedCounts);
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
      databaseName,
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

function readRestoredMigrationLedger(databaseName) {
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
      databaseName,
      "--no-align",
      "--tuples-only",
      "--field-separator=|",
    ],
    {
      env: composeEnvironment(),
      input:
        'SELECT id::bigint, hash, created_at::bigint FROM drizzle."__drizzle_migrations" ORDER BY created_at, id;\n',
    },
  );
  return parseMigrationLedger(output);
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
  const networks = captureDocker([
    "network",
    "ls",
    "--quiet",
    "--filter",
    "label=com.docker.compose.project=" + projectName,
  ]);
  return {
    containers: containers ? containers.split(/\s+/) : [],
    volumes: volumes ? volumes.split(/\s+/) : [],
    networks: networks ? networks.split(/\s+/) : [],
  };
}

function assertProjectVacant() {
  assertRestoreProjectVacant(inspectLeftovers());
}

function removeWorkingDirectory() {
  if (!workingDirectory) return;
  const resolved = path.resolve(workingDirectory);
  const privateRoot = realpathSync(
    path.resolve(projectRoot, ".data", "qa-prep"),
  );
  const stat = lstatSync(resolved);
  if (
    !isPathWithin(privateRoot, realpathSync(resolved)) ||
    !stat.isDirectory() ||
    stat.isSymbolicLink()
  )
    throw new Error("Refusing to remove unexpected restore working directory");
  rmSync(resolved, { recursive: true, force: true });
}

function writeReport() {
  report.finishedAt = new Date().toISOString();
  const destination =
    privateReportPath ?? path.join(reportDirectory, "runner.json");
  if (!privateReportPath)
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  writeFileSync(destination, JSON.stringify(report, null, 2) + "\n", {
    mode: privateReportPath ? 0o600 : 0o644,
  });
}

try {
  let privateRoot = null;
  if (restoreFormat === "service-v1") {
    privateRoot = realpathSync(path.resolve(projectRoot, ".data", "qa-prep"));
    const requestedReceiptPath = path.resolve(
      process.env.RESTORE_CAPTURE_RECEIPT_PATH ?? "",
    );
    const requestedReportPath = path.resolve(
      process.env.RESTORE_REPORT_PATH ?? "",
    );
    if (
      !/^[0-9a-f]{64}$/i.test(process.env.SNAPSHOT_ID ?? "") ||
      !/^[0-9a-f]{64}$/i.test(
        process.env.RESTORE_CAPTURE_RECEIPT_SHA256 ?? "",
      ) ||
      !process.env.RESTORE_REPORT_PATH
    )
      throw new Error(
        "service-v1 requires a full snapshot ID, receipt digest, and report path",
      );
    if (!isPathWithin(privateRoot, requestedReceiptPath))
      throw new Error(
        "service-v1 capture receipt must be inside ignored .data/qa-prep",
      );
    if (!isPathWithin(privateRoot, realpathSync(requestedReceiptPath)))
      throw new Error(
        "service-v1 capture receipt resolves outside .data/qa-prep",
      );
    const receiptStat = lstatSync(requestedReceiptPath);
    if (!receiptStat.isFile() || receiptStat.isSymbolicLink())
      throw new Error(
        "service-v1 capture receipt must be a regular private file",
      );
    if (platform() === "win32") verifyWindowsAcl(requestedReceiptPath);
    else {
      const receiptMode = statSync(requestedReceiptPath).mode & 0o777;
      if (receiptMode & 0o177)
        throw new Error("service-v1 capture receipt is not private");
    }
    const requestedReportDirectory = path.dirname(requestedReportPath);
    if (
      !isPathWithin(privateRoot, requestedReportDirectory) ||
      existsSync(requestedReportDirectory) ||
      existsSync(requestedReportPath) ||
      requestedReportPath === requestedReceiptPath
    )
      throw new Error(
        "service-v1 report must use a new private directory in .data/qa-prep",
      );
    prepareProtectedReportDirectory(requestedReportPath, privateRoot);
    privateReportDirectory = requestedReportDirectory;
  }
  if (process.env.RESTORE_COPY_RECEIPT_PATH) {
    const mappingPath = path.resolve(process.env.RESTORE_COPY_RECEIPT_PATH);
    if (
      !isPathWithin(privateRoot, mappingPath) ||
      !isPathWithin(privateRoot, realpathSync(mappingPath)) ||
      !lstatSync(mappingPath).isFile() ||
      lstatSync(mappingPath).isSymbolicLink()
    )
      throw new Error(
        "Copy mapping receipt must be a regular private file inside .data/qa-prep",
      );
    if (platform() === "win32") verifyWindowsAcl(mappingPath);
    else if (statSync(mappingPath).mode & 0o177)
      throw new Error("Copy mapping receipt is not private");
  }
  const restoreRequest = resolveRestoreMode(process.env);
  if (restoreRequest.format === "service-v1") {
    const receiptRealPath = realpathSync(restoreRequest.receiptPath);
    const reportParent = realpathSync(path.dirname(restoreRequest.reportPath));
    if (
      !isPathWithin(privateRoot, receiptRealPath) ||
      !isPathWithin(privateRoot, reportParent) ||
      restoreRequest.reportPath === restoreRequest.receiptPath ||
      existsSync(restoreRequest.reportPath) ||
      !lstatSync(restoreRequest.receiptPath).isFile()
    )
      throw new Error(
        "service-v1 receipt and report must be inside ignored .data/qa-prep",
      );
    privateReportPath = restoreRequest.reportPath;
    report.snapshotIdRequired = restoreRequest.snapshotId;
    report.captureManifestSha256 = restoreRequest.manifestSha256;
    report.captureReceiptSha256 = restoreRequest.receiptSha256;
    report.sourceSnapshotId = restoreRequest.sourceSnapshotId;
    report.copyReceiptSha256 = restoreRequest.copyReceiptSha256;
    report.recoveryMode =
      "captured server and PostgreSQL images; no source-build equivalence claim";
  }
  workingDirectory = createProtectedWorkingDirectory();
  snapshotRoot = path.join(workingDirectory, "snapshot");
  expectedMediaSource = resolveRestoredPath(snapshotRoot, backupMediaRoot);
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

  if (restoreRequest.format === "legacy") {
    buildRevision = resolveBuildRevision();
    migrationLedgerExpected = readCheckoutMigrationLedger();
  } else {
    buildRevision = "captured-image-pending-manifest-validation";
  }
  docker = detectDocker();
  record("docker-permission", "passed");
  assertProjectVacant();
  record("restore-project-collision-preflight", "passed");
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

  let environment = composeEnvironment();

  capture("restic", ["check"]);
  record("restic-check", "passed");

  const snapshotArguments = [
    "snapshots",
    "--json",
    "--host",
    backupHost,
    "--tag",
    backupTag,
  ];
  if (snapshotRequest !== "latest") snapshotArguments.push(snapshotRequest);
  const snapshots = JSON.parse(capture("restic", snapshotArguments));
  const selectedSnapshot = selectResticSnapshot(snapshots, {
    request: snapshotRequest,
    expectedHost: backupHost,
    expectedTag: backupTag,
  });
  if (
    restoreRequest.format === "service-v1" &&
    selectedSnapshot.id.toLowerCase() !== restoreRequest.snapshotId
  )
    throw new Error(
      "Selected Restic snapshot ID does not exactly match request",
    );
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

  let dumpFile;
  let manifests = null;
  let expectedCounts;
  if (restoreRequest.format === "service-v1") {
    serviceSnapshot = await resolveServiceSnapshot(
      snapshotRoot,
      restoreRequest,
    );
    dumpFile = serviceSnapshot.databaseDumpPath;
    expectedMediaSource = serviceSnapshot.mediaRootPath;
    migrationLedgerExpected = serviceSnapshot.migrationLedger;
    expectedCounts = serviceSnapshot.databaseCounts;
    const capturedTags = {
      postgres: `arken-restore-${projectName}-postgres:service-v1`,
      server: `arken-restore-${projectName}-server:service-v1`,
    };
    serviceComposeOverride = path.join(
      workingDirectory,
      "compose.service-v1.override.yml",
    );
    writeFileSync(
      serviceComposeOverride,
      serviceImageOverride({
        postgresImage: capturedTags.postgres,
        serverImage: capturedTags.server,
        mediaContainerPath: serviceSnapshot.mediaContainerPath,
      }),
      { mode: 0o600 },
    );
    for (const [kind, file, expectedId, localTag] of [
      [
        "postgres",
        path.join(serviceSnapshot.captureRoot, "images", "postgres.tar"),
        serviceSnapshot.postgresImageId,
        capturedTags.postgres,
      ],
      [
        "server",
        path.join(serviceSnapshot.captureRoot, "images", "server.tar"),
        serviceSnapshot.serverImageId,
        capturedTags.server,
      ],
    ]) {
      const tagExists = execute(
        docker.command,
        dockerArgs(["image", "inspect", localTag]),
        { stdio: "ignore" },
      );
      if (!tagExists.error && (tagExists.status ?? 1) === 0)
        throw new Error("Isolated captured-image tag is already in use");
      const existedBefore = execute(
        docker.command,
        dockerArgs(["image", "inspect", expectedId]),
        { stdio: "ignore" },
      );
      if (existedBefore.error || (existedBefore.status ?? 1) !== 0)
        newlyLoadedCapturedImages.push(expectedId);
      captureDocker(["load", "--input", file]);
      const loadedId = captureDocker([
        "image",
        "inspect",
        "--format",
        "{{.Id}}",
        expectedId,
      ]);
      if (loadedId.toLowerCase() !== expectedId.toLowerCase())
        throw new Error(
          "Loaded captured " + kind + " image ID does not match manifest",
        );
      captureDocker(["image", "tag", expectedId, localTag]);
      capturedImageTags.push(localTag);
      const taggedId = captureDocker([
        "image",
        "inspect",
        "--format",
        "{{.Id}}",
        localTag,
      ]);
      if (taggedId.toLowerCase() !== expectedId.toLowerCase())
        throw new Error(
          "Isolated " + kind + " tag does not resolve to captured image ID",
        );
    }
    buildRevision = serviceSnapshot.buildRevision;
    environment = composeEnvironment();
    record("service-v1-capture-manifest", "passed", {
      manifestSha256: serviceSnapshot.manifestSha256,
      fileCount: serviceSnapshot.files,
      capturedSchemaVersion: serviceSnapshot.schemaVersion,
      capturedMigrationCount: migrationLedgerExpected.length,
      imagePinning:
        "server-and-postgres image IDs verified through isolated local tags; source build disabled",
    });
  } else {
    const dumps = findDumpFiles(snapshotRoot);
    if (dumps.length !== 1)
      throw new Error(
        "Expected one PostgreSQL dump in snapshot, found " + dumps.length,
      );
    dumpFile = dumps[0];
    manifests = assertManifestFiles(dumpFile);
    expectedCounts = parseDatabaseCounts(
      readFileSync(manifests.databaseCounts, "utf8"),
    );
  }
  if (!existsSync(expectedMediaSource))
    throw new Error("Restored media directory was not found");
  if (restoreRequest.format === "legacy")
    verifyChecksums(dumpFile, manifests, expectedMediaSource);

  const config = JSON.parse(
    captureDocker([...composeBase(), "config", "--format", "json"], {
      env: composeEnvironment(),
    }),
  );
  assertIsolatedComposeConfig(config, {
    projectName,
    mediaSource: expectedMediaSource,
    buildRevision,
    mediaTarget:
      serviceSnapshot?.mediaContainerPath ?? "/srv/arken-space/media",
    databaseName: serviceSnapshot?.databaseName ?? "arken",
  });
  if (
    serviceSnapshot &&
    (config.services?.server?.build ||
      config.services?.server?.image !==
        `arken-restore-${projectName}-server:service-v1` ||
      config.services?.postgres?.image !==
        `arken-restore-${projectName}-postgres:service-v1`)
  )
    throw new Error(
      "Isolated compose did not resolve to the captured server and PostgreSQL images",
    );
  record("isolated-compose-config", "passed");

  assertProjectVacant();
  projectMayHaveResources = true;
  const postgresUp = runDocker(
    [...composeBase(), "up", "--detach", "--wait", "postgres"],
    { env: environment },
  );
  if (postgresUp !== 0)
    throw new Error("Isolated PostgreSQL startup exited " + postgresUp);
  const postgresReady = waitForPostgresReady();
  record("isolated-postgres", "passed", {
    stableReadinessProbes: 2,
    attempts: postgresReady.attempts,
  });

  const restoredDatabaseName = serviceSnapshot?.databaseName ?? "arken";
  const restoreResult = restoreDatabase(dumpFile, restoredDatabaseName);
  record("postgresql-restore", "passed", { attempts: restoreResult.attempts });

  const restoredMigrationPrefix =
    readRestoredMigrationLedger(restoredDatabaseName);
  compareMigrationLedgerPrefix(
    migrationLedgerExpected,
    restoredMigrationPrefix,
  );
  report.databaseMigrationPrefix = restoredMigrationPrefix;
  record("database-migration-prefix", "passed", {
    restoredCount: restoredMigrationPrefix.length,
    comparisonReferenceCount: migrationLedgerExpected.length,
  });

  const restoredCounts = readRestoredCounts(
    expectedCounts,
    restoredDatabaseName,
  );
  const retiredTableMigration = verifyRetiredTableMigration(
    expectedCounts,
    restoredCounts,
  );
  report.retiredTableMigration = retiredTableMigration;
  if (retiredTableMigration.length)
    record("retired-table-migration", "passed", {
      checked: retiredTableMigration,
    });

  compareDatabaseCounts(
    stripRetiredCounts(expectedCounts),
    stripSupersedingOnlyCounts(expectedCounts, restoredCounts),
  );
  report.databaseCounts = restoredCounts;
  report.databaseCountCoverage = describeDatabaseCountCoverage(restoredCounts);
  record("database-counts", "passed", report.databaseCountCoverage);

  const serverUp = runDocker(
    [
      ...composeBase(),
      "up",
      "--detach",
      ...(serviceSnapshot ? [] : ["--build"]),
      "--wait",
      "server",
    ],
    { env: composeEnvironment() },
  );
  if (serverUp !== 0)
    throw new Error("Isolated server startup exited " + serverUp);
  record("isolated-server", "passed");

  const migratedLedger = readRestoredMigrationLedger(restoredDatabaseName);
  compareMigrationLedger(migrationLedgerExpected, migratedLedger);
  report.databaseMigrations = migrationLedgerExpected.map((entry, index) => ({
    ...entry,
    databaseId: migratedLedger[index].id,
  }));
  record("database-migration-ledger", "passed", {
    count: report.databaseMigrations.length,
    first: report.databaseMigrations[0].tag,
    last: report.databaseMigrations.at(-1).tag,
  });

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
    restoredHealth.schemaVersion !== (serviceSnapshot?.schemaVersion ?? 2)
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
    if (projectMayHaveResources) {
      const cleanup = runDocker([...composeBase(), "down", "--volumes"], {
        env: composeEnvironment(),
      });
      report.cleanupExitCode = cleanup;
      if (cleanup !== 0) exitCode = cleanup;
      else record("compose-cleanup", "passed");
    }

    for (const tag of capturedImageTags) {
      const removed = runDocker(["image", "rm", tag], { stdio: "ignore" });
      if (removed !== 0) {
        exitCode = 1;
        record("captured-image-tag-cleanup", "failed", { tag });
      }
    }

    for (const imageId of newlyLoadedCapturedImages) {
      const removed = runDocker(["image", "rm", imageId], { stdio: "ignore" });
      if (removed === 0)
        record("captured-image-cleanup", "passed", { imageId });
      else
        record("captured-image-cleanup", "retained", {
          imageId,
          reason:
            "image could not be removed without affecting another Docker reference",
        });
    }

    if (projectMayHaveResources) {
      try {
        const remaining = inspectLeftovers();
        report.leftovers = remaining;
        if (
          remaining.containers.length ||
          remaining.volumes.length ||
          remaining.networks.length
        ) {
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

  if (
    privateReportDirectory &&
    !privateReportPath &&
    existsSync(privateReportDirectory)
  ) {
    try {
      rmdirSync(privateReportDirectory);
    } catch {
      // Preserve an unexpected non-empty directory rather than recursively removing it.
    }
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
  if (restoreFormat === "service-v1" && !privateReportPath) {
    process.stderr.write(
      "[restore] private report omitted because service-v1 receipt/report validation did not complete\n",
    );
  } else writeReport();
}

process.exitCode = exitCode;
