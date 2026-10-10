import { createHash } from "node:crypto";
import {
  createReadStream,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

const restoreProjectPattern = /^arken-restore-[a-z0-9][a-z0-9_-]*$/;

const applicationCountTableNames = [
  "account_action_tokens",
  "account_campaign_creations",
  "account_campaign_invites",
  "account_mail_outbox",
  "account_sessions",
  "action_journal",
  "assets",
  "campaign_audio_tracks",
  "campaign_sound_packs",
  "campaign_soundpad_settings",
  "campaign_sounds",
  "campaigns",
  "catalog_entries",
  "character_catalog_entries",
  "character_controllers",
  "character_media",
  "character_spell_assignment_versions",
  "character_spell_assignments",
  "characters",
  "chat_attachment_uploads",
  "chat_attachments",
  "chat_messages",
  "chat_read_cursors",
  "chat_threads",
  "drawings",
  "encounters",
  "feedback_attachments",
  "feedback_operator_audits",
  "feedback_reports",
  "fog_reveals",
  "game_events",
  "global_sticker_media",
  "global_sticker_packs",
  "global_stickers",
  "gm_access_credentials",
  "invites",
  "memberships",
  "player_access_grants",
  "player_likeness_consents",
  "player_requests",
  "public_roadmap_votes",
  "scenes",
  "sessions",
  "spell_pack_versions",
  "spell_packs",
  "sticker_media",
  "sticker_pack_entitlements",
  "sticker_packs",
  "stickers",
  "story_import_batches",
  "story_import_sources",
  "story_post_media",
  "story_post_revisions",
  "story_posts",
  "token_controllers",
  "token_definitions",
  "tokens",
  "users",
  "world_content",
  "world_content_actions",
  "world_content_instance_actions",
  "world_content_instances",
  "world_content_media",
  "world_content_relations",
  "world_map_location_scenes",
  "world_map_locations",
  "world_map_party_position",
  "world_maps",
];
const applicationCountTables = new Set(applicationCountTableNames);

function listRegularFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Service snapshot contains a symlink or reparse point");
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile()) files.push(candidate);
      else throw new Error("Service snapshot contains a non-regular entry");
    }
  };
  visit(root);
  return files;
}

function safeManifestRelativePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.startsWith("//")
  )
    throw new Error("Service snapshot manifest contains an unsafe path");
  const segments = value.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === "..",
    ) ||
    path.posix.normalize(value) !== value
  )
    throw new Error("Service snapshot manifest contains an unsafe path");
  return value;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function safeLstat(file) {
  try {
    return lstatSync(file);
  } catch {
    throw new Error("Service snapshot file is missing or unreadable");
  }
}

/**
 * Validate the v1 service-capture artifact without connecting it to the live
 * restore runner. `expectedManifestSha256` must come from the separately
 * protected capture receipt, not from the snapshot itself.
 */
