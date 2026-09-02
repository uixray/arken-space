/* global fetch */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  checkProductionHealth,
  DEFAULT_MAX_CLOCK_SKEW_MS,
  DEFAULT_PRODUCTION_HEALTH_URL,
} from "./production-monitor-core.mjs";

export function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  if (!/^[1-9][0-9]*$/.test(value))
    throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

export async function runProductionHealthMonitor({
  environment = process.env,
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  const outputPath = environment.ARKEN_MONITOR_RESULT_PATH;
  if (!outputPath) throw new Error("ARKEN_MONITOR_RESULT_PATH is required");

  let result;
  try {
    result = await checkProductionHealth({
      healthUrl:
        environment.ARKEN_MONITOR_HEALTH_URL ?? DEFAULT_PRODUCTION_HEALTH_URL,
      fetchImpl,
      timeoutMs: parsePositiveInteger(
        environment.ARKEN_MONITOR_TIMEOUT_MS,
        15_000,
        "ARKEN_MONITOR_TIMEOUT_MS",
      ),
      maxClockSkewMs: parsePositiveInteger(
        environment.ARKEN_MONITOR_MAX_CLOCK_SKEW_MS,
        DEFAULT_MAX_CLOCK_SKEW_MS,
        "ARKEN_MONITOR_MAX_CLOCK_SKEW_MS",
      ),
      now,
    });
  } catch (error) {
    result = {
      ok: false,
      checkedAt: new Date(now()).toISOString(),
      reason: "MONITOR_EXECUTION_ERROR",
      summary:
        error instanceof Error ? error.message : "Monitor execution failed",
      health: null,
    };
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const prefix = result.ok ? "HEALTHY" : "UNHEALTHY";
  process.stdout.write(`${prefix}: ${result.summary}\n`);
  return result;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await runProductionHealthMonitor();
  if (!result.ok) process.exitCode = 1;
}
