import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertIsolatedComposeConfig,
  buildDatabaseCountsQuery,
  compareDatabaseCounts,
  compareMigrationLedger,
  compareMigrationLedgerPrefix,
  describeDatabaseCountCoverage,
  isTransientPostgresStartupError,
  parseDatabaseCounts,
  parseMigrationLedger,
  readExpectedMigrationLedger,
  resolvePostgresReadinessPolicy,
  resolveRestoredPath,
  selectResticSnapshot,
  stripRetiredCounts,
  stripSupersedingOnlyCounts,
  validateRestoreProjectName,
  verifyRetiredTableMigration,
  applicationCountTableNames,
} from "../scripts/restore-rehearsal-core.mjs";
import {
  assertVerifiedRehearsal,
  executeGameplayReset,
  gameplayResetStatements,
  orchestrateGameplayReset,
} from "../scripts/gameplay-reset-core.mjs";

const root = process.cwd();

describe("backup and restore safety", () => {
  it("accepts only dedicated restore project names", () => {
    expect(validateRestoreProjectName("arken-restore-test-123")).toBe(
      "arken-restore-test-123",
    );
    expect(() => validateRestoreProjectName("arken-space")).toThrow(
      /must start with arken-restore-/,
    );
    expect(() =>
      validateRestoreProjectName("arken-restore-../../prod"),
    ).toThrow(/shell-safe/);
  });

  it("maps production source paths under the temporary snapshot root", () => {
    const result = resolveRestoredPath(
      path.join(root, "temporary-snapshot"),
      "/home/uixray/apps/arken-space-data/media",
    );
    expect(result).toBe(
      path.join(
        root,
        "temporary-snapshot",
        "home",
        "uixray",
        "apps",
        "arken-space-data",
        "media",
      ),
    );
    expect(() =>
      resolveRestoredPath(path.join(root, "temporary-snapshot"), "../media"),
    ).toThrow(/absolute POSIX path/);
  });

  it("compares exact table counts from the backup manifest", () => {
    const expected = parseDatabaseCounts("campaigns|1\nmemberships|7\n");
    compareDatabaseCounts(
      expected,
      parseDatabaseCounts("campaigns|1\nmemberships|7\n"),
    );
    expect(expected).toEqual({ campaigns: 1, memberships: 7 });
    expect(() =>
      compareDatabaseCounts(expected, {
        campaigns: 1,
        memberships: 6,
      }),
    ).toThrow(/differ from backup manifest/);
    expect(() => parseDatabaseCounts("campaigns|-1")).toThrow(/Invalid/);
  });

  it("labels pre-upgrade manifests as sampled coverage", () => {
    const oldManifest = parseDatabaseCounts(
      "assets|2\ncampaigns|1\ncharacters|6\n" +
        "chat_messages|12\nfog_reveals|3\ngame_events|20\ninvites|0\n" +
        "memberships|7\nscenes|2\nsessions|7\ntokens|8\n",
    );
    const query = buildDatabaseCountsQuery(oldManifest);

    expect(query).toContain("FROM campaigns");
    expect(query).toContain("FROM tokens");
    expect(query).not.toContain("FROM catalog_entries");
    expect(query).not.toContain("FROM token_definitions");
    expect(query).toMatch(/ORDER BY 1;\n$/);
    expect(describeDatabaseCountCoverage(oldManifest)).toMatchObject({
      mode: "sampled",
      countedTables: 11,
      knownPersistedTables: 51,
    });
  });

  it("fully counts every current persisted Drizzle feature table", () => {
    const schema = readFileSync(
      path.join(root, "packages", "db", "src", "schema.ts"),
      "utf8",
    );
    const persistedTables = [...schema.matchAll(/pgTable\(\s*"([^"]+)"/g)]
      .map((match) => match[1])
      .sort();
    const countsSql = readFileSync(
      path.join(root, "infra", "backup", "database-counts.sql"),
      "utf8",
    );
    const countedTables = [...countsSql.matchAll(/^\s+\('([^']+)'\),?$/gm)]
      .map((match) => match[1])
      .sort();
    const syntheticCounts = Object.fromEntries(
      countedTables.map((table) => [table, 0]),
    );

    // Backup coverage is spread across three lists that must agree: the
    // schema's own tables, the SQL allowlist, and
    // `applicationCountTableNames` in restore-rehearsal-core.mjs. Drift
    // between them once silently dropped five tables out of disaster-recovery
    // coverage, so all three are compared directly here. The expected size is
    // derived rather than hardcoded: a hand-maintained number has to be
    // bumped on every migration, which is friction that eventually gets
    // bumped carelessly.
    expect(countedTables).toEqual(persistedTables);
    // Direct three-way comparison. This previously held only transitively,
    // via hardcoded counts inside `describeDatabaseCountCoverage`'s expected
    // shape, which made a drift report as a confusing off-by-N rather than
    // naming the table that went missing.
    expect([...applicationCountTableNames].sort()).toEqual(persistedTables);
    expect(describeDatabaseCountCoverage(syntheticCounts)).toEqual({
      mode: "full",
      countedTables: persistedTables.length,
      knownPersistedTables: persistedTables.length,
      missingTables: [],
    });
  });

  it("accepts a pre-drop backup manifest listing a since-retired table (UIX-382 transition)", () => {
    // Simulates the exact scenario hit deploying UIX-382: a backup taken
    // just before a migrate-and-drop deploy still lists the about-to-be
    // dropped `audio_states` table, since it existed at backup time.
    const preDropManifest = parseDatabaseCounts(
      "assets|2\naudio_states|1\ncampaigns|1\nmemberships|7\n",
    );
    expect(() => describeDatabaseCountCoverage(preDropManifest)).not.toThrow();

    const query = buildDatabaseCountsQuery(preDropManifest);
    expect(query).not.toContain("FROM audio_states");
    expect(query).toContain("FROM campaign_audio_tracks");

    const restoredCounts = {
      assets: 2,
      campaigns: 1,
      memberships: 7,
      campaign_audio_tracks: 1,
    };
    expect(
      verifyRetiredTableMigration(preDropManifest, restoredCounts),
    ).toEqual([
      { retiredTable: "audio_states", supersededBy: "campaign_audio_tracks", rows: 1 },
    ]);
    expect(() =>
      compareDatabaseCounts(
        stripRetiredCounts(preDropManifest),
        stripSupersedingOnlyCounts(preDropManifest, restoredCounts),
      ),
    ).not.toThrow();
  });

  it("catches data loss across a retired-table migration", () => {
    const preDropManifest = parseDatabaseCounts("audio_states|3\n");
    expect(() =>
      verifyRetiredTableMigration(preDropManifest, { campaign_audio_tracks: 2 }),
    ).toThrow(/data may have been lost/);
    expect(() =>
      verifyRetiredTableMigration(preDropManifest, {}),
    ).toThrow(/was not counted/);
  });

  it("does not add superseding-table scaffolding once a manifest is generated post-migration", () => {
    // Once a fresh backup is taken with the new database-counts.sql,
    // audio_states is simply absent and campaign_audio_tracks is a normal
    // manifest entry -- no retired-table machinery should engage.
    const freshManifest = parseDatabaseCounts("campaign_audio_tracks|2\n");
    expect(buildDatabaseCountsQuery(freshManifest)).toContain(
      "FROM campaign_audio_tracks",
    );
    expect(verifyRetiredTableMigration(freshManifest, {})).toEqual([]);
  });

  it("verifies every migration identity in the journal", () => {
    const migrationsDirectory = path.join(root, "packages", "db", "drizzle");
    const expected = readExpectedMigrationLedger({
      journalPath: path.join(migrationsDirectory, "meta", "_journal.json"),
      migrationsDirectory,
    });
    const databaseOutput = expected
      .map((entry, index) => `${index + 1}|${entry.hash}|${entry.createdAt}`)
      .join("\n");
    const actual = parseMigrationLedger(databaseOutput);

    // Length and newest tag are deliberately not pinned here: they change on
    // every migration, and a number that must be hand-bumped each time
    // eventually gets bumped without thought. Journal/file/snapshot
    // consistency is asserted properly in tests/migration-integrity.test.ts;
    // what matters here is that the ledger has content, starts at the real
    // genesis migration, and compares correctly.
    expect(expected.length).toBeGreaterThan(30);
    expect(expected[0].tag).toBe("0000_nasty_emma_frost");
    expect(() => compareMigrationLedger(expected, actual)).not.toThrow();
    expect(() =>
      compareMigrationLedgerPrefix(expected, actual.slice(0, 16)),
    ).not.toThrow();
    expect(() =>
      compareMigrationLedgerPrefix(expected, [
        ...actual.slice(0, 15),
        { ...actual[15], hash: "0".repeat(64) },
      ]),
    ).toThrow(/prefix differs at/);
    expect(() =>
      compareMigrationLedgerPrefix(expected, [
        ...actual,
        { ...actual.at(-1)!, id: actual.length + 1 },
      ]),
    ).toThrow(/exceeds checkout/);
    expect(() =>
      compareMigrationLedger(expected, [
        ...actual.slice(0, -1),
        { ...actual.at(-1)!, hash: "0".repeat(64) },
      ]),
    ).toThrow(/identity differs at 0035_equal_shard/);
  });

  it("writes migration and coverage evidence without invoking restore in tests", () => {
    const runner = readFileSync(
      path.join(root, "scripts", "run-restore-rehearsal.mjs"),
      "utf8",
    );

    expect(runner).toContain('record("database-migration-ledger", "passed"');
    expect(runner).toContain('record("database-migration-prefix", "passed"');
    expect(runner).toContain("report.databaseMigrations =");
    expect(runner).toContain("report.databaseCountCoverage =");
    expect(runner).toContain("compareMigrationLedger(");
    expect(runner).toContain("compareMigrationLedgerPrefix(");
  });

  it("bounds PostgreSQL readiness and retries only startup failures", () => {
    expect(
      isTransientPostgresStartupError(
        "FATAL: the database system is starting up",
      ),
    ).toBe(true);
    expect(
      isTransientPostgresStartupError(
        'pg_restore: ERROR: relation "x" does not exist',
      ),
    ).toBe(false);
    expect(resolvePostgresReadinessPolicy({})).toEqual({
      timeoutMs: 60_000,
      retryDelayMs: 1_000,
      restoreAttempts: 3,
    });
    expect(() =>
      resolvePostgresReadinessPolicy({
        ARKEN_RESTORE_POSTGRES_RESTORE_ATTEMPTS: "0",
      }),
    ).toThrow(/RESTORE_ATTEMPTS/);

    const runner = readFileSync(
      path.join(root, "scripts", "run-restore-rehearsal.mjs"),
      "utf8",
    );
    expect(runner).toContain("waitForPostgresReady()");
    expect(runner).toContain('"postgresql-restore-retry", "waiting"');
  });

  it("builds counts only for existing allowlisted tables", () => {
    const countsSql = readFileSync(
      path.join(root, "infra", "backup", "database-counts.sql"),
      "utf8",
    );
    expect(countsSql).toContain("WHERE to_regclass(");
    expect(countsSql).toContain("\\gexec");
    expect(countsSql).not.toMatch(/^SELECT 'world_maps'.*FROM world_maps$/m);
  });

  it("rejects unknown manifest tables instead of interpolating them", () => {
    expect(() =>
      buildDatabaseCountsQuery({
        campaigns: 1,
        "campaigns; DROP TABLE campaigns; --": 1,
      }),
    ).toThrow(/unknown table/);
  });

  it("selects an exact snapshot from restic multi-group output", () => {
    const snapshots = [
      {
        id: "aaaaaaaa11111111",
        short_id: "aaaaaaaa",
        hostname: "arken-production",
        tags: ["arken-space", "invocation-one"],
        time: "2026-07-14T03:00:00Z",
      },
      {
        id: "bbbbbbbb22222222",
        short_id: "bbbbbbbb",
        hostname: "arken-production",
        tags: ["arken-space", "invocation-two"],
        time: "2026-07-15T03:00:00Z",
      },
    ];
    expect(
      selectResticSnapshot(snapshots, {
        request: "aaaaaaaa",
        expectedHost: "arken-production",
        expectedTag: "arken-space",
      }).id,
    ).toBe("aaaaaaaa11111111");
  });

  it("rejects an unknown exact snapshot and mismatched provenance", () => {
    const snapshots = [
      {
        id: "aaaaaaaa11111111",
        short_id: "aaaaaaaa",
        hostname: "other-host",
        tags: ["arken-space"],
      },
    ];
    expect(() =>
      selectResticSnapshot(snapshots, {
        request: "bbbbbbbb",
        expectedHost: "arken-production",
        expectedTag: "arken-space",
      }),
    ).toThrow(/not uniquely found/);
    expect(() =>
      selectResticSnapshot(snapshots, {
        request: "aaaaaaaa",
        expectedHost: "arken-production",
        expectedTag: "arken-space",
      }),
    ).toThrow(/not uniquely found/);
  });

  it("selects latest deterministically across restic tag groups", () => {
    const snapshots = [
      {
        id: "bbbbbbbb22222222",
        hostname: "arken-production",
        tags: ["arken-space", "invocation-two"],
        time: "2026-07-15T03:00:00Z",
      },
      {
        id: "cccccccc33333333",
        hostname: "arken-production",
        tags: ["arken-space", "invocation-three"],
        time: "2026-07-15T03:00:00Z",
      },
      {
        id: "dddddddd44444444",
        hostname: "arken-production",
        tags: ["unrelated"],
        time: "2026-07-16T03:00:00Z",
      },
    ];
    expect(
      selectResticSnapshot(snapshots, {
        request: "latest",
        expectedHost: "arken-production",
        expectedTag: "arken-space",
      }).id,
    ).toBe("cccccccc33333333");
  });

  it("rejects ports, production media and non-volume PostgreSQL storage", () => {
    const projectName = "arken-restore-test-123";
    const mediaSource = path.join(root, "temporary-snapshot", "media");
    const buildRevision = "abc123";
    const config = {
      name: projectName,
      services: {
        postgres: {
          volumes: [
            {
              type: "volume",
              source: "postgres-data",
              target: "/var/lib/postgresql/data",
            },
          ],
        },
        server: {
          environment: {
            BUILD_REVISION: buildRevision,
            DATABASE_URL: "postgres://arken:restore@postgres:5432/arken",
          },
          volumes: [
            {
              type: "bind",
              source: mediaSource,
              target: "/srv/arken-space/media",
            },
          ],
        },
      },
    };

    expect(() =>
      assertIsolatedComposeConfig(config, {
        projectName,
        mediaSource,
        buildRevision,
      }),
    ).not.toThrow();
    const restoredProductionPath = path.join(
      root,
      "temporary-snapshot",
      "home",
      "uixray",
      "apps",
      "arken-space-data",
      "media",
    );
    expect(() =>
      assertIsolatedComposeConfig(
        {
          ...config,
          services: {
            ...config.services,
            server: {
              ...config.services.server,
              volumes: [
                {
                  type: "bind",
                  source: restoredProductionPath,
                  target: "/srv/arken-space/media",
                },
              ],
            },
          },
        },
        {
          projectName,
          mediaSource: restoredProductionPath,
          buildRevision,
        },
      ),
    ).not.toThrow();

    expect(() =>
      assertIsolatedComposeConfig(
        {
          ...config,
          services: {
            ...config.services,
            server: { ...config.services.server, ports: ["14190:4100"] },
          },
        },
        { projectName, mediaSource, buildRevision },
      ),
    ).toThrow(/must not publish ports/);

    expect(() =>
      assertIsolatedComposeConfig(config, {
        projectName,
        mediaSource: "/home/uixray/apps/arken-space-data/media",
        buildRevision,
      }),
    ).toThrow();
  });

  it("keeps destructive restore behind explicit confirmation", () => {
    const backup = readFileSync(
      path.join(root, "infra", "backup", "backup.sh"),
      "utf8",
    );
    const restore = readFileSync(
      path.join(root, "infra", "backup", "restore.sh"),
      "utf8",
    );
    const compose = readFileSync(
      path.join(root, "docker-compose.restore.yml"),
      "utf8",
    );

    const counts = readFileSync(
      path.join(root, "infra", "backup", "database-counts.sql"),
      "utf8",
    );
    expect(counts).toContain("'player_access_grants'");
    expect(backup).toContain('--project-name "$PRODUCTION_COMPOSE_PROJECT"');
    expect(backup).toContain("compose exec -T postgres");
    expect(backup).toContain("restic check");
    expect(backup).toContain("BACKUP_INVOCATION_ID");
    expect(backup).toContain('--tag "$INVOCATION_TAG"');
    expect(backup).toContain('--tag "$INVOCATION_TAG" |');
    expect(backup).toContain(
      'SNAPSHOT_ARTIFACT_PARTIAL="$SNAPSHOT_ARTIFACT.partial"',
    );
    expect(backup).toContain(
      'mv "$SNAPSHOT_ARTIFACT_PARTIAL" "$SNAPSHOT_ARTIFACT"',
    );
    expect(backup).not.toContain('pg_dump "$DATABASE_URL"');
    expect(restore).toContain(
      'ARKEN_RESTORE_CONFIRM:-}" != "isolated-clean-target',
    );
    expect(restore.indexOf("ARKEN_RESTORE_CONFIRM")).toBeLessThan(
      restore.indexOf("exec node"),
    );
    expect(compose).not.toMatch(/^\s+ports:/m);
    expect(compose).toContain("postgres-data:/var/lib/postgresql/data");
    expect(compose).toContain("MIN_FREE_DISK_BYTES: 1");
  });

  it("binds reset to the snapshot artifact from the backup invocation", () => {
    const runner = readFileSync(
      path.join(root, "scripts", "run-gameplay-reset-safe.mjs"),
      "utf8",
    );
    expect(runner).toContain("BACKUP_SNAPSHOT_ARTIFACT: artifact");
    expect(runner).toContain('readFileSync(artifact, "utf8").trim()');
    expect(runner).not.toContain('"--latest",\n        "1"');
  });
});
it("requires an exact fully verified rehearsal before reset", () => {
  const names = [
    "database-dump-checksum",
    "media-checksums",
    "database-migration-ledger",
    "database-counts",
    "restored-application-health",
    "compose-cleanup",
    "resource-leak-check",
    "restored-data-cleanup",
    "production-health-after",
  ];
  const steps = names.map((name) => ({ name, status: "passed" }));
  const report = { runSucceeded: true, snapshot: { id: "snap-1" }, steps };
  expect(() => assertVerifiedRehearsal(report, "snap-1")).not.toThrow();
  expect(() => assertVerifiedRehearsal(report, "other")).toThrow(/snapshot/);
  expect(() =>
    assertVerifiedRehearsal({ ...report, steps: steps.slice(1) }, "snap-1"),
  ).toThrow(/Missing verified/);
  expect(() =>
    assertVerifiedRehearsal(
      {
        ...report,
        steps: steps.filter(
          (step) => step.name !== "database-migration-ledger",
        ),
      },
      "snap-1",
    ),
  ).toThrow(/database-migration-ledger/);
});
it("keeps assets and GM membership outside the reset plan", () => {
  const sql = gameplayResetStatements("campaign", "gm")
    .map(([text]) => text)
    .join("\n");
  expect(sql).toContain("update assets set uploaded_by_membership_id");
  expect(sql).toContain("update campaigns set active_scene_id = null");
  expect(sql).not.toMatch(/delete from assets/);
  expect(sql).toContain("delete from player_access_grants");
  expect(sql).toContain(
    "delete from memberships where campaign_id = $1 and role = 'PLAYER'",
  );
  expect(sql).not.toMatch(/delete from memberships[^\n]+role = 'GM'/);
});
it("executes the reset plan through one injected transaction", async () => {
  const calls = [];
  const transaction = {
    query: async (statement, params) => {
      calls.push([statement, params]);
      return { rows: statement.startsWith("select id") ? [{ id: "gm" }] : [] };
    },
  };
  await executeGameplayReset(transaction, "campaign", "gm");
  expect(calls).toHaveLength(18);
  expect(calls[0][0]).toMatch(/select id/);
  expect(calls[1][0]).toMatch(/update assets/);
  expect(calls.at(-1)[0]).toMatch(/delete from memberships/);
});

describe("operator gameplay reset orchestration", () => {
  const names = [
    "database-dump-checksum",
    "media-checksums",
    "database-migration-ledger",
    "database-counts",
    "restored-application-health",
    "compose-cleanup",
    "resource-leak-check",
    "restored-data-cleanup",
    "production-health-after",
  ];
  function fixture(overrides = {}) {
    const calls = [];
    const dependencies = {
      readCheckoutRevision: async () => "rev",
      verifyBuild: async () => {
        calls.push("verify-build");
        return { buildRevision: "rev", schemaVersion: 2 };
      },
      createBackup: async () => {
        calls.push("backup");
        return "snap";
      },
      rehearse: async (snapshot) => calls.push(`rehearse:${snapshot}`),
      readRehearsalEvidence: async () => ({
        report: {
          runSucceeded: true,
          snapshot: { id: "snap" },
          productionBefore: { buildRevision: "rev", schemaVersion: 2 },
          steps: names.map((name) => ({
            name,
            status: "passed",
            ...(name === "restored-application-health"
              ? { buildRevision: "rev", schemaVersion: 2 }
              : {}),
          })),
        },
        hash: "report-hash",
      }),
      approveExecution: async () => {
        calls.push("approve");
        return true;
      },
      requestConfirmation: async () => "campaign:snap",
      countState: async () => {
        calls.push("count-before");
        return { assets: 2 };
      },
      enterMaintenance: async () => calls.push("maintenance"),
      verifyMaintenanceBuild: async () => {
        calls.push("maintenance-health");
        return { buildRevision: "rev", schemaVersion: 2 };
      },
      leaveMaintenance: async () => calls.push("leave-maintenance"),
      resetTransaction: async () => calls.push("reset"),
      restartApplication: async () => calls.push("restart"),
      verifyAfter: async () => {
        calls.push("verify-after");
        return { assets: 2, scenes: 0 };
      },
      now: () => new Date("2026-07-14T00:00:00.000Z"),
      writeReceipt: async () => calls.push("receipt"),
      ...overrides,
    };
    return { calls, dependencies };
  }

  it("binds one fresh snapshot through rehearsal, mutation and receipt", async () => {
    const { calls, dependencies } = fixture();
    const receipt = await orchestrateGameplayReset(
      {
        campaignId: "campaign",
        gmMembershipId: "gm",
        expectedBuildRevision: "rev",
        expectedSchemaVersion: 2,
      },
      dependencies,
    );
    expect(calls).toEqual([
      "verify-build",
      "backup",
      "rehearse:snap",
      "approve",
      "count-before",
      "maintenance",
      "maintenance-health",
      "reset",
      "restart",
      "verify-after",
      "receipt",
    ]);
    expect(receipt).toMatchObject({
      snapshotId: "snap",
      reportHash: "report-hash",
      authorizesReset: false,
    });
  });

  it.each([
    ["checkout", { readCheckoutRevision: async () => "other" }],
    ["backup", { createBackup: async () => "latest" }],
    [
      "rehearsal",
      {
        readRehearsalEvidence: async () => ({
          report: { runSucceeded: false },
          hash: "bad",
        }),
      },
    ],
    ["approval", { approveExecution: async () => false }],
  ])("stops before mutation when %s fails", async (_name, override) => {
    const { calls, dependencies } = fixture(override);
    await expect(
      orchestrateGameplayReset(
        {
          campaignId: "campaign",
          gmMembershipId: "gm",
          expectedBuildRevision: "rev",
          expectedSchemaVersion: 2,
        },
        dependencies,
      ),
    ).rejects.toThrow();
    expect(calls).not.toContain("maintenance");
    expect(calls).not.toContain("reset");
  });

  it("recovers maintenance when restart or post-transaction flow fails", async () => {
    const { calls, dependencies } = fixture({
      restartApplication: async () => {
        calls.push("restart");
        throw new Error("restart failed");
      },
    });
    await expect(
      orchestrateGameplayReset(
        {
          campaignId: "campaign",
          gmMembershipId: "gm",
          expectedBuildRevision: "rev",
          expectedSchemaVersion: 2,
        },
        dependencies,
      ),
    ).rejects.toThrow("restart failed");
    expect(calls.slice(-3)).toEqual(["reset", "restart", "leave-maintenance"]);
  });

  it("recovers maintenance without mutating when the second build check fails", async () => {
    const { calls, dependencies } = fixture({
      verifyMaintenanceBuild: async () => ({
        buildRevision: "other",
        schemaVersion: 2,
      }),
    });
    await expect(
      orchestrateGameplayReset(
        {
          campaignId: "campaign",
          gmMembershipId: "gm",
          expectedBuildRevision: "rev",
          expectedSchemaVersion: 2,
        },
        dependencies,
      ),
    ).rejects.toThrow(/Maintenance build/);
    expect(calls).not.toContain("reset");
    expect(calls.at(-1)).toBe("leave-maintenance");
  });
});
