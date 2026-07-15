import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertIsolatedComposeConfig,
  compareDatabaseCounts,
  parseDatabaseCounts,
  resolveRestoredPath,
  validateRestoreProjectName,
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
  expect(calls).toHaveLength(16);
  expect(calls[0][0]).toMatch(/select id/);
  expect(calls[1][0]).toMatch(/update assets/);
  expect(calls.at(-1)[0]).toMatch(/delete from memberships/);
});

describe("operator gameplay reset orchestration", () => {
  const names = [
    "database-dump-checksum",
    "media-checksums",
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
