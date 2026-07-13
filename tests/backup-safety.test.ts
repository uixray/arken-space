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

    expect(backup).toContain('--project-name "$PRODUCTION_COMPOSE_PROJECT"');
    expect(backup).toContain("compose exec -T postgres");
    expect(backup).toContain("restic check");
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
});
