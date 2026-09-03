import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: PGlite;

interface AssignmentFixture {
  campaignId: string;
  gmId: string;
  characterId: string;
  packId: string;
  packVersionId: string;
  schoolId: string;
  foreignCampaignId: string;
  foreignGmId: string;
  foreignCharacterId: string;
  foreignPackId: string;
  foreignPackVersionId: string;
}

function json(value: unknown): string {
  return JSON.stringify(value).replaceAll("'", "''");
}

function assignmentSnapshot(input: {
  assignmentId: string;
  assignmentVersionId: string;
  packId: string;
  packVersionId: string;
  schoolId: string;
}) {
  return {
    schemaVersion: 1,
    assignmentId: input.assignmentId,
    assignmentVersionId: input.assignmentVersionId,
    assignmentVersion: 1,
    packId: input.packId,
    packVersionId: input.packVersionId,
    packLifecycle: "ACTIVE",
    kind: "SCHOOL",
    schoolId: input.schoolId,
    nodeId: null,
    rank: null,
    provenance: {},
    school: {},
  };
}

async function createFixture(): Promise<AssignmentFixture> {
  const fixture: AssignmentFixture = {
    campaignId: randomUUID(),
    gmId: randomUUID(),
    characterId: randomUUID(),
    packId: randomUUID(),
    packVersionId: randomUUID(),
    schoolId: randomUUID(),
    foreignCampaignId: randomUUID(),
    foreignGmId: randomUUID(),
    foreignCharacterId: randomUUID(),
    foreignPackId: randomUUID(),
    foreignPackVersionId: randomUUID(),
  };
  const activeGraph = (packId: string, versionId: string) =>
    json({
      packId,
      versionId,
      version: 1,
      title: "Fixture",
      lifecycle: "ACTIVE",
      provenance: {},
    });
  await database.exec(`
    insert into campaigns(id,name) values
      ('${fixture.campaignId}','Assignment fixture'),
      ('${fixture.foreignCampaignId}','Foreign assignment fixture');
    insert into memberships(id,campaign_id,role,display_name) values
      ('${fixture.gmId}','${fixture.campaignId}','GM','GM'),
      ('${fixture.foreignGmId}','${fixture.foreignCampaignId}','GM','Foreign GM');
    insert into characters(id,campaign_id,name) values
      ('${fixture.characterId}','${fixture.campaignId}','Hero'),
      ('${fixture.foreignCharacterId}','${fixture.foreignCampaignId}','Foreign hero');
    insert into spell_packs(id,campaign_id) values
      ('${fixture.packId}','${fixture.campaignId}'),
      ('${fixture.foreignPackId}','${fixture.foreignCampaignId}');
    insert into spell_pack_versions(id,campaign_id,pack_id,version,lifecycle,graph) values
      ('${fixture.packVersionId}','${fixture.campaignId}','${fixture.packId}',1,'ACTIVE','${activeGraph(fixture.packId, fixture.packVersionId)}'::jsonb),
      ('${fixture.foreignPackVersionId}','${fixture.foreignCampaignId}','${fixture.foreignPackId}',1,'ACTIVE','${activeGraph(fixture.foreignPackId, fixture.foreignPackVersionId)}'::jsonb);
  `);
  return fixture;
}

async function insertAssignment(
  fixture: AssignmentFixture,
  assignmentId = randomUUID(),
  assignmentVersionId = randomUUID(),
) {
  const snapshot = assignmentSnapshot({
    assignmentId,
    assignmentVersionId,
    packId: fixture.packId,
    packVersionId: fixture.packVersionId,
    schoolId: fixture.schoolId,
  });
  await database.exec(`
    insert into character_spell_assignments(id,campaign_id,character_id,pack_id)
    values ('${assignmentId}','${fixture.campaignId}','${fixture.characterId}','${fixture.packId}');
    insert into character_spell_assignment_versions(
      id,campaign_id,assignment_id,character_id,pack_id,pack_version_id,
      version,kind,school_id,snapshot,assigned_by_membership_id
    ) values (
      '${assignmentVersionId}','${fixture.campaignId}','${assignmentId}',
      '${fixture.characterId}','${fixture.packId}','${fixture.packVersionId}',
      1,'SCHOOL','${fixture.schoolId}','${json(snapshot)}'::jsonb,'${fixture.gmId}'
    );
  `);
  return { assignmentId, assignmentVersionId };
}