export async function validateServiceSnapshotManifest(
  snapshotRoot,
  { expectedManifestSha256 },
) {
  if (!/^[0-9a-f]{64}$/i.test(expectedManifestSha256 ?? ""))
    throw new Error("Expected service snapshot manifest digest is required");
  let snapshot;
  let allFiles;
  try {
    snapshot = realpathSync(snapshotRoot);
    allFiles = listRegularFiles(snapshot);
  } catch {
    throw new Error("Service snapshot root is missing or unsafe");
  }
  const candidates = allFiles.filter(
    (file) => path.basename(file) === "capture-manifest.json",
  );
  if (candidates.length !== 1)
    throw new Error("Expected exactly one service capture manifest");
  const manifestPath = candidates[0];
  const captureRoot = path.dirname(manifestPath);
  let actualManifestSha;
  let manifestText;
  try {
    const manifestBytes = readFileSync(manifestPath);
    actualManifestSha = createHash("sha256")
      .update(manifestBytes)
      .digest("hex");
    manifestText = manifestBytes.toString("utf8");
  } catch {
    throw new Error("Service capture manifest is unreadable");
  }
  if (actualManifestSha !== expectedManifestSha256.toLowerCase())
    throw new Error("Service capture manifest digest does not match receipt");

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error("Service capture manifest is invalid JSON");
  }
  if (
    manifest?.format !== "arken-service-snapshot-v1" ||
    !["cloned-review", "compose"].includes(manifest?.captureMode) ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.target?.containerIds) ||
    manifest.target.containerIds.length !== 4 ||
    !manifest.target.containerIds.every((id) => /^[0-9a-f]{64}$/i.test(id)) ||
    !/^[A-Za-z0-9_]+$/.test(manifest.target?.databaseName ?? "") ||
    !/^[0-9a-f]{64}$/i.test(manifest.target?.networkId ?? "") ||
    typeof manifest.target?.mediaContainerPath !== "string" ||
    typeof manifest.target?.edgeConfigContainerPath !== "string" ||
    !manifest.images ||
    !["server", "postgres", "web", "edge"].every((name) =>
      /^sha256:[0-9a-f]{64}$/i.test(manifest.images[name] ?? ""),
    )
  )
    throw new Error("Service capture manifest has an unsupported shape");

  const rootReal = realpathSync(captureRoot);
  const declared = new Map();
  const collisionKeys = new Set();
  for (const entry of manifest.files) {
    const relative = safeManifestRelativePath(entry?.path);
    const collisionKey = relative.normalize("NFKC").toLocaleLowerCase("en-US");
    if (collisionKeys.has(collisionKey) || declared.has(relative))
      throw new Error("Service capture manifest contains duplicate paths");
    collisionKeys.add(collisionKey);
    if (
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      !/^[0-9a-f]{64}$/i.test(entry.sha256 ?? "")
    )
      throw new Error(
        "Service capture manifest contains an invalid file record",
      );
    const target = path.resolve(captureRoot, ...relative.split("/"));
    if (target !== captureRoot && !target.startsWith(captureRoot + path.sep))
      throw new Error("Service capture manifest path escaped its root");
    let current = captureRoot;
    for (const segment of relative.split("/")) {
      current = path.join(current, segment);
      const stat = safeLstat(current);
      if (stat.isSymbolicLink())
        throw new Error("Service snapshot contains a symlink or reparse point");
    }
    const fileStat = safeLstat(target);
    if (!fileStat.isFile() || fileStat.size !== entry.bytes)
      throw new Error(
        "Service snapshot file is missing or has a size mismatch",
      );
    const actualSha = await sha256File(target);
    if (actualSha !== entry.sha256.toLowerCase())
      throw new Error("Service snapshot file hash mismatch");
    declared.set(relative, { target, bytes: entry.bytes, sha256: actualSha });
  }

  const outsideFiles = allFiles.filter(
    (file) => file !== manifestPath && !file.startsWith(captureRoot + path.sep),
  );
  if (outsideFiles.length)
    throw new Error(
      "Service snapshot contains undeclared files outside its root",
    );
  const actualRelative = allFiles
    .filter((file) => file !== manifestPath)
    .map((file) => path.relative(captureRoot, file).split(path.sep).join("/"));
  if (
    actualRelative.length !== declared.size ||
    actualRelative.some((relative) => !declared.has(relative))
  )
    throw new Error("Service snapshot contains missing or undeclared files");

  for (const required of [
    "database.dump",
    "database-counts.txt",
    "postgres-version.txt",
    "migration-ledger.txt",
    "images/server.tar",
    "images/postgres.tar",
    "images/web.tar",
    "images/edge.tar",
  ])
    if (!declared.has(required))
      throw new Error("Service capture is missing a required artifact");
  if (!actualRelative.some((relative) => relative.startsWith("media/")))
    throw new Error("Service capture media directory is missing or empty");
  const mediaRoot = path.join(captureRoot, "media");
  const mediaStat = safeLstat(mediaRoot);
  if (mediaStat.isSymbolicLink() || !mediaStat.isDirectory())
    throw new Error("Service capture media root is invalid");
  if (realpathSync(mediaRoot) !== path.resolve(rootReal, "media"))
    throw new Error(
      "Service capture media root escaped its snapshot directory",
    );

  return {
    manifestPath,
    captureRoot,
    databaseDumpRelativePath: "database.dump",
    databaseCountsRelativePath: "database-counts.txt",
    migrationLedgerRelativePath: "migration-ledger.txt",
    mediaRootRelativePath: "media",
    databaseDumpPath: path.join(captureRoot, "database.dump"),
    databaseCountsPath: path.join(captureRoot, "database-counts.txt"),
    migrationLedgerPath: path.join(captureRoot, "migration-ledger.txt"),
    mediaRootPath: mediaRoot,
    files: declared.size,
    bytes: [...declared.values()].reduce((sum, file) => sum + file.bytes, 0),
    manifestSha256: actualManifestSha,
  };
}

