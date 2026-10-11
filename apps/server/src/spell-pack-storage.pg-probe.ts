import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import {
  campaigns,
  createDatabase,
  gameEvents,
  memberships,
  sessions,
  spellPackVersions,
  spellPacks,
} from "@arken/db";
import type { SpellProgressionGraph } from "@arken/contracts";
import {
  appendSpellPackVersion,
  createSpellPack,
  SpellPackStorageError,
} from "./spell-pack-storage.js";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerSpellPackRoutes } from "./spell-pack-routes.js";
import {
  classifyProbeDiagnostic,
  deriveMigrationIdentity,
  isSafeApiErrorCode,
  ProbeAssertionError,
  ProbePreflightError,
  requiredMembershipColumns,
  requiredRoleLabels,
  validateMigrationPreflight,
} from "../../../packages/db/src/multiplayer-migration-preflight.mjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for the PostgreSQL probe");

const campaignId = randomUUID();
const foreignCampaignId = randomUUID();
const packId = randomUUID();
const apiCampaignId = randomUUID();
const apiForeignCampaignId = randomUUID();
let apiApp: FastifyInstance | undefined;

function graphFor(
  targetPackId: string,
  version: number,
  versionId: string = randomUUID(),
  lifecycle: SpellProgressionGraph["lifecycle"] = "DRAFT",
): SpellProgressionGraph {
  return {
    packId: targetPackId,
    versionId,
    version,
    title: `PostgreSQL probe v${version}`,
    lifecycle,
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "UIX-579/UIX-580 PostgreSQL 17 probe",
      rawSourceText: `Private probe mechanics v${version}`,
    },
    schools: [],
    nodes: [],
    requirementGroups: [],
    edges: [],
  };
}

function graph(
  version: number,
  versionId: string = randomUUID(),
  lifecycle: SpellProgressionGraph["lifecycle"] = "DRAFT",
): SpellProgressionGraph {
  return graphFor(packId, version, versionId, lifecycle);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ProbeAssertionError(message);
}

function safeApiErrorCode(response: { json: () => unknown }): string {
  try {
    const error = (response.json() as { error?: unknown }).error;
    return isSafeApiErrorCode(error) ? error : "UNRECOGNIZED";
  } catch {
    return "UNRECOGNIZED";
  }
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
  throw new ProbeAssertionError(message);
}

/** Preserve a diagnostic cause, but never attach raw PostgreSQL connection details. */
function probeFailure(code: string, error: unknown): Error {
  return new Error(code, { cause: new Error(safeProbeDiagnostic(error)) });
}

function safeProbeDiagnostic(error: unknown): string {
  return classifyProbeDiagnostic(error);
}

const { client, db } = createDatabase(connectionString);

async function verifyMigrationAndFixtureSchema(): Promise<void> {
  let expected: ReturnType<typeof deriveMigrationIdentity>;
  try {
    expected = JSON.parse(
      process.env.E2E_EXPECTED_MIGRATION_IDENTITY ?? "null",
    ) as ReturnType<typeof deriveMigrationIdentity>;
  } catch {
    throw new ProbePreflightError("EXPECTED_IDENTITY_REQUIRED");
  }
  if (
    !expected ||
    !Number.isInteger(expected.count) ||
    typeof expected.journalSha256 !== "string" ||
    typeof expected.manifestSha256 !== "string" ||
    !Array.isArray(expected.migrationHashes)
  )
    throw new ProbePreflightError("EXPECTED_IDENTITY_REQUIRED");

  const migrationDirectory = new URL(
    "../../../packages/db/drizzle/",
    import.meta.url,
  );
  const source = deriveMigrationIdentity(migrationDirectory);

  const ledger = await client.unsafe<{ hash: string }[]>(
    'select hash from "drizzle"."__drizzle_migrations" order by id asc',
  );
  const membershipColumns = await client.unsafe<{ column_name: string }[]>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'memberships' order by column_name",
  );
  const roleLabels = await client.unsafe<{ enumlabel: string }[]>(
    "select e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typname = 'role' order by e.enumsortorder",
  );
  validateMigrationPreflight(expected, {
    source,
    ledgerHashes: ledger.map((row) => row.hash),
    membershipColumns: membershipColumns.map((row) => row.column_name),
    roleLabels: roleLabels.map((row) => row.enumlabel),
  });
  console.log(
    `[spell-pack-preflight] passed migrations=${source.count} membershipColumns=${requiredMembershipColumns.length} roleLabels=${requiredRoleLabels.length}`,
  );
}