beforeAll(async () => {
  database = new PGlite();
  const migrations = new URL("../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(
      (await readFile(new URL(file, migrations), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
});

afterAll(async () => database.close());

describe("UIX-577 spell-assignment persistence", () => {
  it("keeps the legacy catalog intact without inventing assignment rows", async () => {
    const campaignId = randomUUID();
    await database.exec(`
      insert into campaigns(id,name) values ('${campaignId}','Legacy catalog');
      insert into catalog_entries(campaign_id,kind,name,data)
      values ('${campaignId}','ABILITY','Legacy spell','{"legacySpell":true}'::jsonb);
    `);
    const result = await database.query<{
      catalog_entries: number;
      assignments: number;
      versions: number;
    }>(`select
      (select count(*)::int from catalog_entries where campaign_id='${campaignId}') catalog_entries,
      (select count(*)::int from character_spell_assignments where campaign_id='${campaignId}') assignments,
      (select count(*)::int from character_spell_assignment_versions where campaign_id='${campaignId}') versions`);
    expect(result.rows[0]).toEqual({
      catalog_entries: 1,
      assignments: 0,
      versions: 0,
    });
  });

  it("stores an immutable version and only removes history through its parent cascade", async () => {
    const fixture = await createFixture();
    const { assignmentId, assignmentVersionId } =
      await insertAssignment(fixture);
    const stored = await database.query<{
      assignment_id: string;
      snapshot: { assignmentVersionId: string };
    }>(
      `select assignment_id,snapshot from character_spell_assignment_versions where id='${assignmentVersionId}'`,
    );
    expect(stored.rows[0]).toMatchObject({
      assignment_id: assignmentId,
      snapshot: { assignmentVersionId },
    });

    await expect(
      database.exec(
        `update character_spell_assignments set pack_id='${fixture.foreignPackId}' where id='${assignmentId}'`,
      ),
    ).rejects.toThrow(/identity is immutable/);
    await expect(
      database.exec(
        `update character_spell_assignment_versions set override_reason='rewrite' where id='${assignmentVersionId}'`,
      ),
    ).rejects.toThrow(/history is immutable/);
    await expect(
      database.exec(
        `delete from character_spell_assignment_versions where id='${assignmentVersionId}'`,
      ),
    ).rejects.toThrow(/history is immutable/);
    await expect(
      database.exec(`delete from memberships where id='${fixture.gmId}'`),
    ).rejects.toThrow();

    await database.exec(
      `delete from character_spell_assignments where id='${assignmentId}'`,
    );
    const remaining = await database.query<{ count: number }>(
      `select count(*)::int count from character_spell_assignment_versions where assignment_id='${assignmentId}'`,
    );
    expect(remaining.rows[0]?.count).toBe(0);
  });

  it("rejects cross-campaign identities, malformed snapshots, and blank override reasons", async () => {
    const fixture = await createFixture();
    await expect(
      database.exec(`insert into character_spell_assignments(id,campaign_id,character_id,pack_id)
        values ('${randomUUID()}','${fixture.campaignId}','${fixture.foreignCharacterId}','${fixture.packId}')`),
    ).rejects.toThrow();
    await expect(
      database.exec(`insert into character_spell_assignments(id,campaign_id,character_id,pack_id)
        values ('${randomUUID()}','${fixture.campaignId}','${fixture.characterId}','${fixture.foreignPackId}')`),
    ).rejects.toThrow();

    const assignmentId = randomUUID();
    await database.exec(`insert into character_spell_assignments(id,campaign_id,character_id,pack_id)
      values ('${assignmentId}','${fixture.campaignId}','${fixture.characterId}','${fixture.packId}')`);
    const insertVersion = (input: {
      versionId: string;
      packVersionId?: string;
      actorId?: string;
      overrideReason?: string | null;
      snapshotAssignmentId?: string;
    }) => {
      const packVersionId = input.packVersionId ?? fixture.packVersionId;
      const snapshot = assignmentSnapshot({
        assignmentId: input.snapshotAssignmentId ?? assignmentId,
        assignmentVersionId: input.versionId,
        packId: fixture.packId,
        packVersionId,
        schoolId: fixture.schoolId,
      });
      const reason =
        input.overrideReason === undefined || input.overrideReason === null
          ? "null"
          : `'${input.overrideReason.replaceAll("'", "''")}'`;
      return database.exec(`insert into character_spell_assignment_versions(
        id,campaign_id,assignment_id,character_id,pack_id,pack_version_id,
        version,kind,school_id,snapshot,override_reason,assigned_by_membership_id
      ) values (
        '${input.versionId}','${fixture.campaignId}','${assignmentId}',
        '${fixture.characterId}','${fixture.packId}','${packVersionId}',1,
        'SCHOOL','${fixture.schoolId}','${json(snapshot)}'::jsonb,${reason},
        '${input.actorId ?? fixture.gmId}'
      )`);
    };

    await expect(
      insertVersion({
        versionId: randomUUID(),
        packVersionId: fixture.foreignPackVersionId,
      }),
    ).rejects.toThrow();
    await expect(
      insertVersion({ versionId: randomUUID(), actorId: fixture.foreignGmId }),
    ).rejects.toThrow();
    await expect(
      insertVersion({
        versionId: randomUUID(),
        snapshotAssignmentId: randomUUID(),
      }),
    ).rejects.toThrow();
    await expect(
      insertVersion({ versionId: randomUUID(), overrideReason: "   " }),
    ).rejects.toThrow();
  });

  it("cascades one campaign while retaining another campaign's assignment history", async () => {
    const fixture = await createFixture();
    await insertAssignment(fixture);
    const foreignAssignmentId = randomUUID();
    const foreignVersionId = randomUUID();
    const foreignSnapshot = assignmentSnapshot({
      assignmentId: foreignAssignmentId,
      assignmentVersionId: foreignVersionId,
      packId: fixture.foreignPackId,
      packVersionId: fixture.foreignPackVersionId,
      schoolId: randomUUID(),
    });
    await database.exec(`
      insert into character_spell_assignments(id,campaign_id,character_id,pack_id)
      values ('${foreignAssignmentId}','${fixture.foreignCampaignId}','${fixture.foreignCharacterId}','${fixture.foreignPackId}');
      insert into character_spell_assignment_versions(
        id,campaign_id,assignment_id,character_id,pack_id,pack_version_id,
        version,kind,school_id,snapshot,assigned_by_membership_id
      ) values (
        '${foreignVersionId}','${fixture.foreignCampaignId}','${foreignAssignmentId}',
        '${fixture.foreignCharacterId}','${fixture.foreignPackId}','${fixture.foreignPackVersionId}',
        1,'SCHOOL','${foreignSnapshot.schoolId}','${json(foreignSnapshot)}'::jsonb,'${fixture.foreignGmId}'
      );
      delete from campaigns where id='${fixture.campaignId}';
    `);
    const counts = await database.query<{
      target_assignments: number;
      target_versions: number;
      foreign_assignments: number;
      foreign_versions: number;
    }>(`select
      (select count(*)::int from character_spell_assignments where campaign_id='${fixture.campaignId}') target_assignments,
      (select count(*)::int from character_spell_assignment_versions where campaign_id='${fixture.campaignId}') target_versions,
      (select count(*)::int from character_spell_assignments where campaign_id='${fixture.foreignCampaignId}') foreign_assignments,
      (select count(*)::int from character_spell_assignment_versions where campaign_id='${fixture.foreignCampaignId}') foreign_versions`);
    expect(counts.rows[0]).toEqual({
      target_assignments: 0,
      target_versions: 0,
      foreign_assignments: 1,
      foreign_versions: 1,
    });
  });
});
