import { readdir, readFile } from "node:fs/promises";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import Fastify, { type FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SpellProgressionGraph } from "@arken/contracts";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerSpellAssignmentRoutes } from "./spell-assignment-routes.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;

const id = () => crypto.randomUUID();
const ids = {
  campaign: { own: id(), foreign: id() },
  gm: { own: id(), foreign: id() },
  player: id(),
  character: {
    snapshot: id(),
    override: id(),
    concurrency: id(),
    foreign: id(),
  },
  pack: { own: id(), foreign: id() },
  packVersion: { ownV1: id(), ownV2: id(), ownDraft: id(), foreign: id() },
  school: { own: id(), foreign: id() },
  node: {
    ownRoot: id(),
    ownTarget: id(),
    foreignRoot: id(),
    foreignTarget: id(),
  },
  group: { own: id(), foreign: id() },
  edge: { own: id(), foreign: id() },
};
const secrets = {
  ownGm: "g".repeat(40),
  foreignGm: "h".repeat(40),
  player: "p".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});
const ownGmHeaders = headers(secrets.ownGm);
const foreignGmHeaders = headers(secrets.foreignGm);
const playerHeaders = headers(secrets.player);

function graph(
  packId: string,
  versionId: string,
  version: number,
  schoolId: string,
  rootId: string,
  targetId: string,
  groupId: string,
  edgeId: string,
  mechanicsRevision: string,
): SpellProgressionGraph {
  const node = (nodeId: string, label: string) => ({
    id: nodeId,
    packId,
    packVersionId: versionId,
    schoolId,
    sourceName: label,
    displayName: label,
    rawSourceText: `${label} source ${mechanicsRevision}`,
    narrativeText: `${label} narrative ${mechanicsRevision}`,
    mechanicsText: `${label} private mechanics ${mechanicsRevision}`,
    lifecycle: "ACTIVE" as const,
    revision: version - 1,
    revisionProvenance: {},
    activation: { passive: true, triggers: [] },
    costs: [],
    usageLimit: null,
  });
  return {
    packId,
    versionId,
    version,
    title: `Assignment pack ${mechanicsRevision}`,
    lifecycle: "ACTIVE",
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: `UIX-577 ${mechanicsRevision}`,
      rawSourceText: `Private source ${mechanicsRevision}`,
    },
    schools: [
      {
        id: schoolId,
        packId,
        packVersionId: versionId,
        slug: "assignment-school",
        sourceName: "Assignment school",
        displayName: "Assignment school",
        description: "",
        visibilityPolicy: "PUBLIC",
        order: 0,
      },
    ],
    nodes: [node(rootId, "Root"), node(targetId, "Target")],
    requirementGroups: [
      {
        id: groupId,
        packId,
        packVersionId: versionId,
        schoolId,
        targetNodeId: targetId,
        mode: "ALL",
      },
    ],
    edges: [
      {
        id: edgeId,
        packId,
        packVersionId: versionId,
        schoolId,
        requirementGroupId: groupId,
        sourceNodeId: rootId,
        targetNodeId: targetId,
        minimumRank: 2,
      },
    ],
  };
}

const ownGraphV1 = graph(
  ids.pack.own,
  ids.packVersion.ownV1,
  1,
  ids.school.own,
  ids.node.ownRoot,
  ids.node.ownTarget,
  ids.group.own,
  ids.edge.own,
  "v1",
);
const ownGraphV2 = graph(
  ids.pack.own,
  ids.packVersion.ownV2,
  2,
  ids.school.own,
  ids.node.ownRoot,
  ids.node.ownTarget,
  ids.group.own,
  ids.edge.own,
  "v2",
);
const ownDraftGraph: SpellProgressionGraph = {
  ...graph(
    ids.pack.own,
    ids.packVersion.ownDraft,
    3,
    ids.school.own,
    ids.node.ownRoot,
    ids.node.ownTarget,
    ids.group.own,
    ids.edge.own,
    "draft",
  ),
  lifecycle: "DRAFT",
};
const foreignGraph = graph(
  ids.pack.foreign,
  ids.packVersion.foreign,
  1,
  ids.school.foreign,
  ids.node.foreignRoot,
  ids.node.foreignTarget,
  ids.group.foreign,
  ids.edge.foreign,
  "foreign",
);

