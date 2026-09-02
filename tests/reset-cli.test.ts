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
const foreignCampaign = "00000000-0000-0000-0000-000000000010";
const spellPack = "00000000-0000-0000-0000-000000000020";
const spellPackVersion = "00000000-0000-0000-0000-000000000021";
const foreignSpellPack = "00000000-0000-0000-0000-000000000030";
const foreignSpellPackVersion = "00000000-0000-0000-0000-000000000031";
const character = "00000000-0000-0000-0000-000000000040";
const spellAssignment = "00000000-0000-0000-0000-000000000041";
const spellAssignmentVersion = "00000000-0000-0000-0000-000000000042";
const school = "00000000-0000-0000-0000-000000000043";
const foreignGm = "00000000-0000-0000-0000-000000000011";
const foreignCharacter = "00000000-0000-0000-0000-000000000050";
const foreignSpellAssignment = "00000000-0000-0000-0000-000000000051";
const foreignSpellAssignmentVersion = "00000000-0000-0000-0000-000000000052";
const foreignSchool = "00000000-0000-0000-0000-000000000053";

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
        characterSpellAssignments: 0,
        characterSpellAssignmentVersions: 0,
        spellPacks: 0,
        spellPackVersions: 0,
        activeSceneId: null,
        campaignDay: 1,
        battleActive: false,
        battleCounter: 0,
        campaignRevision: 0,
        foreignCampaigns: 1,
        foreignCharacterSpellAssignments: 1,
        foreignCharacterSpellAssignmentVersions: 1,
        foreignSpellPacks: 1,
        foreignSpellPackVersions: 1,
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
    expect(sql).toContain("day = 1");
    expect(sql).toContain("battle_active = false");
    expect(sql).toContain("battle_counter = 0");
    expect(sql).toContain("revision = 0");
    expect(sql).toContain("delete from character_spell_assignments");
    expect(sql).not.toContain(
      "delete from character_spell_assignment_versions",
    );
    expect(sql).toContain("delete from spell_packs");
    expect(sql).not.toContain("delete from spell_pack_versions");
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
      `insert into campaigns(id,name,day,battle_active,battle_counter,revision) values('${campaign}','C',9,true,4,12),('${foreignCampaign}','Foreign',1,false,0,0);
       insert into memberships(id,campaign_id,role,display_name) values('${gm}','${campaign}','GM','GM'),('${player}','${campaign}','PLAYER','P'),('${foreignGm}','${foreignCampaign}','GM','Foreign GM');
       insert into assets(campaign_id,uploaded_by_membership_id,kind,name,storage_key,mime_type,size_bytes) values('${campaign}','${player}','IMAGE','A','a','image/png',1);
       insert into characters(id,campaign_id,name) values('${character}','${campaign}','Target character'),('${foreignCharacter}','${foreignCampaign}','Foreign character');
       insert into spell_packs(id,campaign_id) values('${spellPack}','${campaign}'),('${foreignSpellPack}','${foreignCampaign}');
       insert into spell_pack_versions(id,campaign_id,pack_id,version,lifecycle,graph) values
         ('${spellPackVersion}','${campaign}','${spellPack}',1,'ACTIVE',jsonb_build_object('packId','${spellPack}','versionId','${spellPackVersion}','version',1,'title','Target','lifecycle','ACTIVE','provenance',jsonb_build_object())),
         ('${foreignSpellPackVersion}','${foreignCampaign}','${foreignSpellPack}',1,'ACTIVE',jsonb_build_object('packId','${foreignSpellPack}','versionId','${foreignSpellPackVersion}','version',1,'title','Foreign','lifecycle','ACTIVE','provenance',jsonb_build_object()));
       insert into character_spell_assignments(id,campaign_id,character_id,pack_id) values
         ('${spellAssignment}','${campaign}','${character}','${spellPack}'),
         ('${foreignSpellAssignment}','${foreignCampaign}','${foreignCharacter}','${foreignSpellPack}');
       insert into character_spell_assignment_versions(id,campaign_id,assignment_id,character_id,pack_id,pack_version_id,version,kind,school_id,snapshot,assigned_by_membership_id) values
         ('${spellAssignmentVersion}','${campaign}','${spellAssignment}','${character}','${spellPack}','${spellPackVersion}',1,'SCHOOL','${school}',jsonb_build_object('schemaVersion',1,'assignmentId','${spellAssignment}','assignmentVersionId','${spellAssignmentVersion}','assignmentVersion',1,'packId','${spellPack}','packVersionId','${spellPackVersion}','packLifecycle','ACTIVE','kind','SCHOOL','schoolId','${school}','nodeId',null,'rank',null,'provenance',jsonb_build_object(),'school',jsonb_build_object()),'${gm}'),
         ('${foreignSpellAssignmentVersion}','${foreignCampaign}','${foreignSpellAssignment}','${foreignCharacter}','${foreignSpellPack}','${foreignSpellPackVersion}',1,'SCHOOL','${foreignSchool}',jsonb_build_object('schemaVersion',1,'assignmentId','${foreignSpellAssignment}','assignmentVersionId','${foreignSpellAssignmentVersion}','assignmentVersion',1,'packId','${foreignSpellPack}','packVersionId','${foreignSpellPackVersion}','packLifecycle','ACTIVE','kind','SCHOOL','schoolId','${foreignSchool}','nodeId',null,'rank',null,'provenance',jsonb_build_object(),'school',jsonb_build_object()),'${foreignGm}');`,
    );
    await database.exec(resetSql(campaign, gm));
    const result = await database.query<{
      players: number;
      assets: number;
      owner: string;
      day: number;
      battle_active: boolean;
      battle_counter: number;
      revision: number;
      spell_packs: number;
      spell_pack_versions: number;
      spell_assignments: number;
      spell_assignment_versions: number;
      foreign_spell_packs: number;
      foreign_spell_pack_versions: number;
      foreign_spell_assignments: number;
      foreign_spell_assignment_versions: number;
    }>(
      `select
         (select count(*) from memberships where campaign_id='${campaign}' and role='PLAYER') players,
         (select count(*) from assets where campaign_id='${campaign}') assets,
         (select uploaded_by_membership_id from assets where campaign_id='${campaign}') owner,
         (select count(*) from spell_packs where campaign_id='${campaign}') spell_packs,
         (select count(*) from spell_pack_versions where campaign_id='${campaign}') spell_pack_versions,
         (select count(*) from character_spell_assignments where campaign_id='${campaign}') spell_assignments,
         (select count(*) from character_spell_assignment_versions where campaign_id='${campaign}') spell_assignment_versions,
         (select count(*) from spell_packs where campaign_id='${foreignCampaign}') foreign_spell_packs,
         (select count(*) from spell_pack_versions where campaign_id='${foreignCampaign}') foreign_spell_pack_versions,
         (select count(*) from character_spell_assignments where campaign_id='${foreignCampaign}') foreign_spell_assignments,
         (select count(*) from character_spell_assignment_versions where campaign_id='${foreignCampaign}') foreign_spell_assignment_versions,
         day,battle_active,battle_counter,revision
       from campaigns where id='${campaign}'`,
    );
    expect(result.rows[0]).toMatchObject({
      players: 0,
      assets: 1,
      owner: gm,
      day: 1,
      battle_active: false,
      battle_counter: 0,
      revision: 0,
      spell_packs: 0,
      spell_pack_versions: 0,
      spell_assignments: 0,
      spell_assignment_versions: 0,
      foreign_spell_packs: 1,
      foreign_spell_pack_versions: 1,
      foreign_spell_assignments: 1,
      foreign_spell_assignment_versions: 1,
    });
    await database.close();
  });
});
