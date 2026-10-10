import path from "node:path";
import { lstatSync, realpathSync } from "node:fs";

const shaPattern = /^[0-9a-f]{40}$/i;
const imagePattern = /^sha256:[0-9a-f]{64}$/i;
const projectPattern = /^arken-candidate-[a-z0-9][a-z0-9-]{5,54}$/;

function requireSha(value, label) {
  if (!shaPattern.test(value ?? ""))
    throw new Error(`${label} must be a full 40-character immutable SHA`);
  return value.toLowerCase();
}

function requireImageId(value, label) {
  if (!imagePattern.test(value ?? ""))
    throw new Error(`${label} must be an immutable sha256 image ID`);
  return value.toLowerCase();
}

export function createLocalCandidateRecoveryPlan(input) {
  const candidateSha = requireSha(input?.candidateSha, "candidateSha");
  const serverImageId = requireImageId(input?.serverImageId, "serverImageId");
  const webImageId = requireImageId(input?.webImageId, "webImageId");
  const postgresImageId = requireImageId(
    input?.postgresImageId,
    "postgresImageId",
  );
  const projectName = input?.projectName;
  if (!projectPattern.test(projectName ?? ""))
    throw new Error("Unique arken-candidate project name is required");
  if (input?.syntheticOnly !== true)
    throw new Error("Recovery plan requires explicit syntheticOnly scope");
  if (
    !path.isAbsolute(input?.repositoryRoot ?? "") ||
    !path.isAbsolute(input?.artifactRoot ?? "") ||
    !path.isAbsolute(input?.artifactDirectory ?? "")
  )
    throw new Error(
      "Repository, approved artifact root, and run artifact directory must be absolute and explicit",
    );
  const repo = path.resolve(input.repositoryRoot);
  const approvedRoot = path.resolve(input.artifactRoot);
  const artifactDirectory = path.resolve(input.artifactDirectory);
  const inside = (parent, child) =>
    child === parent || child.startsWith(parent + path.sep);
  if (
    !inside(path.resolve(repo, ".data", "qa-prep"), approvedRoot) ||
    !inside(approvedRoot, artifactDirectory) ||
    artifactDirectory === approvedRoot
  )
    throw new Error(
      "Artifact directory must be a unique child of the approved .data/qa-prep root",
    );
  if (
    /(?:^|[\\/])(?:prod|production|retained|live)(?:[\\/]|$)/i.test(
      artifactDirectory,
    )
  )
    throw new Error(
      "Artifact directory cannot target retained or production data",
    );
  if (realpathSync(repo) !== repo)
    throw new Error(
      "Repository root must not be reached through a symlink or reparse point",
    );
  for (const target of [approvedRoot, artifactDirectory]) {
    let current = repo;
    for (const component of path
      .relative(repo, target)
      .split(path.sep)
      .filter(Boolean)) {
      current = path.join(current, component);
      try {
        const stat = lstatSync(current);
        if (stat.isSymbolicLink())
          throw new Error(
            "Symlink or reparse point in recovery artifact path is forbidden",
          );
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  const previous = input?.preUpgrade;
  if (
    !previous ||
    !previous.snapshotId ||
    !previous.mediaArtifact ||
    !previous.imageIds
  )
    throw new Error(
      "Rollback requires a pre-upgrade snapshot, media artifact and exact prior image tuple",
    );
  const rollback = {
    sourceSha: requireSha(previous.sourceSha, "preUpgrade.sourceSha"),
    serverImageId: requireImageId(
      previous.imageIds.server,
      "preUpgrade.serverImageId",
    ),
    webImageId: requireImageId(previous.imageIds.web, "preUpgrade.webImageId"),
    snapshotId: String(previous.snapshotId),
    mediaArtifact: String(previous.mediaArtifact),
    schemaLane: "pre-upgrade data only",
  };
  if (
    rollback.sourceSha === candidateSha ||
    rollback.serverImageId === serverImageId ||
    rollback.webImageId === webImageId
  )
    throw new Error(
      "Rollback tuple must identify a distinct pre-upgrade release",
    );
  const port = input?.loopbackPort;
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Explicit unprivileged loopback QA port is required");
  const webPort = input?.webLoopbackPort;
  if (
    !Number.isInteger(webPort) ||
    webPort < 1024 ||
    webPort > 65535 ||
    webPort === port
  )
    throw new Error(
      "A distinct explicit unprivileged loopback web port is required",
    );
  return Object.freeze({
    mode: "plan-only",
    candidateSha,
    syntheticOnly: true,
    projectName,
    repositoryRoot: repo,
    artifactRoot: approvedRoot,
    imageIds: {
      server: serverImageId,
      web: webImageId,
      postgres: postgresImageId,
    },
    loopbackBinding: `127.0.0.1:${port}`,
    databasesPublished: false,
    network: "project-scoped internal network",
    volumes: [`${projectName}-postgres`, `${projectName}-media`],
    composeArgs: [
      "compose",
      "-f",
      "docker-compose.restore-candidate.yml",
      "-p",
      projectName,
      "up",
      "--pull",
      "never",
      "--no-build",
    ],
    composeVariables: {
      CANDIDATE_SERVER_IMAGE_ID: serverImageId,
      CANDIDATE_WEB_IMAGE_ID: webImageId,
      CANDIDATE_POSTGRES_IMAGE_ID: postgresImageId,
      CANDIDATE_FULL_SHA: candidateSha,
      CANDIDATE_QA_PORT: port,
      CANDIDATE_WEB_QA_PORT: webPort,
      // Credentials are opaque required inputs; never materialize in a plan or log.
      requiredSyntheticSecretNames: [
        "SYNTHETIC_POSTGRES_PASSWORD",
        "SYNTHETIC_GM_TOKEN",
      ],
    },
    migrationChecks: [
      "candidate journal and applied ledger exact match",
      "table counts full against current schema",
      "legacy-prefix preservation before candidate migration",
    ],
    outboxPolicy:
      "fake transport only; key availability recorded; no real send",
    rollback,
    artifactDirectory,
    execution:
      "not authorized by this plan helper; a separate root-approved execution gate is required",
  });
}

export function runCandidateRecoveryPlan(
  plan,
  {
    execute = false,
    syntheticOnly = false,
    approval = null,
    commandRunner = null,
  } = {},
) {
  if (!execute) return { status: "planned", commandsRun: 0, plan };
  if (
    syntheticOnly !== true ||
    approval?.approved !== true ||
    approval?.candidateSha !== plan?.candidateSha ||
    typeof commandRunner !== "function"
  )
    throw new Error(
      "Execution requires a matching root-approved synthetic run configuration and command runner",
    );
  throw new Error(
    "Execution adapter is intentionally not implemented in this source-only pool",
  );
}
