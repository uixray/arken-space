import { readdir, readFile } from "node:fs/promises";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import Fastify, { type FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SPELL_REFERENCE_IMPORT_MAX_SOURCE_CHARS,
  type SpellProgressionGraph,
} from "@arken/contracts";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerSpellPackRoutes } from "./spell-pack-routes.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;

const id = () => crypto.randomUUID();
const ids = {
  campaign: { own: id(), foreign: id() },
  gm: { own: id(), foreign: id() },
  player: id(),
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
  overrides: Partial<SpellProgressionGraph> = {},
): SpellProgressionGraph {
  return {
    packId,
    versionId,
    version: 1,
    title: "API spell pack",
    lifecycle: "DRAFT",
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "UIX-580 HTTP test",
      rawSourceText: "Private mechanics source text",
    },
    schools: [],
    nodes: [],
    requirementGroups: [],
    edges: [],
    ...overrides,
  };
}

function unresolvedGraph(
  packId: string,
  versionId: string,
  lifecycle: SpellProgressionGraph["lifecycle"] = "DRAFT",
): SpellProgressionGraph {
  const schoolId = id();
  const sourceId = id();
  const targetId = id();
  const groupId = id();
  const node = (nodeId: string, label: string) => ({
    id: nodeId,
    packId,
    packVersionId: versionId,
    schoolId,
    sourceName: label,
    displayName: label,
    rawSourceText: `${label} raw source`,
    narrativeText: `${label} narrative`,
    mechanicsText: `${label} secret mechanics`,
    lifecycle: "DRAFT" as const,
    revision: 0,
    revisionProvenance: {},
    activation: { passive: true, triggers: [] },
    costs: [],
    usageLimit: null,
  });
  return graph(packId, versionId, {
    lifecycle,
    schools: [
      {
        id: schoolId,
        packId,
        packVersionId: versionId,
        slug: "unresolved-school",
        sourceName: "Unresolved school",
        displayName: "Unresolved school",
        description: "",
        visibilityPolicy: "PUBLIC",
        order: 0,
      },
    ],
    nodes: [node(sourceId, "Source"), node(targetId, "Target")],
    requirementGroups: [
      {
        id: groupId,
        packId,
        packVersionId: versionId,
        schoolId,
        targetNodeId: targetId,
        mode: "UNRESOLVED",
      },
    ],
    edges: [
      {
        id: id(),
        packId,
        packVersionId: versionId,
        schoolId,
        requirementGroupId: groupId,
        sourceNodeId: sourceId,
        targetNodeId: targetId,
      },
    ],
  });
}

async function eventsForPack(campaignId: string, packId: string) {
  return db
    .select()
    .from(schema.gameEvents)
    .where(
      and(
        eq(schema.gameEvents.campaignId, campaignId),
        eq(schema.gameEvents.entityId, packId),
      ),
    )
    .orderBy(asc(schema.gameEvents.sequence));
}

async function versionsForPack(campaignId: string, packId: string) {
  return db
    .select()
    .from(schema.spellPackVersions)
    .where(
      and(
        eq(schema.spellPackVersions.campaignId, campaignId),
        eq(schema.spellPackVersions.packId, packId),
      ),
    )
    .orderBy(asc(schema.spellPackVersions.version));
}

async function createPack(
  requestHeaders: Record<string, string>,
  candidate: SpellProgressionGraph,
  actionId = id(),
) {
  return app.inject({
    method: "POST",
    url: "/api/spell-packs",
    headers: requestHeaders,
    payload: { actionId, expectedVersion: 0, graph: candidate },
  });
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
    { id: ids.campaign.own, name: "Own spell API campaign" },
    { id: ids.campaign.foreign, name: "Foreign spell API campaign" },
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

  app = Fastify();
  await app.register(cookie);
  registerSpellPackRoutes(app, db as never);
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app.close();
  await database.close();
});

