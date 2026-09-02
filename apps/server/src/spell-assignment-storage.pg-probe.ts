import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import type { SpellProgressionGraph } from "@arken/contracts";
import {
  campaigns,
  characters,
  characterSpellAssignments,
  characterSpellAssignmentVersions,
  createDatabase,
  gameEvents,
  memberships,
  sessions,
  spellPacks,
  spellPackVersions,
} from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerSpellAssignmentRoutes } from "./spell-assignment-routes.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for the PostgreSQL probe");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectRejected(operation: Promise<unknown>, message: string) {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error(message);
}

const ids = {
  campaign: randomUUID(),
  foreignCampaign: randomUUID(),
  gm: randomUUID(),
  foreignGm: randomUUID(),
  character: randomUUID(),
  overrideCharacter: randomUUID(),
  foreignCharacter: randomUUID(),
  pack: randomUUID(),
  foreignPack: randomUUID(),
  packV1: randomUUID(),
  packV2: randomUUID(),
  foreignPackV1: randomUUID(),
  school: randomUUID(),
  foreignSchool: randomUUID(),
  rootNode: randomUUID(),
  targetNode: randomUUID(),
  foreignRootNode: randomUUID(),
  foreignTargetNode: randomUUID(),
  group: randomUUID(),
  foreignGroup: randomUUID(),
  edge: randomUUID(),
  foreignEdge: randomUUID(),
};
const gmSecret = "uix577-gm-".padEnd(40, "g");
const foreignGmSecret = "uix577-foreign-".padEnd(40, "f");

function graph(input: {
  packId: string;
  versionId: string;
  version: number;
  schoolId: string;
  rootNodeId: string;
  targetNodeId: string;
  groupId: string;
  edgeId: string;
  revision: string;
}): SpellProgressionGraph {
  const node = (nodeId: string, label: string) => ({
    id: nodeId,
    packId: input.packId,
    packVersionId: input.versionId,
    schoolId: input.schoolId,
    sourceName: label,
    displayName: label,
    rawSourceText: `${label} source ${input.revision}`,
    narrativeText: `${label} narrative ${input.revision}`,
    mechanicsText: `${label} mechanics ${input.revision}`,
    lifecycle: "ACTIVE" as const,
    revision: input.version - 1,
    revisionProvenance: {},
    activation: { passive: true, triggers: [] },
    costs: [],
    usageLimit: null,
  });
  return {
    packId: input.packId,
    versionId: input.versionId,
    version: input.version,
    title: `Assignment probe ${input.revision}`,
    lifecycle: "ACTIVE",
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: `UIX-577 ${input.revision}`,
      rawSourceText: `Private assignment source ${input.revision}`,
    },
    schools: [
      {
        id: input.schoolId,
        packId: input.packId,
        packVersionId: input.versionId,
        slug: "assignment-probe",
        sourceName: "Assignment probe",
        displayName: "Assignment probe",
        description: "",
        visibilityPolicy: "PUBLIC",
        order: 0,
      },
    ],
    nodes: [node(input.rootNodeId, "Root"), node(input.targetNodeId, "Target")],
    requirementGroups: [
      {
        id: input.groupId,
        packId: input.packId,
        packVersionId: input.versionId,
        schoolId: input.schoolId,
        targetNodeId: input.targetNodeId,
        mode: "ALL",
      },
    ],
    edges: [
      {
        id: input.edgeId,
        packId: input.packId,
        packVersionId: input.versionId,
        schoolId: input.schoolId,
        requirementGroupId: input.groupId,
        sourceNodeId: input.rootNodeId,
        targetNodeId: input.targetNodeId,
        minimumRank: 2,
      },
    ],
  };
}

const ownGraphV1 = graph({
  packId: ids.pack,
  versionId: ids.packV1,
  version: 1,
  schoolId: ids.school,
  rootNodeId: ids.rootNode,
  targetNodeId: ids.targetNode,
  groupId: ids.group,
  edgeId: ids.edge,
  revision: "v1",
});
const ownGraphV2 = graph({
  packId: ids.pack,
  versionId: ids.packV2,
  version: 2,
  schoolId: ids.school,
  rootNodeId: ids.rootNode,
  targetNodeId: ids.targetNode,
  groupId: ids.group,
  edgeId: ids.edge,
  revision: "v2",
});
const foreignGraph = graph({
  packId: ids.foreignPack,
  versionId: ids.foreignPackV1,
  version: 1,
  schoolId: ids.foreignSchool,
  rootNodeId: ids.foreignRootNode,
  targetNodeId: ids.foreignTargetNode,
  groupId: ids.foreignGroup,
  edgeId: ids.foreignEdge,
  revision: "foreign",
});

const { client, db } = createDatabase(connectionString);
let app: FastifyInstance | undefined;