/**
 * Exported so tests can compare this list directly against the other two
 * places backup coverage is declared (`infra/backup/database-counts.sql` and
 * the schema's own `pgTable` set). Drift between them once silently dropped
 * five tables out of disaster-recovery coverage.
 */
export { applicationCountTableNames };

/**
 * Tables that database-counts.sql used to count before a later migration
 * moved their data elsewhere and dropped them. A backup taken just before
 * such a migrate-and-drop deploy always still lists the about-to-be-dropped
 * table (it existed in the live database at backup time), so restore
 * rehearsal must recognize it as a known, legitimately retired table rather
 * than an unknown/leaked one -- while still proving no rows were lost, via
 * `supersededBy` (see `verifyRetiredTableMigration`).
 */
const retiredCountTables = {
  audio_states: { supersededBy: "campaign_audio_tracks" },
};

function environmentObject(value) {
  if (!value) return {};
  if (!Array.isArray(value)) return value;
  return Object.fromEntries(
    value.map((entry) => {
      const separator = entry.indexOf("=");
      return separator === -1
        ? [entry, ""]
        : [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
}

export function validateRestoreProjectName(projectName) {
  if (!restoreProjectPattern.test(projectName))
    throw new Error(
      "Restore project name must start with arken-restore- and be shell-safe",
    );
  return projectName;
}

export function resolveRestoredPath(snapshotRoot, backedUpAbsolutePath) {
  if (!path.posix.isAbsolute(backedUpAbsolutePath))
    throw new Error("Backed-up source path must be an absolute POSIX path");
  const root = path.resolve(snapshotRoot);
  const relative = backedUpAbsolutePath.replace(/^\/+/, "");
  const candidate = path.resolve(root, ...relative.split("/"));
  if (candidate !== root && !candidate.startsWith(root + path.sep))
    throw new Error("Resolved restore path escaped the snapshot root");
  return candidate;
}

export function parseDatabaseCounts(value) {
  const counts = {};
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const [table, countText, extra] = line.split("|");
    const count = Number(countText);
    if (
      !table ||
      extra !== undefined ||
      !Number.isSafeInteger(count) ||
      count < 0
    )
      throw new Error("Invalid database count line: " + line);
    if (Object.hasOwn(counts, table))
      throw new Error("Duplicate database count for " + table);
    counts[table] = count;
  }
  if (Object.keys(counts).length === 0)
    throw new Error("Database count manifest is empty");
  return counts;
}

export function compareDatabaseCounts(expected, actual) {
  const expectedText = JSON.stringify(expected);
  const actualText = JSON.stringify(actual);
  if (expectedText !== actualText)
    throw new Error(
      "Restored database counts differ from backup manifest: expected " +
        expectedText +
        ", got " +
        actualText,
    );
}

export function describeDatabaseCountCoverage(counts) {
  const tables = Object.keys(counts).sort();
  for (const table of tables) {
    if (
      !applicationCountTables.has(table) &&
      !Object.hasOwn(retiredCountTables, table)
    )
      throw new Error(
        `Database count manifest contains unknown table: ${table}`,
      );
  }
  const missingTables = applicationCountTableNames.filter(
    (table) => !Object.hasOwn(counts, table),
  );
  return {
    mode: missingTables.length === 0 ? "full" : "sampled",
    countedTables: tables.length,
    knownPersistedTables: applicationCountTableNames.length,
    missingTables,
  };
}

/** Drops retired-table keys before comparing manifest counts against a
 * restored+migrated database, since retired tables are deliberately excluded
 * from `buildDatabaseCountsQuery` (they no longer exist post-migration). Use
 * `verifyRetiredTableMigration` to confirm their data actually landed in the
 * superseding table instead of skipping verification entirely. */
export function stripRetiredCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).filter(
      ([table]) => !Object.hasOwn(retiredCountTables, table),
    ),
  );
}

