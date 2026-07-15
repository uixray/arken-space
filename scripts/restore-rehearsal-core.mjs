import path from "node:path";

const restoreProjectPattern = /^arken-restore-[a-z0-9][a-z0-9_-]*$/;

const applicationCountTables = new Set([
  "action_journal",
  "assets",
  "audio_states",
  "campaigns",
  "catalog_entries",
  "character_catalog_entries",
  "characters",
  "chat_messages",
  "drawings",
  "fog_reveals",
  "game_events",
  "invites",
  "memberships",
  "player_access_grants",
  "scenes",
  "sessions",
  "token_controllers",
  "token_definitions",
  "tokens",
]);

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

export function buildDatabaseCountsQuery(expectedCounts) {
  const tables = Object.keys(expectedCounts).sort();
  if (tables.length === 0) throw new Error("Database count manifest is empty");
  for (const table of tables) {
    if (!applicationCountTables.has(table))
      throw new Error(
        `Database count manifest contains unknown table: ${table}`,
      );
  }
  return (
    tables
      .map(
        (table, index) =>
          `${index === 0 ? "SELECT" : "UNION ALL SELECT"} '${table}', count(*)::bigint FROM ${table}`,
      )
      .join("\n") + "\nORDER BY 1;\n"
  );
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
  { projectName, mediaSource, buildRevision },
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
    serverVolumes.length !== 1 ||
    serverVolumes[0].type !== "bind" ||
    path.resolve(serverVolumes[0].source) !== expectedMedia ||
    serverVolumes[0].target !== "/srv/arken-space/media"
  )
    throw new Error("Restore server must mount only restored temporary media");
  const productionMedia = path.resolve(
    "/srv/arken-space-data/media",
  );
  if (expectedMedia === productionMedia)
    throw new Error("Restore media source points at production");

  const serverEnvironment = environmentObject(services.server?.environment);
  if (serverEnvironment.BUILD_REVISION !== buildRevision)
    throw new Error("Restore Compose build revision is not exact");
  if (!/@postgres:5432\/arken$/.test(serverEnvironment.DATABASE_URL ?? ""))
    throw new Error("Restore database URL must target isolated postgres");
}
