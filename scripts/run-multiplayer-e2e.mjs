/* global AbortSignal, URL, console, fetch, setTimeout */

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, statfsSync, writeFileSync } from "node:fs";
import process from "node:process";

const gibibyte = 1024 ** 3;
const expectedOrigin = "http://edge";
const edgeHealthUrl = "http://127.0.0.1:14180/healthz";
const productionHealthUrl =
  process.env.ARKEN_PRODUCTION_HEALTH_URL ??
  "https://arken.uixray.tech/healthz";
const minimumFreeBytes = Number(
  process.env.ARKEN_E2E_MIN_FREE_BYTES ?? 6 * gibibyte,
);
const projectName =
  process.env.ARKEN_E2E_PROJECT_NAME ??
  "arken-e2e-" + Date.now().toString(36) + "-" + process.pid;
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const reportDirectory = new URL(
  "../test-results/multiplayer/",
  import.meta.url,
);
const report = {
  projectName,
  startedAt: new Date().toISOString(),
  productionHealthUrl,
  expectedOrigin,
  steps: [],
};
let activeChild = null;
let interruptedBy = null;

if (!/^[a-z0-9][a-z0-9_-]+$/.test(projectName))
  throw new Error("ARKEN_E2E_PROJECT_NAME must be lowercase and shell-safe");
if (!Number.isFinite(minimumFreeBytes) || minimumFreeBytes < gibibyte)
  throw new Error("ARKEN_E2E_MIN_FREE_BYTES must be at least 1 GiB");

const compose = [
  "compose",
  "--project-name",
  projectName,
  "--file",
  "docker-compose.e2e.yml",
  "--profile",
  "test",
];

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
  console.log("[e2e] " + status + " " + name + suffix);
}

function commandError(command, args, result) {
  const detail = result.stderr?.trim() || result.stdout?.trim() || "no output";
  return new Error(command + " " + args.join(" ") + " failed: " + detail);
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) throw commandError(command, args, result);
  return result.stdout.trim();
}

function optionalCapture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
  });
  return (result.status ?? 1) === 0 ? result.stdout.trim() : null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

function freeBytes(path) {
  const disk = statfsSync(path);
  return Number(disk.bavail) * Number(disk.bsize);
}

async function fetchJson(url, timeoutMs = 10_000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(url + " returned " + response.status);
  return response.json();
}

async function isReachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await fetchJson(url, 3_000);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError ?? new Error("Timed out waiting for " + url);
}