try {
  await verifyMigrationAndFixtureSchema();
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

  const apiGmMembershipId = randomUUID();
  const apiPlayerMembershipId = randomUUID();
  const apiForeignGmMembershipId = randomUUID();
  const apiGmSecret = "uix580-gm-".padEnd(40, "g");
  const apiPlayerSecret = "uix580-player-".padEnd(40, "p");
  const apiForeignGmSecret = "uix580-foreign-".padEnd(40, "f");
  await db.insert(campaigns).values([
    { id: apiCampaignId, name: "UIX-580 PostgreSQL API probe" },
    { id: apiForeignCampaignId, name: "UIX-580 foreign API probe" },
  ]);
  await db.insert(memberships).values([
    {
      id: apiGmMembershipId,
      campaignId: apiCampaignId,
      role: "GM",
      displayName: "API probe GM",
    },
    {
      id: apiPlayerMembershipId,
      campaignId: apiCampaignId,
      role: "PLAYER",
      displayName: "API probe player",
    },
    {
      id: apiForeignGmMembershipId,
      campaignId: apiForeignCampaignId,
      role: "GM",
      displayName: "API probe foreign GM",
    },
  ]);
  await db.insert(sessions).values([
    {
      membershipId: apiGmMembershipId,
      tokenHash: hashToken(apiGmSecret),
      expiresAt: new Date(Date.now() + 600_000),
    },
    {
      membershipId: apiPlayerMembershipId,
      tokenHash: hashToken(apiPlayerSecret),
      expiresAt: new Date(Date.now() + 600_000),
    },
    {
      membershipId: apiForeignGmMembershipId,
      tokenHash: hashToken(apiForeignGmSecret),
      expiresAt: new Date(Date.now() + 600_000),
    },
  ]);
  apiApp = Fastify();
  await apiApp.register(cookie);
  registerSpellPackRoutes(apiApp, db);
  await apiApp.ready();
  const authHeaders = (secret: string) => ({
    cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
  });

  const apiPackId = randomUUID();
  const apiCreateActionId = randomUUID();
  const apiCreatePayload = {
    actionId: apiCreateActionId,
    expectedVersion: 0,
    graph: graphFor(apiPackId, 1),
  };
  const apiCreated = await apiApp.inject({
    method: "POST",
    url: "/api/spell-packs",
    headers: authHeaders(apiGmSecret),
    payload: apiCreatePayload,
  });
  if (apiCreated.statusCode !== 201)
    throw new Error(
      `SPELL_PROBE_API_CREATE:${apiCreated.statusCode}:${safeApiErrorCode(apiCreated)}`,
    );
  assert(apiCreated.statusCode === 201, "PostgreSQL API create failed");
  const apiReplay = await apiApp.inject({
    method: "POST",
    url: "/api/spell-packs",
    headers: authHeaders(apiGmSecret),
    payload: apiCreatePayload,
  });
  assert(apiReplay.statusCode === 200, "PostgreSQL API replay failed");

  const actionReuse = await apiApp.inject({
    method: "POST",
    url: "/api/spell-packs",
    headers: authHeaders(apiGmSecret),
    payload: {
      ...apiCreatePayload,
      graph: graphFor(randomUUID(), 1),
    },
  });
  assert(
    actionReuse.statusCode === 409,
    "PostgreSQL API actionId reuse did not conflict",
  );

  const playerCreate = await apiApp.inject({
    method: "POST",
    url: "/api/spell-packs",
    headers: authHeaders(apiPlayerSecret),
    payload: {
      actionId: randomUUID(),
      expectedVersion: 0,
      graph: graphFor(randomUUID(), 1),
    },
  });
  assert(playerCreate.statusCode === 403, "PLAYER reached spell-pack command");

  const competingDrafts = [
    {
      actionId: randomUUID(),
      expectedVersion: 1,
      graph: graphFor(apiPackId, 2),
    },
    {
      actionId: randomUUID(),
      expectedVersion: 1,
      graph: graphFor(apiPackId, 2),
    },
  ];
  const competingResponses = await Promise.all(
    competingDrafts.map((payload) =>
      apiApp!.inject({
        method: "POST",
        url: `/api/spell-packs/${apiPackId}/versions`,
        headers: authHeaders(apiGmSecret),
        payload,
      }),
    ),
  );
  assert(
    JSON.stringify(
      competingResponses.map((response) => response.statusCode).sort(),
    ) === "[201,409]",
    "PostgreSQL API CAS race must commit one draft and reject one",
  );
  const winningIndex = competingResponses.findIndex(
    (response) => response.statusCode === 201,
  );
  assert(winningIndex >= 0, "PostgreSQL API CAS winner missing");
  const winningReplay = await apiApp.inject({
    method: "POST",
    url: `/api/spell-packs/${apiPackId}/versions`,
    headers: authHeaders(apiGmSecret),
    payload: competingDrafts[winningIndex],
  });
  assert(
    winningReplay.statusCode === 200,
    "PostgreSQL API winning action did not replay",
  );

  const apiForeignPackId = randomUUID();
  const foreignCreated = await apiApp.inject({
    method: "POST",
    url: "/api/spell-packs",
    headers: authHeaders(apiForeignGmSecret),
    payload: {
      actionId: randomUUID(),
      expectedVersion: 0,
      graph: graphFor(apiForeignPackId, 1),
    },
  });
  assert(foreignCreated.statusCode === 201, "foreign API fixture failed");
  const foreignArchive = await apiApp.inject({
    method: "POST",
    url: `/api/spell-packs/${apiForeignPackId}/archive`,
    headers: authHeaders(apiGmSecret),
    payload: {
      actionId: randomUUID(),
      expectedVersion: 1,
      versionId: randomUUID(),
    },
  });
  assert(
    foreignArchive.statusCode === 404,
    "cross-campaign PostgreSQL API target was not hidden",
  );

  const apiHistory = await db
    .select({ version: spellPackVersions.version })
    .from(spellPackVersions)
    .where(
      and(
        eq(spellPackVersions.campaignId, apiCampaignId),
        eq(spellPackVersions.packId, apiPackId),
      ),
    )
    .orderBy(asc(spellPackVersions.version));
  assert(
    JSON.stringify(apiHistory.map((row) => row.version)) === "[1,2]",
    "PostgreSQL API history is not immutable and monotonic",
  );
  const apiEvents = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, apiCampaignId),
        eq(gameEvents.entityId, apiPackId),
      ),
    )
    .orderBy(asc(gameEvents.sequence));
  assert(apiEvents.length === 2, "PostgreSQL API wrote duplicate events");
  for (const event of apiEvents) {
    const serialized = JSON.stringify(event.payload);
    assert(!serialized.includes("graph"), "audit payload leaked graph");
    assert(!serialized.includes("mechanics"), "audit payload leaked mechanics");
  }

  console.log("[spell-pack-probe] storage and API passed");
} catch (error) {
  console.error(safeProbeDiagnostic(error));
  throw probeFailure("SPELL_PROBE_DIAGNOSTIC_FAILURE", error);
} finally {
  const cleanup = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      console.error(safeProbeDiagnostic(error));
      throw probeFailure("SPELL_PROBE_CLEANUP_FAILED", error);
    }
  };
  if (apiApp) await cleanup(() => apiApp!.close());
  await cleanup(() => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
  await cleanup(() =>
    db.delete(campaigns).where(eq(campaigns.id, foreignCampaignId)),
  );
  await cleanup(() =>
    db.delete(campaigns).where(eq(campaigns.id, apiCampaignId)),
  );
  await cleanup(() =>
    db.delete(campaigns).where(eq(campaigns.id, apiForeignCampaignId)),
  );
  await cleanup(() => client.end());
}
