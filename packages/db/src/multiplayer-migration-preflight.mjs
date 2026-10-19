import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const safeApiErrorCodes = new Set([
  "AUTH_REQUIRED",
  "GM_REQUIRED",
  "INVALID_REQUEST",
  "SPELL_PACK_ID_MISMATCH",
  "SPELL_PACK_INITIAL_LIFECYCLE_INVALID",
  "SPELL_PACK_DRAFT_VERSION_REQUIRED",
  "SPELL_PACK_NOT_FOUND",
  "SPELL_PACK_VERSION_CONFLICT",
  "SPELL_PACK_VERSION_SEQUENCE_INVALID",
  "ACTION_ID_CONFLICT",
  "SPELL_PACK_CONFLICT",
  "SPELL_PACK_REPLAY_PROJECTION_FAILED",
]);
export function isSafeApiErrorCode(code) {
  return typeof code === "string" && safeApiErrorCodes.has(code);
}
const safeStorageErrorCodes = new Set([
  "SPELL_PACK_INITIAL_VERSION_REQUIRED",
  "SPELL_PACK_NOT_FOUND",
  "SPELL_PACK_VERSION_CONFLICT",
  "SPELL_PACK_VERSION_SEQUENCE_INVALID",
]);
const safeErrorNames = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "PostgresError",
  "DrizzleQueryError",
]);
const safeSqlStates = new Set([
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "42P01",
  "42703",
  "57014",
]);
const safeNodeErrorCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  ...safeSqlStates,
]);

export const requiredMembershipColumns = Object.freeze([
  "campaign_id",
  "created_at",
  "default_theme_id",
  "default_theme_revision",
  "display_name",
  "id",
  "revision",
  "role",
  "ruler_color",
  "selected_theme_id",
  "theme_revision",
  "user_id",
]);
export const requiredRoleLabels = Object.freeze(["GM", "PLAYER"]);

export class ProbePreflightError extends Error {
  constructor(category) {
    super(`SPELL_PROBE_PREFLIGHT:${category}`);
    this.name = "ProbePreflightError";
  }
}

export class ProbeAssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProbeAssertionError";
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function deriveMigrationIdentity(directory) {
  const root = directory instanceof URL ? fileURLToPath(directory) : directory;
  let journalText;
  try {
    journalText = readFileSync(join(root, "meta", "_journal.json"), "utf8");
  } catch {
    throw new ProbePreflightError("SOURCE_MISMATCH");
  }
  const journal = JSON.parse(journalText);
  if (!Array.isArray(journal.entries) || journal.entries.length === 0)
    throw new ProbePreflightError("SOURCE_MISMATCH");

  const entries = journal.entries.map(({ tag }) => {
    if (typeof tag !== "string" || !/^\d{4}_[a-z0-9_]+$/.test(tag))
      throw new ProbePreflightError("SOURCE_MISMATCH");
    let sql;
    try {
      sql = readFileSync(join(root, `${tag}.sql`));
    } catch {
      throw new ProbePreflightError("SOURCE_MISMATCH");
    }
    const hash = sha256(sql);
    return { tag, hash };
  });
  const sqlFiles = readdirSync(root)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const journalFiles = entries.map(({ tag }) => `${tag}.sql`).sort();
  if (JSON.stringify(sqlFiles) !== JSON.stringify(journalFiles))
    throw new ProbePreflightError("SOURCE_MISMATCH");

  const manifest = entries.map(({ tag, hash }) => `${tag}:${hash}\n`).join("");
  return {
    count: entries.length,
    journalSha256: sha256(journalText),
    manifestSha256: sha256(manifest),
    migrationHashes: entries.map(({ hash }) => hash),
  };
}

export function validateMigrationPreflight(expected, actual) {
  if (
    !expected ||
    expected.count !== actual.source?.count ||
    expected.journalSha256 !== actual.source?.journalSha256 ||
    expected.manifestSha256 !== actual.source?.manifestSha256 ||
    JSON.stringify(expected.migrationHashes) !==
      JSON.stringify(actual.source?.migrationHashes)
  )
    throw new ProbePreflightError("SOURCE_MISMATCH");
  if (
    JSON.stringify(actual.ledgerHashes) !==
    JSON.stringify(expected.migrationHashes)
  )
    throw new ProbePreflightError("LEDGER_MISMATCH");
  if (
    JSON.stringify(actual.membershipColumns) !==
    JSON.stringify(requiredMembershipColumns)
  )
    throw new ProbePreflightError("MEMBERSHIP_COLUMNS");
  if (JSON.stringify(actual.roleLabels) !== JSON.stringify(requiredRoleLabels))
    throw new ProbePreflightError("ROLE_ENUM");
}

export function classifyProbeDiagnostic(error) {
  if (error?.name === "ProbeAssertionError")
    return `SPELL_PROBE_DIAGNOSTIC:ASSERTION:${error.message}`;
  if (error?.name === "SpellPackStorageError")
    return `SPELL_PROBE_DIAGNOSTIC:STORAGE:${safeStorageErrorCodes.has(error.code) ? error.code : "UNRECOGNIZED"}`;
  if (!(error instanceof Error))
    return "SPELL_PROBE_DIAGNOSTIC:EXCEPTION:UNKNOWN";

  const apiCreate = /^SPELL_PROBE_API_CREATE:(\d{3}):([A-Z_]{1,48})$/.exec(
    error.message,
  );
  if (apiCreate) {
    const code = apiCreate[2] ?? "";
    return `SPELL_PROBE_DIAGNOSTIC:API_CREATE:${apiCreate[1]}:${safeApiErrorCodes.has(code) ? code : "UNRECOGNIZED"}`;
  }
  const preflight =
    /^SPELL_PROBE_PREFLIGHT:(SOURCE_MISMATCH|LEDGER_MISMATCH|MEMBERSHIP_COLUMNS|ROLE_ENUM|EXPECTED_IDENTITY_REQUIRED)$/.exec(
      error.message,
    );
  if (preflight) return `SPELL_PROBE_DIAGNOSTIC:PREFLIGHT:${preflight[1]}`;
  if (error.message === "DATABASE_URL is required for the PostgreSQL probe")
    return "SPELL_PROBE_DIAGNOSTIC:ENV:DATABASE_URL_REQUIRED";

  const safeName = safeErrorNames.has(error.name) ? error.name : "UNRECOGNIZED";
  const rawCode = "code" in error ? error.code : undefined;
  const safeCode =
    typeof rawCode === "string" && safeNodeErrorCodes.has(rawCode)
      ? rawCode
      : "UNRECOGNIZED";
  const cause =
    "cause" in error && error.cause instanceof Error ? error.cause : null;
  const causeName =
    cause && safeErrorNames.has(cause.name) ? cause.name : "UNRECOGNIZED";
  const causeCodeRaw = cause && "code" in cause ? cause.code : undefined;
  const causeCode =
    typeof causeCodeRaw === "string" && safeSqlStates.has(causeCodeRaw)
      ? causeCodeRaw
      : typeof causeCodeRaw === "string" && safeNodeErrorCodes.has(causeCodeRaw)
        ? causeCodeRaw
        : "UNRECOGNIZED";
  return `SPELL_PROBE_DIAGNOSTIC:EXCEPTION:${safeName}:${safeCode}:CAUSE:${causeName}:${causeCode}`;
}