/** The superseding table of every retired table present in `expectedCounts`
 * -- these did not exist yet at backup time (the backup predates the
 * migrate-and-drop deploy), so they are added on top of the manifest's own
 * tables purely so `verifyRetiredTableMigration` has something to compare
 * against. `stripSupersedingOnlyCounts` removes them again before the exact
 * manifest-vs-restored equality check, since they were never "expected" in
 * the manifest sense -- only queried as a one-time transitional check. */
function supersedingTablesFor(expectedCounts) {
  return [
    ...new Set(
      Object.entries(retiredCountTables)
        .filter(([table]) => Object.hasOwn(expectedCounts, table))
        .map(([, info]) => info.supersededBy)
        .filter((table) => !Object.hasOwn(expectedCounts, table)),
    ),
  ];
}

export function stripSupersedingOnlyCounts(expectedCounts, actualCounts) {
  const supersedingOnly = new Set(supersedingTablesFor(expectedCounts));
  return Object.fromEntries(
    Object.entries(actualCounts).filter(
      ([table]) => !supersedingOnly.has(table),
    ),
  );
}

/** For each retired table present in a backup manifest, confirms its
 * backed-up row count landed intact in the table that superseded it, so a
 * migrate-and-drop deploy can't silently lose rows just because the retired
 * table itself is no longer queryable after migration. */
export function verifyRetiredTableMigration(expectedCounts, actualCounts) {
  const checked = [];
  for (const [table, info] of Object.entries(retiredCountTables)) {
    if (!Object.hasOwn(expectedCounts, table)) continue;
    const expectedCount = expectedCounts[table];
    const supersededCount = actualCounts[info.supersededBy];
    if (supersededCount === undefined)
      throw new Error(
        `Retired table ${table} expected ${expectedCount} row(s) migrated into ` +
          `${info.supersededBy}, but ${info.supersededBy} was not counted`,
      );
    if (supersededCount !== expectedCount)
      throw new Error(
        `Retired table ${table} had ${expectedCount} row(s) at backup time, but ` +
          `superseding table ${info.supersededBy} has ${supersededCount} after ` +
          `restore+migrate -- data may have been lost`,
      );
    checked.push({
      retiredTable: table,
      supersededBy: info.supersededBy,
      rows: expectedCount,
    });
  }
  return checked;
}

export function buildDatabaseCountsQuery(expectedCounts) {
  describeDatabaseCountCoverage(expectedCounts);
  const tables = [
    ...new Set([
      ...Object.keys(expectedCounts).filter(
        (table) => !Object.hasOwn(retiredCountTables, table),
      ),
      ...supersedingTablesFor(expectedCounts),
    ]),
  ].sort();
  if (tables.length === 0) throw new Error("Database count manifest is empty");
  return (
    tables
      .map(
        (table, index) =>
          `${index === 0 ? "SELECT" : "UNION ALL SELECT"} '${table}', count(*)::bigint FROM ${table}`,
      )
      .join("\n") + "\nORDER BY 1;\n"
  );
}

export function readExpectedMigrationLedger({
  journalPath,
  migrationsDirectory,
}) {
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  if (
    journal?.dialect !== "postgresql" ||
    !Array.isArray(journal.entries) ||
    journal.entries.length === 0
  )
    throw new Error("Invalid PostgreSQL Drizzle migration journal");

  return journal.entries.map((entry, index) => {
    if (
      entry?.idx !== index ||
      !/^\d{4}_[a-z0-9_]+$/.test(entry?.tag ?? "") ||
      !Number.isSafeInteger(entry?.when) ||
      entry.when < 0
    )
      throw new Error(
        `Invalid Drizzle migration journal entry at index ${index}`,
      );
    const sql = readFileSync(
      path.join(migrationsDirectory, `${entry.tag}.sql`),
      "utf8",
    );
    return {
      index,
      tag: entry.tag,
      createdAt: entry.when,
      hash: createHash("sha256").update(sql).digest("hex"),
    };
  });
}