function composeEnvironment(service) {
  if (!service?.environment) return {};
  if (!Array.isArray(service.environment)) return service.environment;
  return Object.fromEntries(
    service.environment.map((entry) => {
      const separator = entry.indexOf("=");
      return separator === -1
        ? [entry, ""]
        : [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
}

function resolveBuildRevision() {
  const configured = process.env.E2E_BUILD_REVISION?.trim();
  if (configured) return configured;
  const revision = optionalCapture("git", ["rev-parse", "HEAD"]);
  if (!revision)
    throw new Error(
      "E2E_BUILD_REVISION is required when running from a Git archive",
    );
  return revision;
}

async function preflight(buildRevision) {
  capture(docker, ["info", "--format", "{{.ServerVersion}}"]);
  record("docker-permission", "passed");

  const dockerRootText = capture(docker, [
    "info",
    "--format",
    "{{.DockerRootDir}}",
  ]);
  let diskPath = dockerRootText;
  let available;
  try {
    available = freeBytes(diskPath);
  } catch {
    diskPath = process.cwd();
    available = freeBytes(diskPath);
  }
  if (available < minimumFreeBytes)
    throw new Error(
      "LOW_DISK_SPACE: " +
        available +
        " bytes free at " +
        diskPath +
        "; " +
        minimumFreeBytes +
        " required",
    );
  report.diskBefore = { path: diskPath, freeBytes: available };
  record("disk-threshold", "passed", {
    path: diskPath,
    freeGiB: Number((available / gibibyte).toFixed(2)),
    minimumGiB: Number((minimumFreeBytes / gibibyte).toFixed(2)),
  });

  if (await isReachable(edgeHealthUrl))
    throw new Error("E2E_PORT_IN_USE: " + edgeHealthUrl);
  record("isolated-edge-port", "passed", { url: edgeHealthUrl });

  const configText = capture(
    docker,
    [...compose, "config", "--format", "json"],
    { env: { ...process.env, E2E_BUILD_REVISION: buildRevision } },
  );
  const config = JSON.parse(configText);
  const serverEnvironment = composeEnvironment(config.services?.server);
  const browserEnvironment = composeEnvironment(config.services?.playwright);
  if (serverEnvironment.WEB_ORIGIN !== expectedOrigin)
    throw new Error("WEB_ORIGIN must be exactly " + expectedOrigin);
  if (browserEnvironment.E2E_BASE_URL !== expectedOrigin)
    throw new Error("E2E_BASE_URL must be exactly " + expectedOrigin);
  record("exact-origin", "passed", { origin: expectedOrigin });

  const production = await fetchJson(productionHealthUrl, 20_000);
  if (production.status !== "ok" || production.database !== "ok")
    throw new Error("Production health preflight is not healthy");
  report.productionBefore = production;
  record("production-health-before", "passed", {
    buildRevision: production.buildRevision,
    schemaVersion: production.schemaVersion,
  });
}

async function runPlaywrightWithRestart(environment) {
  const marker = "ARKEN_E2E_BACKEND_RESTART_READY";
  let buffer = "";
  let markerCount = 0;
  let restartChain = Promise.resolve();
  const child = spawn(docker, [...compose, "run", "--rm", "playwright"], {
    env: environment,
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
  });
  activeChild = child;

  const forward = (target) => (chunk) => {
    target.write(chunk);
    const combined = buffer + chunk.toString("utf8");
    let cursor = 0;
    let index = combined.indexOf(marker, cursor);
    while (index !== -1) {
      markerCount += 1;
      const attempt = markerCount;
      record("backend-restart-marker", "passed", { attempt });
      restartChain = restartChain.then(async () => {
        const code = await runAsync(
          docker,
          [...compose, "restart", "--timeout", "10", "server"],
          { env: environment },
        );
        if (code !== 0) throw new Error("Backend restart exited " + code);
        record("backend-restart", "passed", { attempt });
      });
      cursor = index + marker.length;
      index = combined.indexOf(marker, cursor);
    }
    buffer = combined.slice(-(marker.length - 1));
  };
  child.stdout.on("data", forward(process.stdout));
  child.stderr.on("data", forward(process.stderr));

  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  activeChild = null;
  await restartChain;
  if (markerCount === 0 && status === 0)
    throw new Error("Playwright passed without exercising backend restart");
  return status;
}

function leftovers() {
  const containers = capture(docker, [
    "ps",
    "--all",
    "--quiet",
    "--filter",
    "label=com.docker.compose.project=" + projectName,
  ]);
  const volumes = capture(docker, [
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

function writeReport() {
  report.finishedAt = new Date().toISOString();
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(
    new URL("runner.json", reportDirectory),
    JSON.stringify(report, null, 2) + "\n",
  );
}

function handleSignal(signal) {
  interruptedBy = signal;
  record("termination-signal", "received", { signal });
  activeChild?.kill(signal);
}

process.once("SIGINT", () => handleSignal("SIGINT"));
process.once("SIGTERM", () => handleSignal("SIGTERM"));

let exitCode = 1;
let runSucceeded = false;
let buildRevision = "unknown";
let diskPath = process.cwd();
try {
  buildRevision = resolveBuildRevision();
  const environment = {
    ...process.env,
    E2E_BUILD_REVISION: buildRevision,
  };
  await preflight(buildRevision);
  diskPath = report.diskBefore.path;

  const up = run(
    docker,
    [...compose, "up", "--detach", "--build", "--wait", "edge"],
    { env: environment },
  );
  if (up !== 0) throw new Error("Compose up exited " + up);
  record("isolated-compose-up", "passed", { projectName });

  const edge = await waitForHealth(edgeHealthUrl);
  if (edge.status !== "ok" || edge.database !== "ok")
    throw new Error("Isolated edge health is not healthy");
  if (edge.buildRevision !== buildRevision)
    throw new Error(
      "Isolated build revision " + edge.buildRevision + " != " + buildRevision,
    );
  record("isolated-edge-health", "passed", { buildRevision });

  const playwright = await runPlaywrightWithRestart(environment);
  report.playwrightExitCode = playwright;
  if (playwright !== 0) throw new Error("Playwright exited " + playwright);
  record("playwright", "passed");
  runSucceeded = true;
  exitCode = 0;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  record("run", "failed", { error: report.error });
} finally {
  const environment = {
    ...process.env,
    E2E_BUILD_REVISION: buildRevision,
  };
  const cleanupArgs = [
    ...compose,
    "down",
    "--volumes",
    "--remove-orphans",
    ...(runSucceeded ? ["--rmi", "local"] : []),
  ];
  const cleanup = run(docker, cleanupArgs, { env: environment });
  report.cleanupExitCode = cleanup;
  if (cleanup !== 0) exitCode = cleanup;
  else
    record("compose-cleanup", "passed", {
      localImagesRemoved: runSucceeded,
    });

  try {
    const remaining = leftovers();
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

  try {
    const production = await fetchJson(productionHealthUrl, 20_000);
    report.productionAfter = production;
    if (production.status !== "ok" || production.database !== "ok") {
      exitCode = 1;
      record("production-health-after", "failed", production);
    } else
      record("production-health-after", "passed", {
        buildRevision: production.buildRevision,
        schemaVersion: production.schemaVersion,
      });
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
      path: diskPath,
      freeGiB: Number((available / gibibyte).toFixed(2)),
    });
  } catch (error) {
    exitCode = 1;
    record("disk-after", "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (interruptedBy) {
    report.interruptedBy = interruptedBy;
    exitCode = 130;
  }
  writeReport();
}

process.exitCode = exitCode;
