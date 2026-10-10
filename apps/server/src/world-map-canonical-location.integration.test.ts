import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerWorldMapRoutes } from "./world-map-routes.js";
import { buildWorldMapsSnapshot } from "./world-maps.js";

const id = () => crypto.randomUUID();
const campaignId = id();
const gmId = id();
const playerId = id();
const mapId = id();
const secrets = { gm: "g".repeat(40), player: "p".repeat(40) };
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});
let pg: PGlite;
let app: ReturnType<typeof Fastify>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pg.exec(
      (await readFile(new URL(file, migrations), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  db = drizzle(pg, { schema });
  await db
    .insert(schema.campaigns)
    .values({ id: campaignId, name: "Synthetic" });
  await db.insert(schema.memberships).values([
    { id: gmId, campaignId, role: "GM", displayName: "GM" },
    { id: playerId, campaignId, role: "PLAYER", displayName: "Player" },
  ]);
  for (const [membershipId, secret] of [
    [gmId, secrets.gm],
    [playerId, secrets.player],
  ] as const)
    await db
      .insert(schema.sessions)
      .values({
        membershipId,
        tokenHash: hashToken(secret),
        expiresAt: new Date(Date.now() + 60_000),
      });
  await db
    .insert(schema.worldMaps)
    .values({ id: mapId, campaignId, name: "Map" });
  app = Fastify();
  await app.register(cookie);
  registerWorldMapRoutes(app, db as never, async () => {});
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await pg?.close();
});

describe("world map canonical LOCATION references", () => {
  it("validates, sets, preserves on omission, changes, clears, and never copies canonical text", async () => {
    const valid = id();
    const wrongType = id();
    await db.insert(schema.worldContent).values([
      {
        id: valid,
        slug: `loc-${valid.slice(0, 8)}`,
        type: "LOCATION",
        name: "Canon name",
        lifecycle: "DRAFT",
      },
      {
        id: wrongType,
        slug: `item-${wrongType.slice(0, 8)}`,
        type: "ITEM",
        name: "Not a place",
      },
    ]);
    const create = (
      canonicalLocationId: string,
      name: string,
      actionId = id(),
    ) =>
      app.inject({
        method: "POST",
        url: "/api/world-maps/locations",
        headers: headers(secrets.gm),
        payload: { actionId, mapId, name, x: 0.3, y: 0.7, canonicalLocationId },
      });
    const unknownResponse = await create(id(), "Unknown");
    expect(unknownResponse.statusCode, unknownResponse.body).toBe(400);
    const wrongTypeResponse = await create(wrongType, "Wrong type");
    expect(wrongTypeResponse.statusCode, wrongTypeResponse.body).toBe(400);
    const createActionId = id();
    const created = await create(valid, "Map's own name", createActionId);
    expect(created.statusCode).toBe(201);
    const first = created.json();
    expect(first).toMatchObject({
      canonicalLocationId: valid,
      name: "Map's own name",
    });
    expect(first).not.toHaveProperty("canonicalName");
    await db
      .update(schema.worldContent)
      .set({ type: "ITEM" })
      .where(eq(schema.worldContent.id, valid));
    const replay = await create(valid, "Map's own name", createActionId);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().canonicalLocationId).toBe(valid);
    let revision = first.revision;
    const patch = async (payload: Record<string, unknown>) => {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/world-maps/locations/${first.id}`,
        headers: headers(secrets.gm),
        payload: { actionId: id(), revision, ...payload },
      });
      if (response.statusCode === 200) revision = response.json().revision;
      return response;
    };
    const omitted = await patch({ summary: "Independent node text" });
    expect(omitted.json().canonicalLocationId).toBe(valid);
    const replacement = id();
    await db
      .insert(schema.worldContent)
      .values({
        id: replacement,
        slug: `loc-${replacement.slice(0, 8)}`,
        type: "LOCATION",
        name: "Second",
      });
    const changed = await patch({ canonicalLocationId: replacement });
    expect(changed.json().canonicalLocationId).toBe(replacement);
    const cleared = await patch({ canonicalLocationId: null });
    expect(cleared.json().canonicalLocationId).toBeNull();
    expect(
      await db
        .select()
        .from(schema.worldContent)
        .where(eq(schema.worldContent.id, replacement)),
    ).toHaveLength(1);
    const playerWrite = await app.inject({
      method: "POST",
      url: "/api/world-maps/locations",
      headers: headers(secrets.player),
      payload: {
        actionId: id(),
        mapId,
        name: "Player",
        x: 0.5,
        y: 0.5,
        canonicalLocationId: valid,
      },
    });
    expect(playerWrite.statusCode).toBe(403);
  });

  it("keeps references for GM while omitting draft canonical IDs from a player projection", async () => {
    const canonicalId = id();
    await db
      .insert(schema.worldContent)
      .values({
        id: canonicalId,
        slug: `hidden-${canonicalId.slice(0, 8)}`,
        type: "LOCATION",
        name: "Secret place",
        lifecycle: "DRAFT",
      });
    const locationId = id();
    const publicMapId = id();
    const backgroundId = id();
    await db.insert(schema.assets).values({
      id: backgroundId,
      campaignId,
      uploadedByMembershipId: gmId,
      kind: "MAP",
      name: "Synthetic map",
      storageKey: `test/${backgroundId}`,
      mimeType: "image/png",
      sizeBytes: 1,
    });
    await db.insert(schema.worldMaps).values({
      id: publicMapId,
      campaignId,
      name: "Public map",
      lifecycle: "PUBLISHED",
      backgroundAssetId: backgroundId,
      backgroundAssetApprovedByMembershipId: gmId,
      backgroundAssetApprovedAt: new Date(),
      publishedAt: new Date(),
    });
    await db
      .insert(schema.worldMapLocations)
      .values({
        id: locationId,
        campaignId,
        mapId: publicMapId,
        canonicalLocationId: canonicalId,
        name: "Visible node",
        visibility: "PUBLIC",
        x: 0.2,
        y: 0.6,
      });
    const gmSnapshot = await buildWorldMapsSnapshot(db as never, {
      membershipId: gmId,
      campaignId,
      role: "GM",
      displayName: "GM",
    });
    expect(
      gmSnapshot.snapshot.locations.find((row) => row.id === locationId),
      JSON.stringify(gmSnapshot.snapshot),
    ).toHaveProperty("canonicalLocationId", canonicalId);
    const playerSnapshot = await buildWorldMapsSnapshot(db as never, {
      membershipId: playerId,
      campaignId,
      role: "PLAYER",
      displayName: "Player",
    });
    const playerNode = playerSnapshot.snapshot.locations.find(
      (row) => row.id === locationId,
    );
    expect(playerNode).toBeDefined();
    expect(playerNode).not.toHaveProperty("canonicalLocationId");
    expect(JSON.stringify(playerSnapshot.snapshot)).not.toContain(canonicalId);
    await db
      .update(schema.worldContent)
      .set({ lifecycle: "PUBLISHED" })
      .where(eq(schema.worldContent.id, canonicalId));
    const publishedPlayer = await buildWorldMapsSnapshot(db as never, {
      membershipId: playerId,
      campaignId,
      role: "PLAYER",
      displayName: "Player",
    });
    expect(
      publishedPlayer.snapshot.locations.find((row) => row.id === locationId)
        ?.canonicalLocationId,
    ).toBe(canonicalId);
    await db
      .update(schema.worldContent)
      .set({ lifecycle: "ARCHIVED" })
      .where(eq(schema.worldContent.id, canonicalId));
    const archivedPlayer = await buildWorldMapsSnapshot(db as never, {
      membershipId: playerId,
      campaignId,
      role: "PLAYER",
      displayName: "Player",
    });
    expect(
      archivedPlayer.snapshot.locations.find((row) => row.id === locationId),
    ).not.toHaveProperty("canonicalLocationId");
    const archivedGm = await buildWorldMapsSnapshot(db as never, {
      membershipId: gmId,
      campaignId,
      role: "GM",
      displayName: "GM",
    });
    expect(
      archivedGm.snapshot.locations.find((row) => row.id === locationId)
        ?.canonicalLocationId,
    ).toBe(canonicalId);
  });
});