export function parseMigrationLedger(value) {
  const entries = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const [idText, hash, createdAtText, extra] = line.split("|");
    const id = Number(idText);
    const createdAt = Number(createdAtText);
    if (
      extra !== undefined ||
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !/^[0-9a-f]{64}$/i.test(hash ?? "") ||
      !Number.isSafeInteger(createdAt) ||
      createdAt < 0
    )
      throw new Error("Invalid migration ledger line: " + line);
    entries.push({ id, hash: hash.toLowerCase(), createdAt });
  }
  if (entries.length === 0)
    throw new Error("Restored migration ledger is empty");
  return entries;
}

export function compareMigrationLedger(expected, actual) {
  if (expected.length !== actual.length)
    throw new Error(
      `Restored migration count differs from checkout: expected ${expected.length}, got ${actual.length}`,
    );
  for (let index = 0; index < expected.length; index += 1) {
    const expectedEntry = expected[index];
    const actualEntry = actual[index];
    if (
      expectedEntry.createdAt !== actualEntry.createdAt ||
      expectedEntry.hash !== actualEntry.hash
    )
      throw new Error(
        `Restored migration identity differs at ${expectedEntry.tag}`,
      );
  }
}

export function compareMigrationLedgerPrefix(expected, actual) {
  if (actual.length > expected.length)
    throw new Error(
      `Restored migration count exceeds checkout: expected at most ${expected.length}, got ${actual.length}`,
    );
  for (let index = 0; index < actual.length; index += 1) {
    const expectedEntry = expected[index];
    const actualEntry = actual[index];
    if (
      expectedEntry.createdAt !== actualEntry.createdAt ||
      expectedEntry.hash !== actualEntry.hash
    )
      throw new Error(
        `Restored migration prefix differs at ${expectedEntry.tag}`,
      );
  }
}

export function selectResticSnapshot(
  snapshots,
  { request, expectedHost, expectedTag },
) {
  if (!Array.isArray(snapshots))
    throw new Error("Restic snapshots response must be an array");
  if (request !== "latest" && !/^[0-9a-f]{8,64}$/i.test(request))
    throw new Error("SNAPSHOT_ID must be latest or an 8-64 character hex ID");

  const eligible = snapshots.filter(
    (snapshot) =>
      typeof snapshot?.id === "string" &&
      snapshot.hostname === expectedHost &&
      Array.isArray(snapshot.tags) &&
      snapshot.tags.includes(expectedTag),
  );
  if (request !== "latest") {
    const matches = eligible.filter(
      (snapshot) =>
        snapshot.id.toLowerCase().startsWith(request.toLowerCase()) ||
        String(snapshot.short_id ?? "").toLowerCase() === request.toLowerCase(),
    );
    if (matches.length !== 1)
      throw new Error("Exact requested snapshot was not uniquely found");
    return matches[0];
  }

  if (eligible.length === 0)
    throw new Error("No snapshot matched the expected host and tag");
  return eligible.toSorted((left, right) => {
    const timeOrder = String(right.time ?? "").localeCompare(
      String(left.time ?? ""),
    );
    return timeOrder || right.id.localeCompare(left.id);
  })[0];
}

