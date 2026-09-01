import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import {
  campaigns,
  characters,
  characterControllers,
  characterSpellAssignments,
  characterSpellAssignmentVersions,
  createDatabase,
  gameEvents,
  memberships,
  sessions,
  spellPacks,
  spellPackVersions,
} from "@arken/db";
import type {
  SpellProgressionGraph,
  SpellReferenceImportSource,
} from "@arken/contracts";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import {
  buildSpellAssignmentSnapshot,
  type LoadedSpellGraph,
} from "./spell-assignment-storage.js";
import { registerSpellPackRoutes } from "./spell-pack-routes.js";
import { registerSpellProjectionRoutes } from "./spell-projection-routes.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for the PostgreSQL probe");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ids = {
  campaign: randomUUID(),
  foreignCampaign: randomUUID(),
  membership: {
    gm: randomUUID(),
    owner: randomUUID(),
    controller: randomUUID(),
    other: randomUUID(),
    foreignGm: randomUUID(),
  },
  character: { own: randomUUID(), foreign: randomUUID() },
  pack: {
    projection: randomUUID(),
    unassigned: randomUUID(),
    imported: randomUUID(),
  },
  version: {
    projection: randomUUID(),
    reference: randomUUID(),
    unassigned: randomUUID(),
    imported: randomUUID(),
  },
  school: { public: randomUUID(), hidden: randomUUID() },
  node: { known: randomUUID(), locked: randomUUID(), hidden: randomUUID() },
  requirementGroup: randomUUID(),
  edge: randomUUID(),
  assignment: {
    school: randomUUID(),
    known: randomUUID(),
    hidden: randomUUID(),
  },
  assignmentVersion: {
    school: randomUUID(),
    known: randomUUID(),
    hidden: randomUUID(),
  },
};

const secrets = {
  gm: "uix578-gm-".padEnd(40, "g"),
  owner: "uix578-owner-".padEnd(40, "o"),
  controller: "uix578-controller-".padEnd(40, "c"),
  other: "uix578-other-".padEnd(40, "x"),
  foreignGm: "uix578-foreign-".padEnd(40, "f"),
};