function createPayload(
  assignmentId: string,
  assignmentVersionId: string,
  target: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    actionId: id(),
    assignmentId,
    assignmentVersionId,
    expectedVersion: 0,
    packId: ids.pack.own,
    packVersionId: ids.packVersion.ownV1,
    target,
    ...overrides,
  };
}

async function createAssignment(
  characterId: string,
  payload: Record<string, unknown>,
  requestHeaders = ownGmHeaders,
) {
  return app.inject({
    method: "POST",
    url: `/api/characters/${characterId}/spell-assignments`,
    headers: requestHeaders,
    payload,
  });
}

async function versionsFor(assignmentId: string) {
  return db
    .select()
    .from(schema.characterSpellAssignmentVersions)
    .where(
      eq(schema.characterSpellAssignmentVersions.assignmentId, assignmentId),
    )
    .orderBy(asc(schema.characterSpellAssignmentVersions.version));
}

beforeAll(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
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

  await db.insert(schema.campaigns).values([
    { id: ids.campaign.own, name: "Own assignment campaign" },
    { id: ids.campaign.foreign, name: "Foreign assignment campaign" },
  ]);
  await db.insert(schema.memberships).values([
    {
      id: ids.gm.own,
      campaignId: ids.campaign.own,
      role: "GM",
      displayName: "Own GM",
    },
    {
      id: ids.gm.foreign,
      campaignId: ids.campaign.foreign,
      role: "GM",
      displayName: "Foreign GM",
    },
    {
      id: ids.player,
      campaignId: ids.campaign.own,
      role: "PLAYER",
      displayName: "Own player",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm.own, secrets.ownGm],
    [ids.gm.foreign, secrets.foreignGm],
    [ids.player, secrets.player],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 600_000),
    });
  await db.insert(schema.characters).values([
    {
      id: ids.character.snapshot,
      campaignId: ids.campaign.own,
      name: "Snapshot character",
    },
    {
      id: ids.character.override,
      campaignId: ids.campaign.own,
      name: "Override character",
    },
    {
      id: ids.character.concurrency,
      campaignId: ids.campaign.own,
      name: "Concurrency character",
    },
    {
      id: ids.character.foreign,
      campaignId: ids.campaign.foreign,
      name: "Foreign character",
    },
  ]);
  await db.insert(schema.spellPacks).values([
    { id: ids.pack.own, campaignId: ids.campaign.own },
    { id: ids.pack.foreign, campaignId: ids.campaign.foreign },
  ]);
  await db.insert(schema.spellPackVersions).values([
    {
      id: ownGraphV1.versionId,
      campaignId: ids.campaign.own,
      packId: ids.pack.own,
      version: 1,
      lifecycle: "ACTIVE",
      graph: ownGraphV1,
    },
    {
      id: ownGraphV2.versionId,
      campaignId: ids.campaign.own,
      packId: ids.pack.own,
      version: 2,
      lifecycle: "ACTIVE",
      graph: ownGraphV2,
    },
    {
      id: ownDraftGraph.versionId,
      campaignId: ids.campaign.own,
      packId: ids.pack.own,
      version: 3,
      lifecycle: "DRAFT",
      graph: ownDraftGraph,
    },
    {
      id: foreignGraph.versionId,
      campaignId: ids.campaign.foreign,
      packId: ids.pack.foreign,
      version: 1,
      lifecycle: "ACTIVE",
      graph: foreignGraph,
    },
  ]);

  app = Fastify();
  await app.register(cookie);
  registerSpellAssignmentRoutes(app, db as never);
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app.close();
  await database.close();
});

