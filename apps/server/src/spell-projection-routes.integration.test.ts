import { readdir, readFile } from "node:fs/promises";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import Fastify, { type FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  gmSpellProgressionProjectionSchema,
  playerSpellProgressionProjectionSchema,
  spellAssignmentSnapshotSchema,
  type SpellAssignmentSnapshot,
  type SpellProgressionGraph,
} from "@arken/contracts";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerSpellProjectionRoutes } from "./spell-projection-routes.js";
import { buildSpellAssignmentSnapshot } from "./spell-assignment-storage.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;

const uuid = () => crypto.randomUUID();
const ids = {
  campaign: { own: uuid(), foreign: uuid() },
  membership: {
    gm: uuid(),
    owner: uuid(),
    controller: uuid(),
    other: uuid(),
    foreignGm: uuid(),
  },
  character: { own: uuid(), foreign: uuid() },
  pack: { own: uuid(), unassigned: uuid(), foreign: uuid() },
  version: {
    active: uuid(),
    reference: uuid(),
    unassigned: uuid(),
    foreign: uuid(),
  },
  school: { public: uuid(), hidden: uuid() },
  node: { root: uuid(), target: uuid(), hidden: uuid() },
  group: uuid(),
  edge: uuid(),
  assignment: { school: uuid(), node: uuid() },
  assignmentVersion: { school: uuid(), node: uuid() },
};

const secrets = {
  gm: "g".repeat(40),
  owner: "o".repeat(40),
  controller: "c".repeat(40),
  other: "x".repeat(40),
  foreignGm: "f".repeat(40),
};

const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

function activeGraph(): SpellProgressionGraph {
  const node = (
    id: string,
    schoolId: string,
    displayName: string,
    mechanicsText: string,
  ) => ({
    id,
    packId: ids.pack.own,
    packVersionId: ids.version.active,
    schoolId,
    sourceName: `${displayName} source`,
    displayName,
    rawSourceText: `${displayName} raw source`,
    narrativeText: `${displayName} narrative`,
    mechanicsText,
    lifecycle: "ACTIVE" as const,
    revision: 0,
    revisionProvenance: { changeNote: `${displayName} private revision` },
    activation: { passive: true, triggers: [] },
    costs: [],
    usageLimit: null,
  });
  return {
    packId: ids.pack.own,
    versionId: ids.version.active,
    version: 1,
    title: "Projection pack",
    lifecycle: "ACTIVE",
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "UIX-578 private provenance",
      rawSourceText: "GRAPH_PRIVATE_SOURCE",
    },
    schools: [
      {
        id: ids.school.public,
        packId: ids.pack.own,
        packVersionId: ids.version.active,
        slug: "public-school",
        sourceName: "Public source name",
        displayName: "Public school",
        description: "Public description",
        visibilityPolicy: "PUBLIC",
        order: 0,
      },
      {
        id: ids.school.hidden,
        packId: ids.pack.own,
        packVersionId: ids.version.active,
        slug: "hidden-school",
        sourceName: "Hidden source name",
        displayName: "Hidden school",
        description: "HIDDEN_SCHOOL_DESCRIPTION",
        visibilityPolicy: "GM_ONLY",
        order: 1,
      },
    ],
    nodes: [
      node(
        ids.node.root,
        ids.school.public,
        "Known root",
        "GRAPH_ROOT_MECHANICS",
      ),
      node(
        ids.node.target,
        ids.school.public,
        "Locked target",
        "LOCKED_SECRET_MECHANICS",
      ),
      node(
        ids.node.hidden,
        ids.school.hidden,
        "Hidden node",
        "HIDDEN_SECRET_MECHANICS",
      ),
    ],
    requirementGroups: [
      {
        id: ids.group,
        packId: ids.pack.own,
        packVersionId: ids.version.active,
        schoolId: ids.school.public,
        targetNodeId: ids.node.target,
        mode: "ALL",
        sourceNote: "PRIVATE_GROUP_NOTE",
      },
    ],
    edges: [
      {
        id: ids.edge,
        packId: ids.pack.own,
        packVersionId: ids.version.active,
        schoolId: ids.school.public,
        requirementGroupId: ids.group,
        sourceNodeId: ids.node.root,
        targetNodeId: ids.node.target,
        minimumRank: 2,
        gmGrantCondition: "PRIVATE_GM_CONDITION",
      },
    ],
    layout: {
      nodes: [
        { nodeId: ids.node.root, position: { x: -99_999, y: 55_555 } },
        { nodeId: ids.node.hidden, position: { x: 99_999, y: -55_555 } },
      ],
    },
  };
}

