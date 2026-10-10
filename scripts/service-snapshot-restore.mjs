import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseDatabaseCounts,
  parseMigrationLedger,
  validateServiceSnapshotManifest,
} from "./restore-rehearsal-core.mjs";

const sha256Pattern = /^[0-9a-f]{64}$/i;

export function resolveRestoreMode(env) {
  const format = env.RESTORE_FORMAT ?? "legacy";
  if (format !== "legacy" && format !== "service-v1")
    throw new Error("RESTORE_FORMAT must be legacy or service-v1");
  if (format === "legacy") return { format };
  if (env.ARKEN_ISOLATED_ONLY !== "true")
    throw new Error("service-v1 restore requires ARKEN_ISOLATED_ONLY=true");
  if (!sha256Pattern.test(env.SNAPSHOT_ID ?? ""))
    throw new Error(
      "service-v1 restore requires a full 64-character SNAPSHOT_ID",
    );
  if (
    !env.RESTORE_CAPTURE_RECEIPT_PATH ||
    !sha256Pattern.test(env.RESTORE_CAPTURE_RECEIPT_SHA256 ?? "")
  )
    throw new Error(
      "service-v1 restore requires a protected capture receipt path and SHA-256",
    );
  if (!env.RESTORE_REPORT_PATH)
    throw new Error(
      "service-v1 restore requires a private RESTORE_REPORT_PATH",
    );
  let receiptBytes;
  try {
    receiptBytes = readFileSync(path.resolve(env.RESTORE_CAPTURE_RECEIPT_PATH));
  } catch {
    throw new Error("service-v1 capture receipt is missing or unreadable");
  }
  const receiptSha256 = createHash("sha256").update(receiptBytes).digest("hex");
  if (receiptSha256 !== env.RESTORE_CAPTURE_RECEIPT_SHA256.toLowerCase())
    throw new Error("service-v1 capture receipt digest does not match");
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString("utf8"));
  } catch {
    throw new Error("service-v1 capture receipt is invalid JSON");
  }
  let copyReceiptSha256;
  let copyReceiptPath;
  let sourceSnapshotId = env.SNAPSHOT_ID.toLowerCase();
  if (env.RESTORE_COPY_RECEIPT_PATH || env.RESTORE_COPY_RECEIPT_SHA256) {
    if (
      !env.RESTORE_COPY_RECEIPT_PATH ||
      !sha256Pattern.test(env.RESTORE_COPY_RECEIPT_SHA256 ?? "")
    )
      throw new Error(
        "Copied recovery requires a mapping receipt path and digest",
      );
    copyReceiptPath = path.resolve(env.RESTORE_COPY_RECEIPT_PATH);
    const bytes = readFileSync(copyReceiptPath);
    copyReceiptSha256 = createHash("sha256").update(bytes).digest("hex");
    if (copyReceiptSha256 !== env.RESTORE_COPY_RECEIPT_SHA256.toLowerCase())
      throw new Error("Copy mapping receipt digest does not match");
    const mapping = JSON.parse(bytes.toString("utf8"));
    if (
      mapping.format !== "arken-restic-copy-receipt-v1" ||
      mapping.integrityCheck !== "restic-check-read-data-passed" ||
      !sha256Pattern.test(mapping.sourceSnapshotId ?? "") ||
      mapping.copiedSnapshotId?.toLowerCase() !==
        env.SNAPSHOT_ID.toLowerCase() ||
      mapping.sourceSnapshotId.toLowerCase() === env.SNAPSHOT_ID.toLowerCase()
    )
      throw new Error(
        "Copy mapping receipt does not bind requested local snapshot",
      );
    sourceSnapshotId = mapping.sourceSnapshotId.toLowerCase();
  }
  if (
    receipt?.format !== "arken-service-capture-receipt-v1" ||
    receipt.snapshotId?.toLowerCase() !== sourceSnapshotId ||
    !sha256Pattern.test(receipt.manifestSha256 ?? "")
  )
    throw new Error(
      "service-v1 capture receipt does not match requested snapshot",
    );
  return {
    format,
    snapshotId: env.SNAPSHOT_ID.toLowerCase(),
    sourceSnapshotId,
    copyReceiptPath,
    copyReceiptSha256,
    manifestSha256: receipt.manifestSha256.toLowerCase(),
    receiptSha256,
    receiptPath: path.resolve(env.RESTORE_CAPTURE_RECEIPT_PATH),
    receipt,
    reportPath: path.resolve(env.RESTORE_REPORT_PATH),
  };
}

