import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  SpellPackLifecycle,
  SpellProgressionGraph,
  SpellSchool,
} from "@arken/contracts";
import * as schema from "../packages/db/src/schema.js";
import { ensureSeed } from "../apps/server/src/seed.js";
import {
  appendSpellPackVersion,
  createSpellPack,
  SpellPackStorageError,
} from "../apps/server/src/spell-pack-storage.js";

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
type StorageDatabase = Parameters<typeof createSpellPack>[0];
let migrationCounts: { packs: number; versions: number };
let seededCounts: { packs: number; versions: number };

function storageDb(): StorageDatabase {
  return db as unknown as StorageDatabase;
}

function graph(
  overrides: Partial<SpellProgressionGraph> &
    Pick<SpellProgressionGraph, "packId" | "versionId">,
): SpellProgressionGraph {
  return {
    packId: overrides.packId,
    versionId: overrides.versionId,
    version: 1,
    title: "Test spell pack",
    lifecycle: "DRAFT",
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "UIX-579 test",
      rawSourceText: "Original test wording",
    },
    schools: [],
    nodes: [],
    requirementGroups: [],
    edges: [],
    ...overrides,
  };
}

function duplicateSchoolGraph(packId: string, versionId: string) {
  const school: SpellSchool = {
    id: randomUUID(),
    packId,
    packVersionId: versionId,
    slug: "duplicate",
    sourceName: "Duplicate",
    displayName: "Duplicate",
    description: "",
    visibilityPolicy: "PUBLIC",
    order: 0,
  };
  return graph({ packId, versionId, schools: [school, { ...school }] });
}

async function createCampaign(name: string) {
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({ name })
    .returning();
  if (!campaign) throw new Error("campaign fixture failed");
  return campaign;
}

async function spellCounts() {
  const result = await database.query<{ packs: number; versions: number }>(
    "select (select count(*) from spell_packs) packs, (select count(*) from spell_pack_versions) versions",
  );
  const counts = result.rows[0];
  if (!counts) throw new Error("spell count fixture failed");
  return counts;
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
  db = drizzle(database, { schema });
  migrationCounts = await spellCounts();
  await ensureSeed(storageDb());
  seededCounts = await spellCounts();
});

afterAll(async () => database.close());