export function assertIsolatedComposeConfig(
  config,
  {
    projectName,
    mediaSource,
    buildRevision,
    mediaTarget = "/srv/arken-space/media",
    databaseName = "arken",
  },
) {
  validateRestoreProjectName(projectName);
  if (config.name !== projectName)
    throw new Error("Compose config resolved an unexpected project name");

  const services = config.services ?? {};
  const serviceNames = Object.keys(services).sort();
  if (JSON.stringify(serviceNames) !== JSON.stringify(["postgres", "server"]))
    throw new Error("Restore Compose may contain only postgres and server");

  for (const [name, service] of Object.entries(services)) {
    if (service.ports?.length)
      throw new Error("Restore service " + name + " must not publish ports");
    if (service.network_mode === "host")
      throw new Error("Restore service " + name + " must not use host network");
    if (service.privileged)
      throw new Error("Restore service " + name + " must not be privileged");
    for (const volume of service.volumes ?? []) {
      const source = String(volume.source ?? "");
      if (/docker\.sock/i.test(source))
        throw new Error("Restore Compose must not mount the Docker socket");
    }
  }

  const postgresVolumes = services.postgres?.volumes ?? [];
  if (
    postgresVolumes.length !== 1 ||
    postgresVolumes[0].type !== "volume" ||
    postgresVolumes[0].target !== "/var/lib/postgresql/data"
  )
    throw new Error("Restore PostgreSQL must use one project-scoped volume");

  const serverVolumes = services.server?.volumes ?? [];
  const expectedMedia = path.resolve(mediaSource);
  if (
    typeof mediaTarget !== "string" ||
    !/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(mediaTarget) ||
    mediaTarget === "/" ||
    path.posix.normalize(mediaTarget) !== mediaTarget ||
    mediaTarget
      .split("/")
      .some((segment) => segment === "." || segment === "..") ||
    !/^[A-Za-z0-9_]+$/.test(databaseName)
  )
    throw new Error("Restore media target or database name is invalid");
  if (
    serverVolumes.length !== 1 ||
    serverVolumes[0].type !== "bind" ||
    path.resolve(serverVolumes[0].source) !== expectedMedia ||
    serverVolumes[0].target !== mediaTarget
  )
    throw new Error("Restore server must mount only restored temporary media");
  const productionMedia = path.resolve(
    "/home/uixray/apps/arken-space-data/media",
  );
  if (expectedMedia === productionMedia)
    throw new Error("Restore media source points at production");

  const serverEnvironment = environmentObject(services.server?.environment);
  if (serverEnvironment.BUILD_REVISION !== buildRevision)
    throw new Error("Restore Compose build revision is not exact");
  let databaseUrl;
  try {
    databaseUrl = new URL(serverEnvironment.DATABASE_URL);
  } catch {
    throw new Error("Restore database URL must target isolated postgres");
  }
  if (
    databaseUrl.protocol !== "postgres:" ||
    databaseUrl.hostname !== "postgres" ||
    databaseUrl.port !== "5432" ||
    decodeURIComponent(databaseUrl.pathname.slice(1)) !== databaseName ||
    databaseUrl.username !== "arken" ||
    !databaseUrl.password ||
    databaseUrl.search ||
    databaseUrl.hash
  )
    throw new Error("Restore database URL must target isolated postgres");
  const postgresEnvironment = environmentObject(services.postgres?.environment);
  if (
    postgresEnvironment.POSTGRES_USER !== "arken" ||
    postgresEnvironment.POSTGRES_DB !== databaseName ||
    !postgresEnvironment.POSTGRES_PASSWORD
  )
    throw new Error(
      "Restore PostgreSQL identity does not match requested database",
    );
  if (serverEnvironment.MEDIA_ROOT !== mediaTarget)
    throw new Error(
      "Restore server media root does not match captured container path",
    );
}

export function isTransientPostgresStartupError(output) {
  return /(?:database system is starting up|the database system is starting up|the database system is not yet accepting connections)/i.test(
    String(output ?? ""),
  );
}

export function resolvePostgresReadinessPolicy(environment = {}) {
  const timeoutMs = Number(
    environment.ARKEN_RESTORE_POSTGRES_READY_TIMEOUT_MS ?? 60_000,
  );
  const retryDelayMs = Number(
    environment.ARKEN_RESTORE_POSTGRES_RETRY_DELAY_MS ?? 1_000,
  );
  const restoreAttempts = Number(
    environment.ARKEN_RESTORE_POSTGRES_RESTORE_ATTEMPTS ?? 3,
  );
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 300_000)
    throw new Error(
      "ARKEN_RESTORE_POSTGRES_READY_TIMEOUT_MS must be an integer from 5000 to 300000",
    );
  if (
    !Number.isInteger(retryDelayMs) ||
    retryDelayMs < 100 ||
    retryDelayMs > 10_000
  )
    throw new Error(
      "ARKEN_RESTORE_POSTGRES_RETRY_DELAY_MS must be an integer from 100 to 10000",
    );
  if (
    !Number.isInteger(restoreAttempts) ||
    restoreAttempts < 1 ||
    restoreAttempts > 5
  )
    throw new Error(
      "ARKEN_RESTORE_POSTGRES_RESTORE_ATTEMPTS must be an integer from 1 to 5",
    );
  return { timeoutMs, retryDelayMs, restoreAttempts };
}