describe("UIX-577 spell assignment GM API", () => {
  it("canonicalizes uppercase UUID input before lookup, snapshot and replay", async () => {
    const assignmentId = id();
    const assignmentVersionId = id();
    const payload = {
      actionId: id().toUpperCase(),
      assignmentId: assignmentId.toUpperCase(),
      assignmentVersionId: assignmentVersionId.toUpperCase(),
      expectedVersion: 0,
      packId: ids.pack.own.toUpperCase(),
      packVersionId: ids.packVersion.ownV1.toUpperCase(),
      target: {
        kind: "SCHOOL",
        schoolId: ids.school.own.toUpperCase(),
      },
    };
    const created = await createAssignment(
      ids.character.snapshot.toUpperCase(),
      payload,
    );
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      assignmentId,
      assignmentVersionId,
      characterId: ids.character.snapshot,
      packId: ids.pack.own,
      packVersionId: ids.packVersion.ownV1,
      schoolId: ids.school.own,
    });
    expect(created.json().snapshot).toMatchObject({
      assignmentId,
      assignmentVersionId,
      packId: ids.pack.own,
      packVersionId: ids.packVersion.ownV1,
      schoolId: ids.school.own,
    });

    const replay = await createAssignment(ids.character.snapshot, payload);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().assignmentVersionId).toBe(assignmentVersionId);
  });

  it("accepts only an explicitly ACTIVE spell-pack version", async () => {
    const response = await createAssignment(
      ids.character.snapshot,
      createPayload(
        id(),
        id(),
        { kind: "SCHOOL", schoolId: ids.school.own },
        { packVersionId: ids.packVersion.ownDraft },
      ),
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("SPELL_PACK_VERSION_NOT_ACTIVE");
  });

  it("keeps rules and provenance immutable across pack and assignment versions", async () => {
    const templateId = id();
    const legacyId = id();
    await db.insert(schema.catalogEntries).values({
      id: templateId,
      campaignId: ids.campaign.own,
      kind: "ABILITY",
      name: "Legacy wave",
      description: "Legacy v1",
    });
    await db.insert(schema.characterCatalogEntries).values({
      id: legacyId,
      characterId: ids.character.snapshot,
      sourceCatalogEntryId: templateId,
      kind: "ABILITY",
      name: "Legacy wave",
      description: "Legacy v1",
    });

    const rootAssignmentId = id();
    const root = await createAssignment(
      ids.character.snapshot,
      createPayload(rootAssignmentId, id(), {
        kind: "NODE",
        schoolId: ids.school.own,
        nodeId: ids.node.ownRoot,
        rank: 2,
      }),
    );
    expect(root.statusCode, root.body).toBe(201);

    const targetAssignmentId = id();
    const targetV1 = await createAssignment(
      ids.character.snapshot,
      createPayload(targetAssignmentId, id(), {
        kind: "NODE",
        schoolId: ids.school.own,
        nodeId: ids.node.ownTarget,
        rank: 1,
      }),
    );
    expect(targetV1.statusCode, targetV1.body).toBe(201);
    expect(targetV1.json().snapshot).toMatchObject({
      packVersionId: ids.packVersion.ownV1,
      packVersion: 1,
      node: { mechanicsText: "Target private mechanics v1" },
      provenance: { sourceLabel: "UIX-577 v1" },
    });
    expect(targetV1.json().snapshot).not.toHaveProperty("layout");

    const targetV2 = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character.snapshot}/spell-assignments/${targetAssignmentId}/versions`,
      headers: ownGmHeaders,
      payload: {
        actionId: id(),
        assignmentVersionId: id(),
        expectedVersion: 1,
        packId: ids.pack.own,
        packVersionId: ids.packVersion.ownV2,
        target: {
          kind: "NODE",
          schoolId: ids.school.own,
          nodeId: ids.node.ownTarget,
          rank: 2,
        },
      },
    });
    expect(targetV2.statusCode, targetV2.body).toBe(201);
    expect(targetV2.json().snapshot.node.mechanicsText).toBe(
      "Target private mechanics v2",
    );

    const versions = await versionsFor(targetAssignmentId);
    expect(versions).toHaveLength(2);
    expect(
      (versions[0]!.snapshot as { node: { mechanicsText: string } }).node
        .mechanicsText,
    ).toBe("Target private mechanics v1");
    expect(
      (versions[1]!.snapshot as { node: { mechanicsText: string } }).node
        .mechanicsText,
    ).toBe("Target private mechanics v2");

    await db
      .update(schema.catalogEntries)
      .set({ description: "Legacy v2" })
      .where(eq(schema.catalogEntries.id, templateId));
    const [legacy] = await db
      .select()
      .from(schema.characterCatalogEntries)
      .where(eq(schema.characterCatalogEntries.id, legacyId));
    expect(legacy).toMatchObject({
      description: "Legacy v1",
      kind: "ABILITY",
    });
  });

  it("requires a non-empty reason for unmet prerequisites and audits exact retries", async () => {
    const assignmentId = id();
    const missingActionId = id();
    const missing = await createAssignment(
      ids.character.override,
      createPayload(
        assignmentId,
        id(),
        {
          kind: "NODE",
          schoolId: ids.school.own,
          nodeId: ids.node.ownTarget,
          rank: 1,
        },
        { actionId: missingActionId },
      ),
    );
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error).toBe("SPELL_ASSIGNMENT_PREREQUISITES_UNMET");
    expect(
      await db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.actionId, missingActionId)),
    ).toHaveLength(0);

    const empty = await createAssignment(
      ids.character.override,
      createPayload(
        assignmentId,
        id(),
        {
          kind: "NODE",
          schoolId: ids.school.own,
          nodeId: ids.node.ownTarget,
          rank: 1,
        },
        { overrideReason: "   " },
      ),
    );
    expect(empty.statusCode).toBe(400);

    const actionId = id();
    const payload = createPayload(
      assignmentId,
      id(),
      {
        kind: "NODE",
        schoolId: ids.school.own,
        nodeId: ids.node.ownTarget,
        rank: 1,
      },
      { actionId, overrideReason: "Одобрено мастером по сценарию" },
    );
    const overridden = await createAssignment(ids.character.override, payload);
    expect(overridden.statusCode, overridden.body).toBe(201);
    expect(overridden.json().overrideReason).toBe(
      "Одобрено мастером по сценарию",
    );
    const [event] = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.actionId, actionId));
    expect(event).toMatchObject({
      type: "character_spell_assignment.overridden",
      entityId: assignmentId,
      entityRevision: 1,
    });
    expect(event!.payload).toMatchObject({
      overrideReason: "Одобрено мастером по сценарию",
      prerequisiteFailures: [
        {
          code: "SOURCE_NODE_MISSING",
          sourceNodeId: ids.node.ownRoot,
        },
      ],
    });
    expect(JSON.stringify(event!.payload)).not.toContain("mechanicsText");
    expect(JSON.stringify(event!.payload)).not.toContain("Private source");

    const replay = await createAssignment(ids.character.override, payload);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().assignmentVersionId).toBe(
      overridden.json().assignmentVersionId,
    );
    expect(await versionsFor(assignmentId)).toHaveLength(1);

    const conflict = await createAssignment(ids.character.override, {
      ...payload,
      target: {
        kind: "NODE",
        schoolId: ids.school.own,
        nodeId: ids.node.ownRoot,
        rank: 1,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("ACTION_ID_CONFLICT");

    const falseOverride = await createAssignment(
      ids.character.override,
      createPayload(
        id(),
        id(),
        {
          kind: "NODE",
          schoolId: ids.school.own,
          nodeId: ids.node.ownRoot,
          rank: 1,
        },
        { overrideReason: "Причина не нужна" },
      ),
    );
    expect(falseOverride.statusCode).toBe(422);
    expect(falseOverride.json().error).toBe(
      "SPELL_ASSIGNMENT_OVERRIDE_NOT_REQUIRED",
    );
  });

  it("serializes concurrent assignment versions and rejects duplicate current targets", async () => {
    const assignmentId = id();
    const initial = await createAssignment(
      ids.character.concurrency,
      createPayload(assignmentId, id(), {
        kind: "SCHOOL",
        schoolId: ids.school.own,
      }),
    );
    expect(initial.statusCode, initial.body).toBe(201);

    const payloads = [id(), id()].map((assignmentVersionId) => ({
      actionId: id(),
      assignmentVersionId,
      expectedVersion: 1,
      packId: ids.pack.own,
      packVersionId: ids.packVersion.ownV1,
      target: {
        kind: "NODE",
        schoolId: ids.school.own,
        nodeId: ids.node.ownRoot,
        rank: 1,
      },
    }));
    const responses = await Promise.all(
      payloads.map((payload) =>
        app.inject({
          method: "POST",
          url: `/api/characters/${ids.character.concurrency}/spell-assignments/${assignmentId}/versions`,
          headers: ownGmHeaders,
          payload,
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);
    const winnerIndex = responses.findIndex(
      (response) => response.statusCode === 201,
    );
    const loser = responses.find((response) => response.statusCode === 409);
    expect(loser?.json().error).toBe("SPELL_ASSIGNMENT_VERSION_CONFLICT");
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    const replay = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character.concurrency}/spell-assignments/${assignmentId}/versions`,
      headers: ownGmHeaders,
      payload: payloads[winnerIndex],
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().assignmentVersionId).toBe(
      payloads[winnerIndex]!.assignmentVersionId,
    );
    expect(await versionsFor(assignmentId)).toHaveLength(2);

    const duplicateActionId = id();
    const duplicate = await createAssignment(
      ids.character.concurrency,
      createPayload(
        id(),
        id(),
        {
          kind: "NODE",
          schoolId: ids.school.own,
          nodeId: ids.node.ownRoot,
          rank: 3,
        },
        { actionId: duplicateActionId },
      ),
    );
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe(
      "SPELL_ASSIGNMENT_TARGET_ALREADY_ASSIGNED",
    );
    expect(
      await db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.actionId, duplicateActionId)),
    ).toHaveLength(0);
  });

  it("requires GM and hides foreign character and assignment identities", async () => {
    const denied = await createAssignment(
      ids.character.snapshot,
      createPayload(id(), id(), {
        kind: "SCHOOL",
        schoolId: ids.school.own,
      }),
      playerHeaders,
    );
    expect(denied.statusCode).toBe(403);

    const foreignAssignmentId = id();
    const foreign = await createAssignment(
      ids.character.foreign,
      {
        actionId: id(),
        assignmentId: foreignAssignmentId,
        assignmentVersionId: id(),
        expectedVersion: 0,
        packId: ids.pack.foreign,
        packVersionId: ids.packVersion.foreign,
        target: {
          kind: "NODE",
          schoolId: ids.school.foreign,
          nodeId: ids.node.foreignRoot,
          rank: 1,
        },
      },
      foreignGmHeaders,
    );
    expect(foreign.statusCode, foreign.body).toBe(201);

    const foreignCountBefore = await versionsFor(foreignAssignmentId);
    const createAcrossCampaign = await createAssignment(
      ids.character.foreign,
      createPayload(id(), id(), {
        kind: "SCHOOL",
        schoolId: ids.school.own,
      }),
    );
    expect(createAcrossCampaign.statusCode).toBe(404);

    const appendAcrossCampaign = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character.foreign}/spell-assignments/${foreignAssignmentId}/versions`,
      headers: ownGmHeaders,
      payload: {
        actionId: id(),
        assignmentVersionId: id(),
        expectedVersion: 1,
        packId: ids.pack.foreign,
        packVersionId: ids.packVersion.foreign,
        target: {
          kind: "NODE",
          schoolId: ids.school.foreign,
          nodeId: ids.node.foreignRoot,
          rank: 2,
        },
      },
    });
    expect(appendAcrossCampaign.statusCode).toBe(404);
    expect(await versionsFor(foreignAssignmentId)).toEqual(foreignCountBefore);

    const ownForeignPack = await createAssignment(ids.character.snapshot, {
      actionId: id(),
      assignmentId: id(),
      assignmentVersionId: id(),
      expectedVersion: 0,
      packId: ids.pack.foreign,
      packVersionId: ids.packVersion.foreign,
      target: {
        kind: "SCHOOL",
        schoolId: ids.school.foreign,
      },
    });
    expect(ownForeignPack.statusCode).toBe(404);
  });
});