describe("UIX-579 spell-pack persistence", () => {
  it("creates empty tables without adding runtime seed content", () => {
    expect(migrationCounts).toEqual({ packs: 0, versions: 0 });
    expect(seededCounts).toEqual({ packs: 0, versions: 0 });
  });

  it("stores version 1 and appends only the next validated snapshot", async () => {
    const campaign = await createCampaign("Monotonic versions");
    const packId = randomUUID();
    const firstGraph = graph({ packId, versionId: randomUUID() });
    const created = await createSpellPack(storageDb(), {
      campaignId: campaign.id,
      graph: firstGraph,
    });
    expect(created.version).toMatchObject({
      id: firstGraph.versionId,
      packId,
      version: 1,
      lifecycle: "DRAFT",
      graph: firstGraph,
    });
    expect(created.warnings).toEqual([]);

    const secondGraph = graph({
      packId,
      versionId: randomUUID(),
      version: 2,
      lifecycle: "REFERENCE",
      title: "Reference version",
      provenance: {
        sourceType: "TRANSCRIBED",
        sourceLabel: "Reference page",
        rawSourceText: "Preserved wording",
      },
    });
    const appended = await appendSpellPackVersion(storageDb(), {
      campaignId: campaign.id,
      graph: secondGraph,
    });
    expect(appended.version.graph).toEqual(secondGraph);
    expect(appended.version.lifecycle).toBe("REFERENCE");

    await expect(
      appendSpellPackVersion(storageDb(), {
        campaignId: campaign.id,
        graph: graph({ packId, versionId: randomUUID(), version: 4 }),
      }),
    ).rejects.toMatchObject({
      code: "SPELL_PACK_VERSION_SEQUENCE_INVALID",
      details: { expectedVersion: 3, actualVersion: 4 },
    });
    const versions = await db
      .select()
      .from(schema.spellPackVersions)
      .where(eq(schema.spellPackVersions.packId, packId));
    expect(versions.map((item) => item.version).sort()).toEqual([1, 2]);
  });

  it("rejects schema and semantic errors before writing partial state", async () => {
    const campaign = await createCampaign("Validation");
    const schemaPackId = randomUUID();
    const invalidSchema = graph({
      packId: schemaPackId,
      versionId: randomUUID(),
    }) as Partial<SpellProgressionGraph>;
    delete invalidSchema.provenance;
    await expect(
      createSpellPack(storageDb(), {
        campaignId: campaign.id,
        graph: invalidSchema,
      }),
    ).rejects.toMatchObject({ code: "SPELL_GRAPH_SCHEMA_INVALID" });

    const semanticPackId = randomUUID();
    await expect(
      createSpellPack(storageDb(), {
        campaignId: campaign.id,
        graph: duplicateSchoolGraph(semanticPackId, randomUUID()),
      }),
    ).rejects.toMatchObject({ code: "SPELL_GRAPH_SEMANTIC_INVALID" });

    const rows = await db
      .select()
      .from(schema.spellPacks)
      .where(eq(schema.spellPacks.campaignId, campaign.id));
    expect(rows).toEqual([]);
  });

  it("rolls back identity when an otherwise valid version insert fails", async () => {
    const campaign = await createCampaign("Atomic rollback");
    const existingPackId = randomUUID();
    const reusedVersionId = randomUUID();
    await createSpellPack(storageDb(), {
      campaignId: campaign.id,
      graph: graph({ packId: existingPackId, versionId: reusedVersionId }),
    });

    const rejectedPackId = randomUUID();
    await expect(
      createSpellPack(storageDb(), {
        campaignId: campaign.id,
        graph: graph({ packId: rejectedPackId, versionId: reusedVersionId }),
      }),
    ).rejects.toThrow();
    const [partialPack] = await db
      .select()
      .from(schema.spellPacks)
      .where(eq(schema.spellPacks.id, rejectedPackId));
    expect(partialPack).toBeUndefined();
  });

  it("enforces duplicate and composite campaign constraints", async () => {
    const own = await createCampaign("Own constraint campaign");
    const foreign = await createCampaign("Foreign constraint campaign");
    const packId = randomUUID();
    const first = graph({ packId, versionId: randomUUID() });
    await createSpellPack(storageDb(), {
      campaignId: own.id,
      graph: first,
    });

    const duplicateVersionId = randomUUID();
    await expect(
      db.insert(schema.spellPackVersions).values({
        id: duplicateVersionId,
        campaignId: own.id,
        packId,
        version: 1,
        lifecycle: "DRAFT",
        graph: graph({ packId, versionId: duplicateVersionId }),
      }),
    ).rejects.toThrow();

    const crossCampaignVersionId = randomUUID();
    await expect(
      db.insert(schema.spellPackVersions).values({
        id: crossCampaignVersionId,
        campaignId: foreign.id,
        packId,
        version: 2,
        lifecycle: "DRAFT",
        graph: graph({
          packId,
          versionId: crossCampaignVersionId,
          version: 2,
        }),
      }),
    ).rejects.toThrow();

    const foreignPackId = randomUUID();
    await createSpellPack(storageDb(), {
      campaignId: foreign.id,
      graph: graph({ packId: foreignPackId, versionId: randomUUID() }),
    });
    const counts = await db
      .select()
      .from(schema.spellPackVersions)
      .where(
        and(
          eq(schema.spellPackVersions.campaignId, foreign.id),
          eq(schema.spellPackVersions.packId, foreignPackId),
        ),
      );
    expect(counts).toHaveLength(1);
  });

  it("fails closed when JSON identity or provenance is absent", async () => {
    const campaign = await createCampaign("Fail closed JSON");
    const packId = randomUUID();
    await db
      .insert(schema.spellPacks)
      .values({ id: packId, campaignId: campaign.id });

    const missingPackId = randomUUID();
    const graphWithoutPackId = graph({
      packId,
      versionId: missingPackId,
    }) as Partial<SpellProgressionGraph>;
    delete graphWithoutPackId.packId;
    await expect(
      db.insert(schema.spellPackVersions).values({
        id: missingPackId,
        campaignId: campaign.id,
        packId,
        version: 1,
        lifecycle: "DRAFT",
        graph: graphWithoutPackId as SpellProgressionGraph,
      }),
    ).rejects.toThrow();

    const missingProvenanceId = randomUUID();
    const graphWithoutProvenance = graph({
      packId,
      versionId: missingProvenanceId,
      version: 2,
    }) as Partial<SpellProgressionGraph>;
    delete graphWithoutProvenance.provenance;
    await expect(
      db.insert(schema.spellPackVersions).values({
        id: missingProvenanceId,
        campaignId: campaign.id,
        packId,
        version: 2,
        lifecycle: "DRAFT",
        graph: graphWithoutProvenance as SpellProgressionGraph,
      }),
    ).rejects.toThrow();

    const mismatchedLifecycleId = randomUUID();
    await expect(
      db.insert(schema.spellPackVersions).values({
        id: mismatchedLifecycleId,
        campaignId: campaign.id,
        packId,
        version: 3,
        lifecycle: "ACTIVE",
        graph: graph({
          packId,
          versionId: mismatchedLifecycleId,
          version: 3,
          lifecycle: "ARCHIVED",
        }),
      }),
    ).rejects.toThrow();
  });

  it("preserves immutable history while allowing pack and campaign cascade", async () => {
    const campaign = await createCampaign("Immutable history");
    const packId = randomUUID();
    const first = graph({
      packId,
      versionId: randomUUID(),
      lifecycle: "ACTIVE",
    });
    await createSpellPack(storageDb(), {
      campaignId: campaign.id,
      graph: first,
    });
    const archived = graph({
      packId,
      versionId: randomUUID(),
      version: 2,
      lifecycle: "ARCHIVED",
    });
    await appendSpellPackVersion(storageDb(), {
      campaignId: campaign.id,
      graph: archived,
    });

    await expect(
      database.exec(
        `update spell_pack_versions set lifecycle='REFERENCE', graph=jsonb_set(graph,'{lifecycle}','"REFERENCE"'::jsonb) where id='${first.versionId}'`,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      database.exec(
        `delete from spell_pack_versions where id='${first.versionId}'`,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      database.exec(
        `update spell_packs set created_at=now() where id='${packId}'`,
      ),
    ).rejects.toThrow(/immutable/);

    const history = await db
      .select()
      .from(schema.spellPackVersions)
      .where(eq(schema.spellPackVersions.packId, packId));
    expect(history.map((item) => item.lifecycle).sort()).toEqual([
      "ACTIVE",
      "ARCHIVED",
    ]);

    await db.delete(schema.spellPacks).where(eq(schema.spellPacks.id, packId));
    expect(
      await db
        .select()
        .from(schema.spellPackVersions)
        .where(eq(schema.spellPackVersions.packId, packId)),
    ).toEqual([]);

    const nestedPackId = randomUUID();
    await createSpellPack(storageDb(), {
      campaignId: campaign.id,
      graph: graph({ packId: nestedPackId, versionId: randomUUID() }),
    });
    await db
      .delete(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id));
    expect(
      await db
        .select()
        .from(schema.spellPackVersions)
        .where(eq(schema.spellPackVersions.packId, nestedPackId)),
    ).toEqual([]);
  });

  it("preserves every explicit lifecycle without automatic promotion", async () => {
    const campaign = await createCampaign("Lifecycle values");
    const lifecycles: SpellPackLifecycle[] = [
      "DRAFT",
      "REFERENCE",
      "ACTIVE",
      "ARCHIVED",
    ];
    for (const lifecycle of lifecycles) {
      const packId = randomUUID();
      const saved = await createSpellPack(storageDb(), {
        campaignId: campaign.id,
        graph: graph({ packId, versionId: randomUUID(), lifecycle }),
      });
      expect(saved.version.lifecycle).toBe(lifecycle);
      expect(saved.version.graph.lifecycle).toBe(lifecycle);
    }
  });

  it("exposes stable error codes instead of requiring text inspection", () => {
    expect(new SpellPackStorageError("SPELL_PACK_NOT_FOUND")).toMatchObject({
      name: "SpellPackStorageError",
      code: "SPELL_PACK_NOT_FOUND",
    });
  });
});