function emptyGraph(
  packId: string,
  versionId: string,
  lifecycle: "ACTIVE" | "REFERENCE",
): SpellProgressionGraph {
  return {
    packId,
    versionId,
    version: 1,
    title: `${lifecycle} empty pack`,
    lifecycle,
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "Projection integration fixture",
      rawSourceText: "No nodes",
    },
    schools: [],
    nodes: [],
    requirementGroups: [],
    edges: [],
  };
}

function projectionUrl(
  characterId: string,
  packId = ids.pack.own,
  packVersionId = ids.version.active,
  gm = false,
) {
  const prefix = gm ? "/api/gm/characters" : "/api/characters";
  return `${prefix}/${characterId}/spell-progression?packId=${packId}&packVersionId=${packVersionId}`;
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
    { id: ids.campaign.own, name: "Projection campaign" },
    { id: ids.campaign.foreign, name: "Foreign projection campaign" },
  ]);
  await db.insert(schema.memberships).values([
    {
      id: ids.membership.gm,
      campaignId: ids.campaign.own,
      role: "GM",
      displayName: "Projection GM",
    },
    {
      id: ids.membership.owner,
      campaignId: ids.campaign.own,
      role: "PLAYER",
      displayName: "Owner",
    },
    {
      id: ids.membership.controller,
      campaignId: ids.campaign.own,
      role: "PLAYER",
      displayName: "Controller",
    },
    {
      id: ids.membership.other,
      campaignId: ids.campaign.own,
      role: "PLAYER",
      displayName: "Other player",
    },
    {
      id: ids.membership.foreignGm,
      campaignId: ids.campaign.foreign,
      role: "GM",
      displayName: "Foreign GM",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.membership.gm, secrets.gm],
    [ids.membership.owner, secrets.owner],
    [ids.membership.controller, secrets.controller],
    [ids.membership.other, secrets.other],
    [ids.membership.foreignGm, secrets.foreignGm],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 600_000),
    });

  await db.insert(schema.characters).values([
    {
      id: ids.character.own,
      campaignId: ids.campaign.own,
      name: "Projection character",
      ownerMembershipId: ids.membership.owner,
    },
    {
      id: ids.character.foreign,
      campaignId: ids.campaign.foreign,
      name: "Foreign projection character",
    },
  ]);
  await db.insert(schema.characterControllers).values({
    characterId: ids.character.own,
    membershipId: ids.membership.controller,
  });

  await db.insert(schema.spellPacks).values([
    { id: ids.pack.own, campaignId: ids.campaign.own },
    { id: ids.pack.unassigned, campaignId: ids.campaign.own },
    { id: ids.pack.foreign, campaignId: ids.campaign.foreign },
  ]);
  const graph = activeGraph();
  await db.insert(schema.spellPackVersions).values([
    {
      id: ids.version.active,
      campaignId: ids.campaign.own,
      packId: ids.pack.own,
      version: 1,
      lifecycle: "ACTIVE",
      graph,
    },
    {
      id: ids.version.reference,
      campaignId: ids.campaign.own,
      packId: ids.pack.own,
      version: 2,
      lifecycle: "REFERENCE",
      graph: {
        ...emptyGraph(ids.pack.own, ids.version.reference, "REFERENCE"),
        version: 2,
      },
    },
    {
      id: ids.version.unassigned,
      campaignId: ids.campaign.own,
      packId: ids.pack.unassigned,
      version: 1,
      lifecycle: "ACTIVE",
      graph: emptyGraph(ids.pack.unassigned, ids.version.unassigned, "ACTIVE"),
    },
    {
      id: ids.version.foreign,
      campaignId: ids.campaign.foreign,
      packId: ids.pack.foreign,
      version: 1,
      lifecycle: "ACTIVE",
      graph: emptyGraph(ids.pack.foreign, ids.version.foreign, "ACTIVE"),
    },
  ]);

  const schoolSnapshot = buildSpellAssignmentSnapshot(
    { graph, packVersion: 1 },
    {
      assignmentId: ids.assignment.school,
      assignmentVersionId: ids.assignmentVersion.school,
      assignmentVersion: 1,
    },
    { kind: "SCHOOL", schoolId: ids.school.public },
  );
  const originalNodeSnapshot = buildSpellAssignmentSnapshot(
    { graph, packVersion: 1 },
    {
      assignmentId: ids.assignment.node,
      assignmentVersionId: ids.assignmentVersion.node,
      assignmentVersion: 1,
    },
    {
      kind: "NODE",
      schoolId: ids.school.public,
      nodeId: ids.node.root,
      rank: 1,
    },
  );
  if (originalNodeSnapshot.kind !== "NODE")
    throw new Error("NODE_SNAPSHOT_EXPECTED");
  const nodeSnapshot = spellAssignmentSnapshotSchema.parse({
    ...originalNodeSnapshot,
    node: {
      ...originalNodeSnapshot.node,
      mechanicsText: "SNAPSHOT_DISCOVERED_MECHANICS",
    },
  });

  await db.insert(schema.characterSpellAssignments).values([
    {
      id: ids.assignment.school,
      campaignId: ids.campaign.own,
      characterId: ids.character.own,
      packId: ids.pack.own,
    },
    {
      id: ids.assignment.node,
      campaignId: ids.campaign.own,
      characterId: ids.character.own,
      packId: ids.pack.own,
    },
  ]);
  await db.insert(schema.characterSpellAssignmentVersions).values([
    {
      id: ids.assignmentVersion.school,
      campaignId: ids.campaign.own,
      assignmentId: ids.assignment.school,
      characterId: ids.character.own,
      packId: ids.pack.own,
      packVersionId: ids.version.active,
      version: 1,
      kind: "SCHOOL",
      schoolId: ids.school.public,
      nodeId: null,
      rank: null,
      snapshot: schoolSnapshot,
      overrideReason: null,
      assignedByMembershipId: ids.membership.gm,
    },
    {
      id: ids.assignmentVersion.node,
      campaignId: ids.campaign.own,
      assignmentId: ids.assignment.node,
      characterId: ids.character.own,
      packId: ids.pack.own,
      packVersionId: ids.version.active,
      version: 1,
      kind: "NODE",
      schoolId: ids.school.public,
      nodeId: ids.node.root,
      rank: 1,
      snapshot: nodeSnapshot,
      overrideReason: null,
      assignedByMembershipId: ids.membership.gm,
    },
  ]);

  app = Fastify();
  await app.register(cookie);
  registerSpellProjectionRoutes(app, db as never);
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app.close();
  await database.close();
});