describe("UIX-580 spell-pack GM API", () => {
  it("keeps the 2024 import in review until warnings are resolved", async () => {
    const source = JSON.parse(
      await readFile(
        new URL("../../../docs/content/magic-schools.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    const packId = id();
    const versionId = id();
    const previewPayload = {
      packId,
      versionId,
      version: 1,
      source,
    };

    const playerPreview = await app.inject({
      method: "POST",
      url: "/api/spell-packs/imports/reference/preview",
      headers: playerHeaders,
      payload: previewPayload,
    });
    expect(playerPreview.statusCode).toBe(403);
    expect(playerPreview.json()).toEqual({ error: "GM_REQUIRED" });

    const activeInjection = await app.inject({
      method: "POST",
      url: "/api/spell-packs/imports/reference/preview",
      headers: ownGmHeaders,
      payload: { ...previewPayload, lifecycle: "ACTIVE" },
    });
    expect(activeInjection.statusCode).toBe(400);
    expect(activeInjection.json()).toEqual({ error: "INVALID_REQUEST" });

    const oversizedTransport = await app.inject({
      method: "POST",
      url: "/api/spell-packs/imports/reference/preview",
      headers: { ...ownGmHeaders, "content-type": "application/json" },
      payload: JSON.stringify({
        ...previewPayload,
        padding: "x".repeat(SPELL_REFERENCE_IMPORT_MAX_SOURCE_CHARS * 4),
      }),
    });
    expect(oversizedTransport.statusCode).toBe(413);

    const preview = await app.inject({
      method: "POST",
      url: "/api/spell-packs/imports/reference/preview",
      headers: ownGmHeaders,
      payload: previewPayload,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["cache-control"]).toBe("private, no-store");
    const candidate = preview.json();
    expect(candidate.graph).toMatchObject({
      packId,
      versionId,
      version: 1,
      lifecycle: "REFERENCE",
    });
    expect(candidate.graph.schools).toHaveLength(13);
    expect(candidate.graph.nodes).toHaveLength(145);
    expect(candidate.graph.edges).toHaveLength(114);
    expect(candidate.graph.importWarnings).toHaveLength(31);
    expect(
      candidate.graph.importWarnings.every(
        (warning: { status: string }) => warning.status === "OPEN",
      ),
    ).toBe(true);
    expect(candidate.validation).toMatchObject({ valid: true, errors: [] });
    expect(candidate.validation.warnings).toHaveLength(37);
    expect(
      candidate.validation.warnings.filter(
        (warning: { code: string }) =>
          warning.code === "UNRESOLVED_REQUIREMENT_GROUP",
      ),
    ).toHaveLength(6);
    expect(
      candidate.validation.warnings.filter(
        (warning: { code: string }) => warning.code === "OPEN_IMPORT_WARNING",
      ),
    ).toHaveLength(31);

    const created = await createPack(ownGmHeaders, candidate.graph);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      packId,
      versionId,
      lifecycle: "REFERENCE",
    });
    expect(created.json().warnings).toHaveLength(37);

    const rejectedActionId = id();
    const promotion = await app.inject({
      method: "POST",
      url: `/api/spell-packs/${packId}/lifecycle`,
      headers: ownGmHeaders,
      payload: {
        actionId: rejectedActionId,
        expectedVersion: 1,
        versionId: id(),
        lifecycle: "ACTIVE",
      },
    });
    expect(promotion.statusCode).toBe(422);
    expect(promotion.json()).toMatchObject({
      error: "SPELL_GRAPH_SEMANTIC_INVALID",
    });
    expect(promotion.json().details).toHaveLength(37);
    expect(await versionsForPack(ids.campaign.own, packId)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.actionId, rejectedActionId)),
    ).toHaveLength(0);

    const events = await eventsForPack(ids.campaign.own, packId);
    expect(events).toHaveLength(1);
    const serializedAudit = JSON.stringify(events[0]!.payload);
    expect(serializedAudit).not.toContain("graph");
    expect(serializedAudit).not.toContain("требуетУточнения");
    expect(serializedAudit).not.toContain("mechanics");

    const reviewedVersionId = id();
    const reviewedGraph = {
      ...candidate.graph,
      versionId: reviewedVersionId,
      version: 2,
      lifecycle: "DRAFT",
      schools: candidate.graph.schools.map(
        (school: Record<string, unknown>) => ({
          ...school,
          packVersionId: reviewedVersionId,
        }),
      ),
      nodes: candidate.graph.nodes.map((node: Record<string, unknown>) => ({
        ...node,
        packVersionId: reviewedVersionId,
        lifecycle: "DRAFT",
      })),
      requirementGroups: candidate.graph.requirementGroups.map(
        (group: Record<string, unknown>) => ({
          ...group,
          packVersionId: reviewedVersionId,
          mode: group.mode === "UNRESOLVED" ? "ALL" : group.mode,
        }),
      ),
      edges: candidate.graph.edges.map((edge: Record<string, unknown>) => ({
        ...edge,
        packVersionId: reviewedVersionId,
      })),
      importWarnings: candidate.graph.importWarnings.map(
        (warning: Record<string, unknown>) => ({
          ...warning,
          status: "RESOLVED",
          resolutionReason: "Проверено мастером в новой immutable версии",
        }),
      ),
    };
    const reviewed = await app.inject({
      method: "POST",
      url: `/api/spell-packs/${packId}/versions`,
      headers: ownGmHeaders,
      payload: {
        actionId: id(),
        expectedVersion: 1,
        graph: reviewedGraph,
      },
    });
    expect(reviewed.statusCode).toBe(201);
    expect(reviewed.json()).toMatchObject({
      versionId: reviewedVersionId,
      version: 2,
      lifecycle: "DRAFT",
      warnings: [],
    });

    const activeVersionId = id();
    const activated = await app.inject({
      method: "POST",
      url: `/api/spell-packs/${packId}/lifecycle`,
      headers: ownGmHeaders,
      payload: {
        actionId: id(),
        expectedVersion: 2,
        versionId: activeVersionId,
        lifecycle: "ACTIVE",
      },
    });
    expect(activated.statusCode).toBe(201);
    const activeGraph = activated.json().graph;
    expect(activeGraph.lifecycle).toBe("ACTIVE");
    expect(activeGraph.importWarnings).toHaveLength(31);
    expect(
      activeGraph.importWarnings.every(
        (warning: { status: string; resolutionReason?: string }) =>
          warning.status === "RESOLVED" &&
          warning.resolutionReason ===
            "Проверено мастером в новой immutable версии",
      ),
    ).toBe(true);
    expect(
      activeGraph.requirementGroups.every(
        (group: { mode: string }) => group.mode !== "UNRESOLVED",
      ),
    ).toBe(true);
    expect(
      activeGraph.nodes.every(
        (node: { lifecycle: string; packVersionId: string }) =>
          node.lifecycle === "ACTIVE" && node.packVersionId === activeVersionId,
      ),
    ).toBe(true);
    expect(
      (await versionsForPack(ids.campaign.own, packId)).map(
        ({ version, lifecycle }) => [version, lifecycle],
      ),
    ).toEqual([
      [1, "REFERENCE"],
      [2, "DRAFT"],
      [3, "ACTIVE"],
    ]);
    const finalEvents = await eventsForPack(ids.campaign.own, packId);
    expect(finalEvents).toHaveLength(3);
    for (const event of finalEvents) {
      const serialized = JSON.stringify(event.payload);
      expect(serialized).not.toContain("graph");
      expect(serialized).not.toContain("mechanics");
      expect(serialized).not.toContain("требуетУточнения");
    }
  });

  it("validates malformed and unresolved candidates without persistence", async () => {
    const beforePacks = await db.select().from(schema.spellPacks);
    const beforeEvents = await db.select().from(schema.gameEvents);

    const malformed = await app.inject({
      method: "POST",
      url: "/api/spell-packs/validate",
      headers: ownGmHeaders,
      payload: { graph: {} },
    });
    expect(malformed.statusCode).toBe(200);
    expect(malformed.json()).toMatchObject({ valid: false, warnings: [] });
    expect(malformed.json().errors[0]).toMatchObject({
      code: "SCHEMA_INVALID",
    });

    const packId = id();
    const draft = unresolvedGraph(packId, id());
    const draftValidation = await app.inject({
      method: "POST",
      url: "/api/spell-packs/validate",
      headers: ownGmHeaders,
      payload: { graph: draft },
    });
    expect(draftValidation.json()).toMatchObject({
      valid: true,
      errors: [],
      warnings: [{ code: "UNRESOLVED_REQUIREMENT_GROUP" }],
    });

    const activeValidation = await app.inject({
      method: "POST",
      url: "/api/spell-packs/validate",
      headers: ownGmHeaders,
      payload: { graph: { ...draft, lifecycle: "ACTIVE" } },
    });
    expect(activeValidation.json()).toMatchObject({
      valid: false,
      errors: [{ code: "UNRESOLVED_REQUIREMENT_GROUP" }],
      warnings: [],
    });

    const playerValidation = await app.inject({
      method: "POST",
      url: "/api/spell-packs/validate",
      headers: playerHeaders,
      payload: { graph: draft },
    });
    expect(playerValidation.statusCode).toBe(403);
    expect(playerValidation.json()).toEqual({ error: "GM_REQUIRED" });
    expect(await db.select().from(schema.spellPacks)).toEqual(beforePacks);
    expect(await db.select().from(schema.gameEvents)).toEqual(beforeEvents);
  });

  it("creates immutable draft, active and archived versions with metadata-only audit", async () => {
    const packId = id();
    const firstActionId = id();
    const firstGraph = graph(packId, id(), { title: "Initial mechanics" });
    const createPayload = {
      actionId: firstActionId,
      expectedVersion: 0,
      graph: firstGraph,
    };
    const created = await app.inject({
      method: "POST",
      url: "/api/spell-packs",
      headers: ownGmHeaders,
      payload: createPayload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      packId,
      versionId: firstGraph.versionId,
      version: 1,
      lifecycle: "DRAFT",
    });

    const replay = await app.inject({
      method: "POST",
      url: "/api/spell-packs",
      headers: ownGmHeaders,
      payload: createPayload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(created.json());

    const draftGraph = graph(packId, id(), {
      version: 2,
      title: "Edited private mechanics",
    });
    const drafted = await app.inject({
      method: "POST",
      url: `/api/spell-packs/${packId}/versions`,
      headers: ownGmHeaders,
      payload: { actionId: id(), expectedVersion: 1, graph: draftGraph },
    });
    expect(drafted.statusCode).toBe(201);
    expect(drafted.json()).toMatchObject({ version: 2, lifecycle: "DRAFT" });

    const activeVersionId = id();
    const activated = await app.inject({
      method: "POST",
      url: `/api/spell-packs/${packId}/lifecycle`,
      headers: ownGmHeaders,
      payload: {
        actionId: id(),
        expectedVersion: 2,
        versionId: activeVersionId,
        lifecycle: "ACTIVE",
      },
    });
    expect(activated.statusCode).toBe(201);
    expect(activated.json()).toMatchObject({
      versionId: activeVersionId,
      version: 3,
      lifecycle: "ACTIVE",
      graph: { title: "Edited private mechanics" },
    });

    const archivedVersionId = id();
    const archived = await app.inject({
      method: "POST",
      url: `/api/spell-packs/${packId}/archive`,
      headers: ownGmHeaders,
      payload: {
        actionId: id(),
        expectedVersion: 3,
        versionId: archivedVersionId,
      },
    });
    expect(archived.statusCode).toBe(201);
    expect(archived.json()).toMatchObject({
      versionId: archivedVersionId,
      version: 4,
      lifecycle: "ARCHIVED",
      graph: { title: "Edited private mechanics" },
    });

    const versions = await versionsForPack(ids.campaign.own, packId);
    expect(versions.map((item) => [item.version, item.lifecycle])).toEqual([
      [1, "DRAFT"],
      [2, "DRAFT"],
      [3, "ACTIVE"],
      [4, "ARCHIVED"],
    ]);
    expect(
      versions.map((item) => (item.graph as SpellProgressionGraph).title),
    ).toEqual([
      "Initial mechanics",
      "Edited private mechanics",
      "Edited private mechanics",
      "Edited private mechanics",
    ]);

    const events = await eventsForPack(ids.campaign.own, packId);
    expect(events.map((event) => event.type)).toEqual([
      "spell_pack.created",
      "spell_pack.version_created",
      "spell_pack.lifecycle_changed",
      "spell_pack.archived",
    ]);
    for (const event of events) {
      expect(event.entityType).toBe("SPELL_PACK");
      expect(event.payload).toMatchObject({
        commandHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        targetVersionId: expect.any(String),
        targetVersion: expect.any(Number),
        lifecycle: expect.any(String),
        expectedVersion: expect.any(Number),
      });
      expect(event.payload).not.toHaveProperty("graph");
      const serialized = JSON.stringify(event.payload);
      expect(serialized).not.toContain("private mechanics");
      expect(serialized).not.toContain("schools");
      expect(serialized).not.toContain("nodes");
      expect(serialized).not.toContain("edges");
    }
  });

  it("rolls back stale CAS and rejects actionId reuse with a different command", async () => {
    const packId = id();
    const created = await createPack(
      ownGmHeaders,
      graph(packId, id(), { title: "CAS v1" }),
    );
    expect(created.statusCode).toBe(201);

    const appendActionId = id();
    const second = graph(packId, id(), { version: 2, title: "CAS v2" });
    const appended = await app.inject({
      method: "POST",
      url: `/api/spell-packs/${packId}/versions`,
      headers: ownGmHeaders,
      payload: { actionId: appendActionId, expectedVersion: 1, graph: second },
    });
    expect(appended.statusCode).toBe(201);

    const conflictingReplay = await app.inject({
      method: "POST",
      url: `/api/spell-packs/${packId}/versions`,
      headers: ownGmHeaders,
      payload: {
        actionId: appendActionId,
        expectedVersion: 1,
        graph: { ...second, title: "Different command" },
      },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json()).toEqual({ error: "ACTION_ID_CONFLICT" });

    const staleActionId = id();
    const stale = await app.inject({
      method: "POST",
      url: `/api/spell-packs/${packId}/versions`,
      headers: ownGmHeaders,
      payload: {
        actionId: staleActionId,
        expectedVersion: 1,
        graph: graph(packId, id(), { version: 2, title: "Stale write" }),
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({
      error: "SPELL_PACK_VERSION_CONFLICT",
      details: { expectedVersion: 1, actualVersion: 2 },
    });
    expect(await versionsForPack(ids.campaign.own, packId)).toHaveLength(2);
    expect(
      await db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.actionId, staleActionId)),
    ).toHaveLength(0);
  });

  it("does not promote unresolved requirements to ACTIVE and rolls back its event", async () => {
    const packId = id();
    const first = unresolvedGraph(packId, id());
    const created = await createPack(ownGmHeaders, first);
    expect(created.statusCode).toBe(201);
    expect(created.json().warnings).toMatchObject([
      { code: "UNRESOLVED_REQUIREMENT_GROUP" },
    ]);

    const rejectedActionId = id();
    const rejected = await app.inject({
      method: "POST",
      url: `/api/spell-packs/${packId}/lifecycle`,
      headers: ownGmHeaders,
      payload: {
        actionId: rejectedActionId,
        expectedVersion: 1,
        versionId: id(),
        lifecycle: "ACTIVE",
      },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({
      error: "SPELL_GRAPH_SEMANTIC_INVALID",
      details: [{ code: "UNRESOLVED_REQUIREMENT_GROUP" }],
    });
    expect(await versionsForPack(ids.campaign.own, packId)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.actionId, rejectedActionId)),
    ).toHaveLength(0);

    const referenceVersionId = id();
    const referenced = await app.inject({
      method: "POST",
      url: `/api/spell-packs/${packId}/lifecycle`,
      headers: ownGmHeaders,
      payload: {
        actionId: id(),
        expectedVersion: 1,
        versionId: referenceVersionId,
        lifecycle: "REFERENCE",
      },
    });
    expect(referenced.statusCode).toBe(201);
    expect(referenced.json()).toMatchObject({
      versionId: referenceVersionId,
      lifecycle: "REFERENCE",
      warnings: [{ code: "UNRESOLVED_REQUIREMENT_GROUP" }],
    });
    const referenceGraph = referenced.json().graph as SpellProgressionGraph;
    for (const entity of [
      ...referenceGraph.schools,
      ...referenceGraph.nodes,
      ...referenceGraph.requirementGroups,
      ...referenceGraph.edges,
    ])
      expect(entity.packVersionId).toBe(referenceVersionId);
  });

  it("requires GM and hides foreign packs for every ID mutation route", async () => {
    const playerPackId = id();
    const playerCreate = await createPack(
      playerHeaders,
      graph(playerPackId, id()),
    );
    expect(playerCreate.statusCode).toBe(403);
    expect(playerCreate.json()).toEqual({ error: "GM_REQUIRED" });

    const activeAtCreate = await createPack(
      ownGmHeaders,
      graph(id(), id(), { lifecycle: "ACTIVE" }),
    );
    expect(activeAtCreate.statusCode).toBe(422);
    expect(activeAtCreate.json()).toEqual({
      error: "SPELL_PACK_INITIAL_LIFECYCLE_INVALID",
    });

    const foreignPackId = id();
    const foreignGraph = graph(foreignPackId, id(), {
      lifecycle: "REFERENCE",
      title: "Foreign reference",
    });
    const foreignCreated = await createPack(foreignGmHeaders, foreignGraph);
    expect(foreignCreated.statusCode).toBe(201);
    expect(foreignCreated.json().lifecycle).toBe("REFERENCE");

    const probes = [
      {
        suffix: "/versions",
        payload: {
          actionId: id(),
          expectedVersion: 1,
          graph: graph(foreignPackId, id(), { version: 2 }),
        },
      },
      {
        suffix: "/lifecycle",
        payload: {
          actionId: id(),
          expectedVersion: 1,
          versionId: id(),
          lifecycle: "ACTIVE",
        },
      },
      {
        suffix: "/archive",
        payload: {
          actionId: id(),
          expectedVersion: 1,
          versionId: id(),
        },
      },
    ];
    for (const probe of probes) {
      const response = await app.inject({
        method: "POST",
        url: `/api/spell-packs/${foreignPackId}${probe.suffix}`,
        headers: ownGmHeaders,
        payload: probe.payload,
      });
      expect(response.statusCode, probe.suffix).toBe(404);
      expect(response.json(), probe.suffix).toEqual({
        error: "SPELL_PACK_NOT_FOUND",
      });
    }
    expect(
      await versionsForPack(ids.campaign.foreign, foreignPackId),
    ).toHaveLength(1);
    expect(await eventsForPack(ids.campaign.own, foreignPackId)).toHaveLength(
      0,
    );
  });
});