try {
  await db.insert(campaigns).values([
    { id: ids.campaign, name: "UIX-577 PostgreSQL probe" },
    { id: ids.foreignCampaign, name: "UIX-577 foreign probe" },
  ]);
  await db.insert(memberships).values([
    {
      id: ids.gm,
      campaignId: ids.campaign,
      role: "GM",
      displayName: "Assignment GM",
    },
    {
      id: ids.foreignGm,
      campaignId: ids.foreignCampaign,
      role: "GM",
      displayName: "Foreign assignment GM",
    },
  ]);
  await db.insert(sessions).values([
    {
      membershipId: ids.gm,
      tokenHash: hashToken(gmSecret),
      expiresAt: new Date(Date.now() + 600_000),
    },
    {
      membershipId: ids.foreignGm,
      tokenHash: hashToken(foreignGmSecret),
      expiresAt: new Date(Date.now() + 600_000),
    },
  ]);
  await db.insert(characters).values([
    {
      id: ids.character,
      campaignId: ids.campaign,
      name: "Assignment hero",
    },
    {
      id: ids.overrideCharacter,
      campaignId: ids.campaign,
      name: "Override hero",
    },
    {
      id: ids.foreignCharacter,
      campaignId: ids.foreignCampaign,
      name: "Foreign hero",
    },
  ]);
  await db.insert(spellPacks).values([
    { id: ids.pack, campaignId: ids.campaign },
    { id: ids.foreignPack, campaignId: ids.foreignCampaign },
  ]);
  await db.insert(spellPackVersions).values([
    {
      id: ids.packV1,
      campaignId: ids.campaign,
      packId: ids.pack,
      version: 1,
      lifecycle: "ACTIVE",
      graph: ownGraphV1,
    },
    {
      id: ids.packV2,
      campaignId: ids.campaign,
      packId: ids.pack,
      version: 2,
      lifecycle: "ACTIVE",
      graph: ownGraphV2,
    },
    {
      id: ids.foreignPackV1,
      campaignId: ids.foreignCampaign,
      packId: ids.foreignPack,
      version: 1,
      lifecycle: "ACTIVE",
      graph: foreignGraph,
    },
  ]);

  app = Fastify();
  await app.register(cookie);
  registerSpellAssignmentRoutes(app, db);
  await app.ready();
  const headers = (secret: string) => ({
    cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
  });
  const create = (
    characterId: string,
    payload: Record<string, unknown>,
    secret = gmSecret,
  ) =>
    app!.inject({
      method: "POST",
      url: `/api/characters/${characterId}/spell-assignments`,
      headers: headers(secret),
      payload,
    });
  const payload = (
    assignmentId: string,
    assignmentVersionId: string,
    target: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) => ({
    actionId: randomUUID(),
    assignmentId,
    assignmentVersionId,
    expectedVersion: 0,
    packId: ids.pack,
    packVersionId: ids.packV1,
    target,
    ...overrides,
  });

  const rootAssignmentId = randomUUID();
  const root = await create(
    ids.character,
    payload(rootAssignmentId, randomUUID(), {
      kind: "NODE",
      schoolId: ids.school,
      nodeId: ids.rootNode,
      rank: 2,
    }),
  );
  assert(root.statusCode === 201, "root assignment failed");

  const targetAssignmentId = randomUUID();
  const target = await create(
    ids.character,
    payload(targetAssignmentId, randomUUID(), {
      kind: "NODE",
      schoolId: ids.school,
      nodeId: ids.targetNode,
      rank: 1,
    }),
  );
  assert(target.statusCode === 201, "target assignment failed");
  assert(
    target.json().snapshot.node.mechanicsText === "Target mechanics v1",
    "version 1 snapshot did not preserve its mechanics",
  );

  const competing = [2, 3].map((rank) =>
    app!.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/spell-assignments/${targetAssignmentId}/versions`,
      headers: headers(gmSecret),
      payload: {
        actionId: randomUUID(),
        assignmentVersionId: randomUUID(),
        expectedVersion: 1,
        packId: ids.pack,
        packVersionId: ids.packV2,
        target: {
          kind: "NODE",
          schoolId: ids.school,
          nodeId: ids.targetNode,
          rank,
        },
      },
    }),
  );
  const competingResponses = await Promise.all(competing);
  assert(
    JSON.stringify(
      competingResponses.map((response) => response.statusCode).sort(),
    ) === "[201,409]",
    "assignment CAS race must commit one version and reject one",
  );
  const history = await db
    .select()
    .from(characterSpellAssignmentVersions)
    .where(
      and(
        eq(characterSpellAssignmentVersions.campaignId, ids.campaign),
        eq(characterSpellAssignmentVersions.assignmentId, targetAssignmentId),
      ),
    )
    .orderBy(asc(characterSpellAssignmentVersions.version));
  assert(
    JSON.stringify(history.map((version) => version.version)) === "[1,2]",
    "assignment history is not monotonic",
  );
  assert(
    (history[0]?.snapshot as { node?: { mechanicsText?: string } }).node
      ?.mechanicsText === "Target mechanics v1" &&
      (history[1]?.snapshot as { node?: { mechanicsText?: string } }).node
        ?.mechanicsText === "Target mechanics v2",
    "pack changes rewrote an assignment snapshot",
  );

  const overrideAssignmentId = randomUUID();
  const unmet = await create(
    ids.overrideCharacter,
    payload(overrideAssignmentId, randomUUID(), {
      kind: "NODE",
      schoolId: ids.school,
      nodeId: ids.targetNode,
      rank: 1,
    }),
  );
  assert(unmet.statusCode === 422, "unmet prerequisites did not fail closed");
  const blank = await create(
    ids.overrideCharacter,
    payload(
      overrideAssignmentId,
      randomUUID(),
      {
        kind: "NODE",
        schoolId: ids.school,
        nodeId: ids.targetNode,
        rank: 1,
      },
      { overrideReason: "   " },
    ),
  );
  assert(blank.statusCode === 400, "blank override reason was accepted");
  const overrideActionId = randomUUID();
  const overridden = await create(
    ids.overrideCharacter,
    payload(
      overrideAssignmentId,
      randomUUID(),
      {
        kind: "NODE",
        schoolId: ids.school,
        nodeId: ids.targetNode,
        rank: 1,
      },
      {
        actionId: overrideActionId,
        overrideReason: "Разрешено мастером в PostgreSQL probe",
      },
    ),
  );
  assert(overridden.statusCode === 201, "audited override failed");
  const [overrideEvent] = await db
    .select()
    .from(gameEvents)
    .where(eq(gameEvents.actionId, overrideActionId));
  assert(
    overrideEvent?.type === "character_spell_assignment.overridden",
    "override audit event is missing",
  );
  const serializedAudit = JSON.stringify(overrideEvent?.payload);
  assert(
    serializedAudit.includes("Разрешено мастером") &&
      !serializedAudit.includes("mechanics") &&
      !serializedAudit.includes("Private assignment source"),
    "override audit lost its reason or leaked private rules",
  );

  const foreignAssignmentId = randomUUID();
  const foreignPayload = {
    actionId: randomUUID(),
    assignmentId: foreignAssignmentId,
    assignmentVersionId: randomUUID(),
    expectedVersion: 0,
    packId: ids.foreignPack,
    packVersionId: ids.foreignPackV1,
    target: { kind: "SCHOOL", schoolId: ids.foreignSchool },
  };
  const foreignCreated = await create(
    ids.foreignCharacter,
    foreignPayload,
    foreignGmSecret,
  );
  assert(foreignCreated.statusCode === 201, "foreign fixture failed");
  const crossCampaign = await create(ids.foreignCharacter, foreignPayload);
  assert(crossCampaign.statusCode === 404, "foreign character was not hidden");
  assert(
    (
      await db
        .select()
        .from(characterSpellAssignmentVersions)
        .where(
          eq(
            characterSpellAssignmentVersions.assignmentId,
            foreignAssignmentId,
          ),
        )
    ).length === 1,
    "foreign rejection changed assignment history",
  );

  await expectRejected(
    db.insert(characterSpellAssignments).values({
      id: randomUUID(),
      campaignId: ids.campaign,
      characterId: ids.foreignCharacter,
      packId: ids.pack,
    }),
    "composite character campaign FK accepted corruption",
  );
  await expectRejected(
    db
      .update(characterSpellAssignmentVersions)
      .set({ overrideReason: "rewrite" })
      .where(eq(characterSpellAssignmentVersions.id, history[0]!.id)),
    "immutable assignment version update unexpectedly succeeded",
  );
  await expectRejected(
    db
      .delete(characterSpellAssignmentVersions)
      .where(eq(characterSpellAssignmentVersions.id, history[0]!.id)),
    "direct assignment version delete unexpectedly succeeded",
  );
  await expectRejected(
    db.delete(memberships).where(eq(memberships.id, ids.gm)),
    "audit actor deletion unexpectedly removed assignment history",
  );

  await db.delete(campaigns).where(eq(campaigns.id, ids.campaign));
  assert(
    (
      await db
        .select()
        .from(characterSpellAssignments)
        .where(eq(characterSpellAssignments.campaignId, ids.campaign))
    ).length === 0,
    "campaign cascade left target assignments behind",
  );
  assert(
    (
      await db
        .select()
        .from(characterSpellAssignmentVersions)
        .where(
          eq(characterSpellAssignmentVersions.campaignId, ids.foreignCampaign),
        )
    ).length === 1,
    "campaign cascade changed foreign assignment history",
  );

  console.log("[spell-assignment-probe] persistence and API passed");
} finally {
  if (app) await app.close();
  await db.delete(campaigns).where(eq(campaigns.id, ids.campaign));
  await db.delete(campaigns).where(eq(campaigns.id, ids.foreignCampaign));
  await client.end();
}
