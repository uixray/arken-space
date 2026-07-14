import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  buildComposeArgs,
  resetSql,
  writeAuditReceipt,
} from "../scripts/run-gameplay-reset-safe.mjs";

const root = process.cwd();
const campaign = "00000000-0000-0000-0000-000000000001";
const gm = "00000000-0000-0000-0000-000000000002";

describe("isolated operator CLI boundary", () => {
  it("executes the real entry point only with explicit isolation guards", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "arken-reset-cli-"));
    const calls = path.join(directory, "calls.txt");
    const receipt = path.join(directory, "receipt.json");
    const adapter = fileURLToPath(
      new URL("./fixtures/reset-cli-adapter.mjs", import.meta.url),
    );
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts/run-gameplay-reset-safe.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "test",
          ARKEN_RESET_ISOLATED: "true",
          ARKEN_RESET_TEST_ADAPTER: adapter,
          ARKEN_RESET_TEST_CALLS: calls,
          ARKEN_RESET_TEST_RECEIPT: receipt,
          ARKEN_RESET_CAMPAIGN_ID: campaign,
          ARKEN_RESET_GM_MEMBERSHIP_ID: gm,
          ARKEN_RESET_BUILD_REVISION: "test-revision",
          ARKEN_RESET_SCHEMA_VERSION: "2",
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual([
      "backup:exact-snapshot",
      "rehearse:abcdef1234567890",
      "maintenance",
      "maintenance-health",
      "transaction",
      "restart",
      "postverify",
      "receipt",
    ]);
    expect(JSON.parse(readFileSync(receipt, "utf8"))).toMatchObject({
      snapshotId: "abcdef1234567890",
      reportHash: "report-hash",
      authorizesReset: false,
      before: { campaigns: 1, assets: 1, playerMemberships: 1, scenes: 1 },
      after: {
        campaigns: 1,
        assets: 1,
        playerMemberships: 0,
        scenes: 0,
        playerSessions: 0,
        gmSessions: 1,
        playerAccessGrants: 0,
        activeSceneId: null,
        foreignCampaigns: 1,
      },
    });
    if (process.platform !== "win32")
      expect(statSync(receipt).mode & 0o777).toBe(0o600);
  });

  it("generates one explicit PostgreSQL transaction with hard campaign scoping", () => {
    const sql = resetSql(campaign, gm);
    expect(sql.startsWith("begin;\n")).toBe(true);
    expect(sql.endsWith("\ncommit;")).toBe(true);
    expect(sql).toContain("RETAINED_GM_INVALID");
    expect(sql).toContain("active_scene_id = null");
    expect(sql).not.toContain("$1");
    expect(sql).not.toContain("$2");
  });

  it("constructs the exact production Compose target and writes a private receipt", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "arken-reset-production-"),
    );
    const receipt = path.join(directory, "receipt.json");
    expect(
      buildComposeArgs({
        APP_ROOT: "/srv/arken",
        PRODUCTION_COMPOSE_PROJECT: "arken-space",
      }),
    ).toEqual([
      "compose",
      "--project-name",
      "arken-space",
      "--project-directory",
      "/srv/arken",
      "--file",
      path.resolve("/srv/arken", "docker-compose.yml"),
    ]);
    writeAuditReceipt(receipt, { authorizesReset: false });
    expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual({
      authorizesReset: false,
    });
    if (process.platform !== "win32")
      expect(statSync(receipt).mode & 0o777).toBe(0o600);
  });

  it("executes generated reset SQL against a disposable PostgreSQL database", async () => {
    const database = new PGlite();
    const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
    for (const file of (await readdir(migrationsUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await database.exec(
        (await readFile(new URL(file, migrationsUrl), "utf8")).replaceAll(
          "--> statement-breakpoint",
          "",
        ),
      );
    const player = "00000000-0000-0000-0000-000000000003";
    await database.exec(
      `insert into campaigns(id,name) values('${campaign}','C'); insert into memberships(id,campaign_id,role,display_name) values('${gm}','${campaign}','GM','GM'),('${player}','${campaign}','PLAYER','P'); insert into assets(campaign_id,uploaded_by_membership_id,kind,name,storage_key,mime_type,size_bytes) values('${campaign}','${player}','IMAGE','A','a','image/png',1);`,
    );
    await database.exec(resetSql(campaign, gm));
    const result = await database.query<{
      players: number;
      assets: number;
      owner: string;
    }>(
      `select (select count(*) from memberships where campaign_id='${campaign}' and role='PLAYER') players,(select count(*) from assets where campaign_id='${campaign}') assets,(select uploaded_by_membership_id from assets where campaign_id='${campaign}') owner`,
    );
    expect(result.rows[0]).toMatchObject({ players: 0, assets: 1, owner: gm });
    await database.close();
  });
});
