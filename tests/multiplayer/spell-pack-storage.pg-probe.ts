import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  campaigns,
  createDatabase,
  spellPackVersions,
  spellPacks,
} from "@arken/db";
import type { SpellProgressionGraph } from "@arken/contracts";
import {
  appendSpellPackVersion,
  createSpellPack,
  SpellPackStorageError,
} from "../../apps/server/src/spell-pack-storage.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for the PostgreSQL probe");

const campaignId = randomUUID();
const foreignCampaignId = randomUUID();
const packId = randomUUID();

function graph(
  version: number,
  versionId: string = randomUUID(),
  lifecycle: SpellProgressionGraph["lifecycle"] = "DRAFT",
): SpellProgressionGraph {
  return {
    packId,
    versionId,
    version,
    title: `PostgreSQL probe v${version}`,
    lifecycle,
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "UIX-579 PostgreSQL 17 probe",
      rawSourceText: `Probe source v${version}`,
    },
    schools: [],
    nodes: [],
    requirementGroups: [],
    edges: [],
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectRejected(
  operation: Promise<unknown>,
  message: string,
): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error(message);
}

const { client, db } = createDatabase(connectionString);

try {
  await db.insert(campaigns).values([
    { id: campaignId, name: "UIX-579 PostgreSQL probe" },
    { id: foreignCampaignId, name: "UIX-579 foreign probe" },
  ]);

  await createSpellPack(db, {
    campaignId,
    graph: graph(1),
  });
  await appendSpellPackVersion(db, {
    campaignId,
    graph: graph(2, randomUUID(), "REFERENCE"),
  });

  // Two writers offer the same next number. The parent row lock must let one
  // commit version 3 and make the other re-read max(version)=3 and reject.
  const concurrent = await Promise.allSettled([
    appendSpellPackVersion(db, {
      campaignId,
      graph: graph(3, randomUUID(), "ARCHIVED"),
    }),
    appendSpellPackVersion(db, {
      campaignId,
      graph: graph(3, randomUUID(), "ARCHIVED"),
    }),
  ]);
  const fulfilled = concurrent.filter(
    (result) => result.status === "fulfilled",
  );
  const rejected = concurrent.filter((result) => result.status === "rejected");
  assert(fulfilled.length === 1, "exactly one concurrent append must commit");
  assert(rejected.length === 1, "exactly one concurrent append must reject");
  const rejection = rejected[0];
  assert(rejection?.status === "rejected", "missing rejected append result");
  assert(
    rejection.reason instanceof SpellPackStorageError &&
      rejection.reason.code === "SPELL_PACK_VERSION_SEQUENCE_INVALID",
    "concurrent loser must fail with the stable sequence error",
  );

  const history = await db
    .select({ version: spellPackVersions.version })
    .from(spellPackVersions)
    .where(
      and(
        eq(spellPackVersions.campaignId, campaignId),
        eq(spellPackVersions.packId, packId),
      ),
    )
    .orderBy(asc(spellPackVersions.version));
  assert(
    JSON.stringify(history.map((row) => row.version)) === "[1,2,3]",
    "concurrent append must leave monotonic history 1,2,3",
  );

  const foreignError = await expectRejected(
    appendSpellPackVersion(db, {
      campaignId: foreignCampaignId,
      graph: graph(4),
    }),
    "cross-campaign append unexpectedly succeeded",
  );
  assert(
    foreignError instanceof SpellPackStorageError &&
      foreignError.code === "SPELL_PACK_NOT_FOUND",
    "cross-campaign storage lookup must fail closed",
  );

  const corruptVersionId = randomUUID();
  await expectRejected(
    db.insert(spellPackVersions).values({
      id: corruptVersionId,
      campaignId: foreignCampaignId,
      packId,
      version: 4,
      lifecycle: "DRAFT",
      graph: graph(4, corruptVersionId),
    }),
    "composite campaign foreign key accepted corruption",
  );

  const firstVersion = await db
    .select({ id: spellPackVersions.id })
    .from(spellPackVersions)
    .where(
      and(
        eq(spellPackVersions.campaignId, campaignId),
        eq(spellPackVersions.packId, packId),
        eq(spellPackVersions.version, 1),
      ),
    )
    .limit(1);
  assert(firstVersion[0], "version 1 disappeared before immutability probe");
  await expectRejected(
    db
      .update(spellPackVersions)
      .set({
        graph: graph(1, firstVersion[0].id, "ACTIVE"),
        lifecycle: "ACTIVE",
      })
      .where(eq(spellPackVersions.id, firstVersion[0].id)),
    "immutable version update unexpectedly succeeded",
  );
  await expectRejected(
    db
      .delete(spellPackVersions)
      .where(eq(spellPackVersions.id, firstVersion[0].id)),
    "direct version delete unexpectedly succeeded",
  );

  // Parent deletion is the explicit gameplay-reset path and must be the only
  // way to cascade version history.
  await db.delete(spellPacks).where(eq(spellPacks.id, packId));
  const afterPackDelete = await db
    .select({ id: spellPackVersions.id })
    .from(spellPackVersions)
    .where(eq(spellPackVersions.packId, packId));
  assert(
    afterPackDelete.length === 0,
    "pack cascade left version history behind",
  );

  const nestedPackId = randomUUID();
  await createSpellPack(db, {
    campaignId,
    graph: { ...graph(1), packId: nestedPackId, versionId: randomUUID() },
  });
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  const afterCampaignDelete = await db
    .select({ id: spellPackVersions.id })
    .from(spellPackVersions)
    .where(eq(spellPackVersions.packId, nestedPackId));
  assert(
    afterCampaignDelete.length === 0,
    "campaign cascade left spell-pack history behind",
  );

  console.log("[spell-pack-probe] passed");
} finally {
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  await db.delete(campaigns).where(eq(campaigns.id, foreignCampaignId));
  await client.end();
}