describe("UIX-578 spell progression projection routes", () => {
  it("returns the same strict player-safe projection to owner, controller and GM", async () => {
    const responses = await Promise.all(
      [secrets.owner, secrets.controller, secrets.gm].map((secret) =>
        app.inject({
          method: "GET",
          url: projectionUrl(ids.character.own),
          headers: headers(secret),
        }),
      ),
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      const serialized = response.body;
      expect(serialized).toContain("SNAPSHOT_DISCOVERED_MECHANICS");
      expect(serialized).not.toContain("GRAPH_ROOT_MECHANICS");
      expect(serialized).not.toContain("LOCKED_SECRET_MECHANICS");
      expect(serialized).not.toContain("HIDDEN_SECRET_MECHANICS");
      expect(serialized).not.toContain(ids.node.hidden);
      expect(serialized).not.toContain("GRAPH_PRIVATE_SOURCE");
      expect(serialized).not.toContain("PRIVATE_GM_CONDITION");
      expect(serialized).not.toContain("PRIVATE_GROUP_NOTE");
      expect(serialized).not.toContain("private revision");
    }
    expect(responses[0]!.json()).toEqual(responses[1]!.json());
    expect(responses[1]!.json()).toEqual(responses[2]!.json());
  });

  it("keeps the full GM projection on a separate GM-only route", async () => {
    const player = await app.inject({
      method: "GET",
      url: projectionUrl(
        ids.character.own,
        ids.pack.own,
        ids.version.active,
        true,
      ),
      headers: headers(secrets.owner),
    });
    expect(player.statusCode).toBe(403);

    const gm = await app.inject({
      method: "GET",
      url: projectionUrl(
        ids.character.own,
        ids.pack.own,
        ids.version.active,
        true,
      ),
      headers: headers(secrets.gm),
    });
    expect(gm.statusCode).toBe(200);
    expect(gm.headers["cache-control"]).toBe("private, no-store");
    expect(gm.body).toContain("LOCKED_SECRET_MECHANICS");
    expect(gm.body).toContain("HIDDEN_SECRET_MECHANICS");
    expect(gm.body).toContain("GRAPH_PRIVATE_SOURCE");
    expect(gm.body).toContain("PRIVATE_GM_CONDITION");
  });

  it("fails closed for other players, foreign campaigns and unavailable versions", async () => {
    const cases = [
      {
        secret: secrets.other,
        url: projectionUrl(ids.character.own),
        expected: 404,
      },
      {
        secret: secrets.foreignGm,
        url: projectionUrl(
          ids.character.own,
          ids.pack.own,
          ids.version.active,
          true,
        ),
        expected: 404,
      },
      {
        secret: secrets.gm,
        url: projectionUrl(
          ids.character.foreign,
          ids.pack.foreign,
          ids.version.foreign,
          true,
        ),
        expected: 404,
      },
      {
        secret: secrets.owner,
        url: projectionUrl(
          ids.character.own,
          ids.pack.own,
          ids.version.reference,
        ),
        expected: 404,
      },
      {
        secret: secrets.owner,
        url: projectionUrl(
          ids.character.own,
          ids.pack.unassigned,
          ids.version.unassigned,
        ),
        expected: 404,
      },
    ];
    for (const testCase of cases) {
      const response = await app.inject({
        method: "GET",
        url: testCase.url,
        headers: headers(testCase.secret),
      });
      expect(response.statusCode).toBe(testCase.expected);
    }

    const gmReference = await app.inject({
      method: "GET",
      url: projectionUrl(
        ids.character.own,
        ids.pack.own,
        ids.version.reference,
        true,
      ),
      headers: headers(secrets.gm),
    });
    expect(gmReference.statusCode).toBe(200);
  });
});