function projectionGraph(): SpellProgressionGraph {
  const node = (
    id: string,
    schoolId: string,
    displayName: string,
    mechanicsText: string,
  ) => ({
    id,
    packId: ids.pack.projection,
    packVersionId: ids.version.projection,
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
    packId: ids.pack.projection,
    versionId: ids.version.projection,
    version: 1,
    title: "UIX-578 PostgreSQL projection",
    lifecycle: "ACTIVE",
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "UIX-578 PostgreSQL probe",
      rawSourceText: "GRAPH_PRIVATE_SOURCE",
    },
    schools: [
      {
        id: ids.school.public,
        packId: ids.pack.projection,
        packVersionId: ids.version.projection,
        slug: "probe-public",
        sourceName: "Public source",
        displayName: "Public school",
        description: "Public school",
        visibilityPolicy: "PUBLIC",
        order: 0,
      },
      {
        id: ids.school.hidden,
        packId: ids.pack.projection,
        packVersionId: ids.version.projection,
        slug: "probe-hidden",
        sourceName: "Hidden source",
        displayName: "Hidden school",
        description: "HIDDEN_SCHOOL_DESCRIPTION",
        visibilityPolicy: "GM_ONLY",
        order: 1,
      },
    ],
    nodes: [
      node(
        ids.node.known,
        ids.school.public,
        "Known node",
        "GRAPH_KNOWN_MECHANICS",
      ),
      node(
        ids.node.locked,
        ids.school.public,
        "Locked node",
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
        id: ids.requirementGroup,
        packId: ids.pack.projection,
        packVersionId: ids.version.projection,
        schoolId: ids.school.public,
        targetNodeId: ids.node.locked,
        mode: "ALL",
        sourceNote: "PRIVATE_GROUP_NOTE",
      },
    ],
    edges: [
      {
        id: ids.edge,
        packId: ids.pack.projection,
        packVersionId: ids.version.projection,
        schoolId: ids.school.public,
        requirementGroupId: ids.requirementGroup,
        sourceNodeId: ids.node.known,
        targetNodeId: ids.node.locked,
        minimumRank: 2,
        gmGrantCondition: "PRIVATE_GM_CONDITION",
      },
    ],
    layout: {
      nodes: [
        { nodeId: ids.node.known, position: { x: -99_999, y: 99_999 } },
        { nodeId: ids.node.hidden, position: { x: 99_999, y: -99_999 } },
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
    title: `${lifecycle} PostgreSQL projection fixture`,
    lifecycle,
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "UIX-578 PostgreSQL access fixture",
      rawSourceText: "No assignment anchor",
    },
    schools: [],
    nodes: [],
    requirementGroups: [],
    edges: [],
  };
}

const referenceSource: SpellReferenceImportSource = {
  источник: {
    описания: "UIX-578 inline PostgreSQL review source",
    деревья: "Inline probe tree",
    предупреждение: "Связи требуют проверки мастером",
  },
  школы: [
    {
      ключ: "probe-reference",
      название: "Проба",
      узлы: [
        {
          название: "Корень",
          вариантНаСхеме: null,
          стоимостьМаны: null,
          частота: null,
          описание: "Пассивный корень",
        },
        {
          название: "Цель",
          вариантНаСхеме: null,
          стоимостьМаны: 1,
          частота: "1 раз в день",
          описание: "Скрытые правила импортируемой цели",
        },
      ],
      связи: [{ откуда: "Корень", куда: "Цель" }],
      безСвязей: [],
    },
  ],
  требуетУточнения: ["Проба: «Цель» — требуется проверка мастером"],
};

const graph = projectionGraph();
const { client, db } = createDatabase(connectionString);
let app: FastifyInstance | undefined;

try {
  await db.insert(campaigns).values([
    { id: ids.campaign, name: "UIX-578 PostgreSQL probe" },
    { id: ids.foreignCampaign, name: "UIX-578 foreign probe" },
  ]);
  await db.insert(memberships).values([
    {
      id: ids.membership.gm,
      campaignId: ids.campaign,
      role: "GM",
      displayName: "Projection GM",
    },
    {
      id: ids.membership.owner,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Projection owner",
    },
    {
      id: ids.membership.controller,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Projection controller",
    },
    {
      id: ids.membership.other,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Other player",
    },
    {
      id: ids.membership.foreignGm,
      campaignId: ids.foreignCampaign,
      role: "GM",
      displayName: "Foreign projection GM",
    },
  ]);
  await db.insert(sessions).values(
    [
      [ids.membership.gm, secrets.gm],
      [ids.membership.owner, secrets.owner],
      [ids.membership.controller, secrets.controller],
      [ids.membership.other, secrets.other],
      [ids.membership.foreignGm, secrets.foreignGm],
    ].map(([membershipId, secret]) => ({
      membershipId: membershipId!,
      tokenHash: hashToken(secret!),
      expiresAt: new Date(Date.now() + 600_000),
    })),
  );
  await db.insert(characters).values([
    {
      id: ids.character.own,
      campaignId: ids.campaign,
      name: "Projection hero",
      ownerMembershipId: ids.membership.owner,
    },
    {
      id: ids.character.foreign,
      campaignId: ids.foreignCampaign,
      name: "Foreign projection hero",
    },
  ]);
  await db.insert(characterControllers).values({
    characterId: ids.character.own,
    membershipId: ids.membership.controller,
  });
  await db.insert(spellPacks).values([
    { id: ids.pack.projection, campaignId: ids.campaign },
    { id: ids.pack.unassigned, campaignId: ids.campaign },
  ]);
  await db.insert(spellPackVersions).values([
    {
      id: ids.version.projection,
      campaignId: ids.campaign,
      packId: ids.pack.projection,
      version: 1,
      lifecycle: "ACTIVE",
      graph,
    },
    {
      id: ids.version.reference,
      campaignId: ids.campaign,
      packId: ids.pack.projection,
      version: 2,
      lifecycle: "REFERENCE",
      graph: {
        ...emptyGraph(ids.pack.projection, ids.version.reference, "REFERENCE"),
        version: 2,
      },
    },
    {
      id: ids.version.unassigned,
      campaignId: ids.campaign,
      packId: ids.pack.unassigned,
      version: 1,
      lifecycle: "ACTIVE",
      graph: emptyGraph(ids.pack.unassigned, ids.version.unassigned, "ACTIVE"),
    },
  ]);

  const source: LoadedSpellGraph = {
    graph,
    packVersion: 1,
  };
  const schoolSnapshot = buildSpellAssignmentSnapshot(
    source,
    {
      assignmentId: ids.assignment.school,
      assignmentVersionId: ids.assignmentVersion.school,
      assignmentVersion: 1,
    },
    { kind: "SCHOOL", schoolId: ids.school.public },
  );
  const knownSnapshot = buildSpellAssignmentSnapshot(
    source,
    {
      assignmentId: ids.assignment.known,
      assignmentVersionId: ids.assignmentVersion.known,
      assignmentVersion: 1,
    },
    {
      kind: "NODE",
      schoolId: ids.school.public,
      nodeId: ids.node.known,
      rank: 1,
    },
  );
  assert(knownSnapshot.kind === "NODE", "known snapshot is not a node");
  knownSnapshot.node.mechanicsText = "SNAPSHOT_KNOWN_MECHANICS";
  const hiddenSnapshot = buildSpellAssignmentSnapshot(
    source,
    {
      assignmentId: ids.assignment.hidden,
      assignmentVersionId: ids.assignmentVersion.hidden,
      assignmentVersion: 1,
    },
    {
      kind: "NODE",
      schoolId: ids.school.hidden,
      nodeId: ids.node.hidden,
      rank: 1,
    },
  );

  await db.insert(characterSpellAssignments).values(
    Object.values(ids.assignment).map((assignmentId) => ({
      id: assignmentId,
      campaignId: ids.campaign,
      characterId: ids.character.own,
      packId: ids.pack.projection,
    })),
  );
  await db.insert(characterSpellAssignmentVersions).values([
    {
      id: ids.assignmentVersion.school,
      campaignId: ids.campaign,
      assignmentId: ids.assignment.school,
      characterId: ids.character.own,
      packId: ids.pack.projection,
      packVersionId: ids.version.projection,
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
      id: ids.assignmentVersion.known,
      campaignId: ids.campaign,
      assignmentId: ids.assignment.known,
      characterId: ids.character.own,
      packId: ids.pack.projection,
      packVersionId: ids.version.projection,
      version: 1,
      kind: "NODE",
      schoolId: ids.school.public,
      nodeId: ids.node.known,
      rank: 1,
      snapshot: knownSnapshot,
      overrideReason: null,
      assignedByMembershipId: ids.membership.gm,
    },
    {
      id: ids.assignmentVersion.hidden,
      campaignId: ids.campaign,
      assignmentId: ids.assignment.hidden,
      characterId: ids.character.own,
      packId: ids.pack.projection,
      packVersionId: ids.version.projection,
      version: 1,
      kind: "NODE",
      schoolId: ids.school.hidden,
      nodeId: ids.node.hidden,
      rank: 1,
      snapshot: hiddenSnapshot,
      overrideReason: null,
      assignedByMembershipId: ids.membership.gm,
    },
  ]);

  app = Fastify();
  await app.register(cookie);
  registerSpellPackRoutes(app, db);
  registerSpellProjectionRoutes(app, db);
  await app.ready();

  const headers = (secret: string) => ({
    cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
  });
  const projectionUrl = (
    gm = false,
    packId = ids.pack.projection,
    packVersionId = ids.version.projection,
  ) =>
    `${gm ? "/api/gm" : "/api"}/characters/${ids.character.own}/spell-progression?packId=${packId}&packVersionId=${packVersionId}`;

  for (const secret of [secrets.owner, secrets.controller, secrets.gm]) {
    const response = await app.inject({
      method: "GET",
      url: projectionUrl(),
      headers: headers(secret),
    });
    assert(response.statusCode === 200, "safe projection request failed");
    assert(
      response.body.includes("SNAPSHOT_KNOWN_MECHANICS"),
      "discovered snapshot mechanics are missing",
    );
    for (const secretValue of [
      "GRAPH_KNOWN_MECHANICS",
      "LOCKED_SECRET_MECHANICS",
      "HIDDEN_SECRET_MECHANICS",
      "GRAPH_PRIVATE_SOURCE",
      "PRIVATE_GROUP_NOTE",
      "PRIVATE_GM_CONDITION",
      ids.node.hidden,
    ])
      assert(
        !response.body.includes(secretValue),
        `safe projection leaked ${secretValue}`,
      );
  }

  const deniedPlayer = await app.inject({
    method: "GET",
    url: projectionUrl(),
    headers: headers(secrets.other),
  });
  assert(deniedPlayer.statusCode === 404, "unrelated player read character");
  const referencePlayer = await app.inject({
    method: "GET",
    url: projectionUrl(false, ids.pack.projection, ids.version.reference),
    headers: headers(secrets.owner),
  });
  assert(
    referencePlayer.statusCode === 404,
    "player read a REFERENCE projection",
  );
  const unassignedPlayer = await app.inject({
    method: "GET",
    url: projectionUrl(false, ids.pack.unassigned, ids.version.unassigned),
    headers: headers(secrets.owner),
  });
  assert(
    unassignedPlayer.statusCode === 404,
    "player read an ACTIVE projection without an assignment anchor",
  );
  const foreignGm = await app.inject({
    method: "GET",
    url: projectionUrl(true),
    headers: headers(secrets.foreignGm),
  });
  assert(foreignGm.statusCode === 404, "foreign campaign read projection");
  const playerGmRoute = await app.inject({
    method: "GET",
    url: projectionUrl(true),
    headers: headers(secrets.owner),
  });
  assert(playerGmRoute.statusCode === 403, "player reached GM projection");
  const gmProjection = await app.inject({
    method: "GET",
    url: projectionUrl(true),
    headers: headers(secrets.gm),
  });
  assert(gmProjection.statusCode === 200, "GM projection request failed");
  assert(
    gmProjection.body.includes("LOCKED_SECRET_MECHANICS") &&
      gmProjection.body.includes("HIDDEN_SECRET_MECHANICS") &&
      gmProjection.body.includes("GRAPH_PRIVATE_SOURCE"),
    "GM projection is incomplete",
  );

  const previewPayload = {
    packId: ids.pack.imported,
    versionId: ids.version.imported,
    version: 1,
    source: referenceSource,
  };
  const playerPreview = await app.inject({
    method: "POST",
    url: "/api/spell-packs/imports/reference/preview",
    headers: headers(secrets.owner),
    payload: previewPayload,
  });
  assert(playerPreview.statusCode === 403, "player reached reference import");
  const preview = await app.inject({
    method: "POST",
    url: "/api/spell-packs/imports/reference/preview",
    headers: headers(secrets.gm),
    payload: previewPayload,
  });
  assert(preview.statusCode === 200, "reference preview failed");
  const previewBody = preview.json();
  assert(
    previewBody.graph.lifecycle === "REFERENCE" &&
      previewBody.graph.importWarnings.length === 1 &&
      previewBody.graph.importWarnings[0].status === "OPEN",
    "reference preview lost its review-only warning",
  );

  const createActionId = randomUUID();
  const created = await app.inject({
    method: "POST",
    url: "/api/spell-packs",
    headers: headers(secrets.gm),
    payload: {
      actionId: createActionId,
      expectedVersion: 0,
      graph: previewBody.graph,
    },
  });
  assert(created.statusCode === 201, "reference persistence failed");
  const rejectedActionId = randomUUID();
  const promotion = await app.inject({
    method: "POST",
    url: `/api/spell-packs/${ids.pack.imported}/lifecycle`,
    headers: headers(secrets.gm),
    payload: {
      actionId: rejectedActionId,
      expectedVersion: 1,
      versionId: randomUUID(),
      lifecycle: "ACTIVE",
    },
  });
  assert(
    promotion.statusCode === 422,
    "OPEN import warning reached ACTIVE lifecycle",
  );
  const importedVersions = await db
    .select()
    .from(spellPackVersions)
    .where(eq(spellPackVersions.packId, ids.pack.imported));
  assert(importedVersions.length === 1, "failed promotion wrote a version");
  const events = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, ids.campaign),
        eq(gameEvents.entityId, ids.pack.imported),
      ),
    )
    .orderBy(asc(gameEvents.sequence));
  assert(events.length === 1, "failed promotion wrote an audit event");
  const audit = JSON.stringify(events[0]!.payload);
  assert(
    !audit.includes("graph") &&
      !audit.includes("mechanics") &&
      !audit.includes("требуетУточнения"),
    "reference import audit leaked source content",
  );

  console.log("[spell-projection-probe] access, privacy and import passed");
} finally {
  if (app) await app.close();
  await db.delete(campaigns).where(eq(campaigns.id, ids.campaign));
  await db.delete(campaigns).where(eq(campaigns.id, ids.foreignCampaign));
  await client.end();
}