export async function resolveServiceSnapshot(snapshotRoot, request) {
  if (request?.format !== "service-v1")
    throw new Error("A validated service-v1 restore request is required");
  const artifacts = await validateServiceSnapshotManifest(snapshotRoot, {
    expectedManifestSha256: request.manifestSha256,
  });

  // Read and bind the metadata to the same receipt digest a second time so the
  // caller never trusts unverified manifest fields after file validation.
  const bytes = readFileSync(artifacts.manifestPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== request.manifestSha256)
    throw new Error("Service capture manifest changed during validation");
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (
    !Number.isSafeInteger(manifest.schemaVersion) ||
    manifest.schemaVersion < 1 ||
    typeof manifest.buildRevision !== "string" ||
    !manifest.buildRevision.trim()
  )
    throw new Error("Service capture manifest lacks build/schema evidence");
  if (
    request.receipt.buildRevision !== manifest.buildRevision ||
    request.receipt.schemaVersion !== manifest.schemaVersion ||
    !["server", "postgres", "web", "edge"].every(
      (name) =>
        request.receipt.imageIds?.[name]?.toLowerCase() ===
        manifest.images[name].toLowerCase(),
    )
  )
    throw new Error(
      "Service capture receipt and manifest do not describe the same runtime tuple",
    );

  const migrationLedger = parseMigrationLedger(
    readFileSync(artifacts.migrationLedgerPath, "utf8"),
  );
  const databaseCounts = parseDatabaseCounts(
    readFileSync(artifacts.databaseCountsPath, "utf8"),
  );
  if (migrationLedger.length === 0 || Object.keys(databaseCounts).length === 0)
    throw new Error("Service snapshot database proof is empty");

  return {
    ...artifacts,
    manifest,
    migrationLedger,
    databaseCounts,
    schemaVersion: manifest.schemaVersion,
    buildRevision: manifest.buildRevision,
    serverImageId: manifest.images.server.toLowerCase(),
    postgresImageId: manifest.images.postgres.toLowerCase(),
    databaseName: manifest.target.databaseName,
    mediaContainerPath: manifest.target.mediaContainerPath,
  };
}

export function serviceImageOverride({
  serverImage,
  postgresImage,
  mediaContainerPath,
}) {
  const tagPattern =
    /^arken-restore-[a-z0-9][a-z0-9_-]*-(?:server|postgres):service-v1$/;
  if (
    !tagPattern.test(serverImage ?? "") ||
    !tagPattern.test(postgresImage ?? "")
  )
    throw new Error("Isolated captured-image tags are required");
  if (
    typeof mediaContainerPath !== "string" ||
    !/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(mediaContainerPath) ||
    mediaContainerPath === "/" ||
    path.posix.normalize(mediaContainerPath) !== mediaContainerPath ||
    mediaContainerPath.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("Captured media mount target is invalid");
  return [
    "services:",
    "  postgres:",
    `    image: ${postgresImage}`,
    "  server:",
    `    image: ${serverImage}`,
    "    build: !reset null",
    "    environment:",
    "      MEDIA_ROOT: ${RESTORE_MEDIA_CONTAINER_PATH:?Set RESTORE_MEDIA_CONTAINER_PATH}",
    "      DATABASE_URL: ${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL}",
    "    volumes: !override",
    "      - type: bind",
    "        source: ${RESTORE_MEDIA_HOST_PATH:?Set RESTORE_MEDIA_HOST_PATH}",
    "        target: ${RESTORE_MEDIA_CONTAINER_PATH:?Set RESTORE_MEDIA_CONTAINER_PATH}",
    "",
  ].join("\n");
}

export function assertRestoreProjectVacant({
  containers = [],
  volumes = [],
  networks = [],
  imageTags = [],
}) {
  if (
    containers.length ||
    volumes.length ||
    networks.length ||
    imageTags.length
  )
    throw new Error("Restore project name or image tags are already in use");
}

export function assertPrivateWindowsAcl(
  entries,
  currentUserSid,
  inheritanceProtected = false,
) {
  if (
    inheritanceProtected !== true ||
    !Array.isArray(entries) ||
    entries.length !== 1 ||
    entries[0]?.sid !== currentUserSid ||
    entries[0]?.type !== "Allow" ||
    entries[0]?.rights !== "FullControl" ||
    entries[0]?.inherited !== false
  )
    throw new Error(
      "Private restore ACL must grant only current user FullControl",
    );
}