describe("UIX-262 archived spell projection routes", () => {
  it("UIX-262 hides unassigned archived nodes but preserves assigned snapshots", async () => {
    const packId = uuid();
    const oldVersionId = uuid();
    const currentVersionId = uuid();
    const schoolId = uuid();
    const archivedNodeId = uuid();
    const ordinaryNodeId = uuid();
    const dependentNodeId = uuid();
    const groupId = uuid();
    const freshCharacterId = uuid();
    const historicalCharacterId = uuid();
    const node = (
      id: string,
      displayName: string,
      mechanicsText: string,
    ): SpellProgressionGraph["nodes"][number] => ({
      id,
      packId,
      packVersionId: oldVersionId,
      schoolId,
      sourceName: `${displayName} source`,
      displayName,
      rawSourceText: `${displayName} raw source`,
      narrativeText: `${displayName} narrative`,
      mechanicsText,
      lifecycle: "ACTIVE",
      revision: 0,
      revisionProvenance: { changeNote: "UIX262_ORIGINAL_REVISION" },
      activation: { passive: true, triggers: [] },
      costs: [],
      usageLimit: null,
    });
    const oldGraph: SpellProgressionGraph = {
      ...emptyGraph(packId, oldVersionId, "ACTIVE"),
      title: "Individual archive projection",
      provenance: {
        sourceType: "GM_AUTHORED",
        sourceLabel: "UIX262_ORIGINAL_PROVENANCE",
        rawSourceText: "UIX262_ORIGINAL_PRIVATE_SOURCE",
      },
      schools: [
        {
          id: schoolId,
          packId,
          packVersionId: oldVersionId,
          slug: "archive-projection",
          sourceName: "Archive school source",
          displayName: "Archive school",
          description: "Individual node lifecycle fixture",
          visibilityPolicy: "PUBLIC",
          order: 0,
        },
      ],
      nodes: [
        node(archivedNodeId, "Retired A", "UIX262_ASSIGNED_A_OLD_MECHANICS"),
        node(ordinaryNodeId, "Ordinary B", "UIX262_ACTIVE_B_MECHANICS"),
        node(dependentNodeId, "Dependent C", "UIX262_DEPENDENT_C_MECHANICS"),
      ],
      // C makes the edge privacy check non-vacuous; B remains independent.
      requirementGroups: [
        {
          id: groupId,
          packId,
          packVersionId: oldVersionId,
          schoolId,
          targetNodeId: dependentNodeId,
          mode: "ALL",
          sourceNote: "UIX262_PRIVATE_REQUIREMENT",
        },
      ],
      edges: [
        {
          id: uuid(),
          packId,
          packVersionId: oldVersionId,
          schoolId,
          requirementGroupId: groupId,
          sourceNodeId: archivedNodeId,
          targetNodeId: dependentNodeId,
          minimumRank: 1,
        },
      ],
    };
    const currentGraph: SpellProgressionGraph = {
      ...oldGraph,
      versionId: currentVersionId,
      version: 2,
      provenance: {
        ...oldGraph.provenance,
        sourceLabel: "UIX262_CURRENT_PROVENANCE",
      },
      schools: oldGraph.schools.map((school) => ({
        ...school,
        packVersionId: currentVersionId,
      })),
      nodes: oldGraph.nodes.map((entry) => ({
        ...entry,
        packVersionId: currentVersionId,
        ...(entry.id === archivedNodeId
          ? {
              lifecycle: "ARCHIVED" as const,
              mechanicsText: "UIX262_ARCHIVED_A_CURRENT_MECHANICS",
              revision: 1,
              revisionProvenance: {
                changeNote: "UIX262_ARCHIVE_PRIVATE_REVISION",
              },
            }
          : {}),
      })),
      requirementGroups: oldGraph.requirementGroups.map((group) => ({
        ...group,
        packVersionId: currentVersionId,
      })),
      edges: oldGraph.edges.map((edge) => ({
        ...edge,
        packVersionId: currentVersionId,
      })),
    };

    await db.insert(schema.characters).values(
      [freshCharacterId, historicalCharacterId].map((id) => ({
        id,
        campaignId: ids.campaign.own,
        name: "UIX-262 projection character",
        ownerMembershipId: ids.membership.owner,
      })),
    );
    await db.insert(schema.characterControllers).values(
      [freshCharacterId, historicalCharacterId].map((characterId) => ({
        characterId,
        membershipId: ids.membership.controller,
      })),
    );
    await db.insert(schema.spellPacks).values({
      id: packId,
      campaignId: ids.campaign.own,
    });
    // Persist a mixed-lifecycle fixture, not a substitute for the separate
    // production publish-route baseline. Every GET validates the stored graph.
    await db.insert(schema.spellPackVersions).values(
      [oldGraph, currentGraph].map((graph) => ({
        id: graph.versionId,
        campaignId: ids.campaign.own,
        packId,
        version: graph.version,
        lifecycle: graph.lifecycle,
        graph,
      })),
    );
    const storeAssignment = async (
      characterId: string,
      snapshot: SpellAssignmentSnapshot,
    ) => {
      await db.insert(schema.characterSpellAssignments).values({
        id: snapshot.assignmentId,
        campaignId: ids.campaign.own,
        characterId,
        packId,
      });
      await db.insert(schema.characterSpellAssignmentVersions).values({
        id: snapshot.assignmentVersionId,
        campaignId: ids.campaign.own,
        assignmentId: snapshot.assignmentId,
        characterId,
        packId,
        packVersionId: snapshot.packVersionId,
        version: snapshot.assignmentVersion,
        kind: snapshot.kind,
        schoolId: snapshot.schoolId,
        nodeId: snapshot.nodeId,
        rank: snapshot.rank,
        snapshot,
        overrideReason: null,
        assignedByMembershipId: ids.membership.gm,
      });
    };
    const snapshotIdentity = () => ({
      assignmentId: uuid(),
      assignmentVersionId: uuid(),
      assignmentVersion: 1,
    });
    const historicalSnapshot = buildSpellAssignmentSnapshot(
      { graph: oldGraph, packVersion: 1 },
      snapshotIdentity(),
      { kind: "NODE", schoolId, nodeId: archivedNodeId, rank: 1 },
    );
    await storeAssignment(historicalCharacterId, historicalSnapshot);
    for (const characterId of [freshCharacterId, historicalCharacterId]) {
      // A SCHOOL snapshot pins the exact requested v2 for the real player
      // anchor guard, but is not an individual discovery of archived A.
      await storeAssignment(
        characterId,
        buildSpellAssignmentSnapshot(
          { graph: currentGraph, packVersion: 2 },
          snapshotIdentity(),
          { kind: "SCHOOL", schoolId },
        ),
      );
    }
    const assignmentHistory = () =>
      db
        .select()
        .from(schema.characterSpellAssignmentVersions)
        .where(
          eq(
            schema.characterSpellAssignmentVersions.assignmentId,
            historicalSnapshot.assignmentId,
          ),
        );
    const historyBefore = await assignmentHistory();
    expect(historyBefore).toHaveLength(1);
    expect(historyBefore[0]!.snapshot).toEqual(historicalSnapshot);

    const readAsOwnerAndController = (characterId: string) =>
      Promise.all(
        [secrets.owner, secrets.controller].map(async (secret) => {
          const response = await app.inject({
            method: "GET",
            url: projectionUrl(characterId, packId, currentVersionId),
            headers: headers(secret),
          });
          expect(response.statusCode).toBe(200);
          expect(response.headers["cache-control"]).toBe("private, no-store");
          const projection = playerSpellProgressionProjectionSchema.parse(
            response.json(),
          );
          expect(projection).toMatchObject({
            characterId,
            packId,
            packVersionId: currentVersionId,
          });
          expect(projection.nodes).toContainEqual(
            expect.objectContaining({
              id: ordinaryNodeId,
              state: "AVAILABLE",
              mechanicsText: "UIX262_ACTIVE_B_MECHANICS",
            }),
          );
          return { response, projection };
        }),
      );
    const fresh = await readAsOwnerAndController(freshCharacterId);
    const historical = await readAsOwnerAndController(historicalCharacterId);
    expect(fresh[0]!.projection).toEqual(fresh[1]!.projection);
    expect(historical[0]!.projection).toEqual(historical[1]!.projection);
    for (const { response, projection } of historical) {
      expect(projection.nodes).toContainEqual(
        expect.objectContaining({
          id: archivedNodeId,
          state: "DISCOVERED",
          mechanicsText: "UIX262_ASSIGNED_A_OLD_MECHANICS",
        }),
      );
      expect(response.body).not.toContain(
        "UIX262_ARCHIVED_A_CURRENT_MECHANICS",
      );
      expect(response.body).not.toContain("UIX262_ARCHIVE_PRIVATE_REVISION");
      expect(projection.edges).toContainEqual({
        sourceNodeId: archivedNodeId,
        targetNodeId: dependentNodeId,
      });
    }
    expect(await assignmentHistory()).toEqual(historyBefore);

    const gmResponse = await app.inject({
      method: "GET",
      url: projectionUrl(freshCharacterId, packId, currentVersionId, true),
      headers: headers(secrets.gm),
    });
    expect(gmResponse.statusCode).toBe(200);
    const gm = gmSpellProgressionProjectionSchema.parse(gmResponse.json());
    expect(gm.graph).toEqual(currentGraph);
    expect(gm.graph.nodes).toContainEqual(
      expect.objectContaining({
        id: archivedNodeId,
        lifecycle: "ARCHIVED",
        mechanicsText: "UIX262_ARCHIVED_A_CURRENT_MECHANICS",
      }),
    );
    expect(gm.graph.edges).toHaveLength(1);

    // Intended baseline failure: valid owner/controller responses currently
    // expose unassigned A as AVAILABLE, its current mechanics and A -> C.
    // All 200/anchor, active-B, GM and immutable-history controls run first.
    for (const { response, projection } of fresh) {
      expect(projection.nodes).toContainEqual({
        id: dependentNodeId,
        schoolId,
        displayName: "Dependent C",
        state: "LOCKED",
      });
      expect({
        containsArchivedId: response.body.includes(archivedNodeId),
        containsArchivedMechanics: response.body.includes(
          "UIX262_ARCHIVED_A_CURRENT_MECHANICS",
        ),
        containsArchivedEdge: projection.edges.some(
          (edge) =>
            edge.sourceNodeId === archivedNodeId ||
            edge.targetNodeId === archivedNodeId,
        ),
      }).toEqual({
        containsArchivedId: false,
        containsArchivedMechanics: false,
        containsArchivedEdge: false,
      });
      expect(response.body).not.toContain("UIX262_ASSIGNED_A_OLD_MECHANICS");
      expect(response.body).not.toContain("UIX262_DEPENDENT_C_MECHANICS");
      expect(response.body).not.toContain("UIX262_ARCHIVE_PRIVATE_REVISION");
      expect(projection.nodes).toHaveLength(2);
      expect(projection.edges).toEqual([]);
    }
  });
});
