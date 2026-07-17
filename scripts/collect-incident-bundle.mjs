import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_SINCE = "2h";
export const MAX_SINCE_HOURS = 24;
export const MAX_LOG_BYTES = 10 * 1024 * 1024;
const SERVICES = ["server", "postgres", "web"];

export function validateSince(value) {
  const match = /^(\d+)(m|h)$/.exec(value);
  if (!match)
    throw new Error("--since must use a bounded duration such as 30m or 2h");
  const hours = Number(match[1]) * (match[2] === "h" ? 1 : 1 / 60);
  if (hours <= 0 || hours > MAX_SINCE_HOURS) {
    throw new Error(
      `--since must be greater than zero and no more than ${MAX_SINCE_HOURS}h`,
    );
  }
  return value;
}

export function redactDiagnosticText(input) {
  return input
    .replace(
      /("(?:authorization|cookie|gm_access_token|session|invite(?:_token)?|secret|password|token)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      '$1"[REDACTED]"',
    )
    .replace(
      /\b(authorization)\s*([:=])\s*(?!["'])(?:(?:Bearer|Basic)\s+)?[^\s,;]+/gi,
      "$1$2 [REDACTED]",
    )
    .replace(
      /\b(cookie)\s*([:=])\s*(?!["'])[^;\s,]+(?:\s*;\s*[^;\s,]+)*/gi,
      "$1$2 [REDACTED]",
    )
    .replace(
      /\b(gm_access_token|session|invite(?:_token)?|secret|password|token)\s*([:=])\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi,
      "$1$2[REDACTED]",
    )
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, "$1[REDACTED]@");
}

function parseArgs(argv) {
  const result = { since: DEFAULT_SINCE, output: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--since") result.since = argv[++index];
    else if (argv[index] === "--output") result.output = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  result.since = validateSince(result.since);
  return result;
}

function runDocker(args, maxBuffer = MAX_LOG_BYTES) {
  return execFileSync("docker", ["compose", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function safeCollect(name, callback) {
  try {
    return { name, ok: true, content: callback() };
  } catch (error) {
    return {
      name,
      ok: false,
      content: `Collection failed: ${error.message}\n`,
    };
  }
}

export function collectIncidentBundle({ since, output }) {
  const collectedAt = new Date();
  const defaultName = `incident-${collectedAt.toISOString().replace(/[:.]/g, "-")}`;
  const destination = path.resolve(
    output ?? path.join("test-results", "incidents", defaultName),
  );
  const staging = mkdtempSync(path.join(tmpdir(), "arken-incident-"));
  const results = [
    safeCollect("compose-ps.txt", () => runDocker(["ps", "--all"])),
    ...SERVICES.map((service) =>
      safeCollect(`${service}.log`, () =>
        runDocker([
          "logs",
          "--no-color",
          "--timestamps",
          "--since",
          since,
          service,
        ]),
      ),
    ),
  ];

  try {
    for (const result of results) {
      const bounded = result.content.slice(0, MAX_LOG_BYTES);
      writeFileSync(
        path.join(staging, result.name),
        redactDiagnosticText(bounded),
        { mode: 0o600 },
      );
    }
    writeFileSync(
      path.join(staging, "manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          collectedAt: collectedAt.toISOString(),
          since,
          services: SERVICES,
          includesDatabaseRows: false,
          includesUploadedFiles: false,
          files: results.map(({ name, ok }) => ({ name, ok })),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    mkdirSync(path.dirname(destination), { recursive: true });
    renameSync(staging, destination);
    chmodSync(destination, 0o700);
    return destination;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const destination = collectIncidentBundle(parseArgs(process.argv.slice(2)));
    process.stdout.write(`Incident bundle written to ${destination}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
