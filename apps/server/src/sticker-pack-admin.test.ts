import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import type { AuthContext } from "./auth.js";
import { registerStickerPackAdminRoutes } from "./sticker-pack-admin.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;

const ids = {
  campaign: crypto.randomUUID(),
  foreignCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  foreignGm: crypto.randomUUID(),
  draft: crypto.randomUUID(),
  active: crypto.randomUUID(),
  archived: crypto.randomUUID(),
  sticker: crypto.randomUUID(),
  media: crypto.randomUUID(),
  membershipSubject: crypto.randomUUID(),
};

const authByHeader = async (request: { headers: Record<string, unknown> }) => {
  const auth = request.headers["x-test-auth"];
  const contexts: Record<string, AuthContext> = {
    gm: {
      campaignId: ids.campaign,
      membershipId: ids.gm,
      role: "GM",
      displayName: "GM",
    },
    player: {
      campaignId: ids.campaign,
      membershipId: ids.player,
      role: "PLAYER",
      displayName: "Player",
    },
    foreign: {
      campaignId: ids.foreignCampaign,
      membershipId: ids.foreignGm,
      role: "GM",
      displayName: "Foreign GM",
    },
  };
  return typeof auth === "string" ? (contexts[auth] ?? null) : null;
};

beforeEach(async () => {
  ids.campaign = crypto.randomUUID();
  ids.foreignCampaign = crypto.randomUUID();
  ids.gm = crypto.randomUUID();
  ids.player = crypto.randomUUID();
  ids.foreignGm = crypto.randomUUID();
  ids.draft = crypto.randomUUID();
  ids.active = crypto.randomUUID();
  ids.archived = crypto.randomUUID();
  ids.sticker = crypto.randomUUID();
  ids.media = crypto.randomUUID();
  ids.membershipSubject = crypto.randomUUID();
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
    { id: ids.campaign, name: "Campaign" },
    { id: ids.foreignCampaign, name: "Foreign" },
  ]);
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM" },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Player",
    },
    {
      id: ids.membershipSubject,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Subject",
    },
    {
      id: ids.foreignGm,
      campaignId: ids.foreignCampaign,
      role: "GM",
      displayName: "Foreign GM",
    },
  ]);
  await db.insert(schema.stickerPacks).values([
    {
      id: ids.draft,
      campaignId: ids.campaign,
      name: "Rights review",
      subject: "NPC",
      subjectLabel: "Watchkeeper",
      lifecycle: "DRAFT",
      audience: "GM_ONLY",
      sendPolicy: "GM_ONLY",
    },
    {
      id: ids.active,
      campaignId: ids.campaign,
      name: "Player pack",
      subject: "PLAYER",
      subjectMembershipId: ids.membershipSubject,
      lifecycle: "ACTIVE",
      audience: "CAMPAIGN",
      sendPolicy: "ALL_MEMBERS",
    },
    {
      id: ids.archived,
      campaignId: ids.campaign,
      name: "Archived pack",
      subject: "NPC",
      subjectLabel: "Old NPC",
      lifecycle: "ARCHIVED",
      audience: "GM_ONLY",
      sendPolicy: "GM_ONLY",
    },
  ]);
  await db.insert(schema.playerLikenessConsents).values({
    campaignId: ids.campaign,
    packId: ids.active,
    membershipId: ids.membershipSubject,
    status: "GRANTED",
    grantedAt: new Date(),
  });
  await db.insert(schema.stickerMedia).values({
    id: ids.media,
    campaignId: ids.campaign,
    uploadedByMembershipId: ids.gm,
    storageKey: "must-not-leak/internal-key.webp",
    mimeType: "image/webp",
    sizeBytes: 42,
    width: 16,
    height: 16,
    sha256: "a".repeat(64),
  });
  await db.insert(schema.stickers).values({
    id: ids.sticker,
    campaignId: ids.campaign,
    packId: ids.draft,
    mediaId: ids.media,
    name: "Watchkeeper",
    altText: "A watchkeeper waves",
    provenanceType: "IMPORTED",
    sourceReference: "owner-selected source folder",
    authorCredit: "User confirmed owner",
    licenseNote: "Owner rights confirmed",
  });
  app = Fastify();
  registerStickerPackAdminRoutes(app, db as never, authByHeader as never);
});

afterEach(async () => {
  await app.close();
  await database.close();
});

describe("sticker pack admin recovery routes", () => {
  it("returns campaign-scoped summaries with lifecycle, policies, consent and counts", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/gm/sticker-packs",
      headers: { "x-test-auth": "gm" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const body = response.json();
    expect(body).toHaveLength(2);
    expect(body.some((pack: { id: string }) => pack.id === ids.archived)).toBe(
      false,
    );
    expect(
      body.find((pack: { id: string }) => pack.id === ids.draft),
    ).toMatchObject({
      lifecycle: "DRAFT",
      audience: "GM_ONLY",
      sendPolicy: "GM_ONLY",
      stickerCount: 1,
      playerConsentStatus: null,
    });
    expect(
      body.find((pack: { id: string }) => pack.id === ids.active),
    ).toMatchObject({
      lifecycle: "ACTIVE",
      playerConsentStatus: "GRANTED",
    });
    const foreign = await app.inject({
      method: "GET",
      url: "/api/gm/sticker-packs",
      headers: { "x-test-auth": "foreign" },
    });
    expect(foreign.json()).toEqual([]);
  });

  it("returns complete private draft metadata and raw-source hash without storage key", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/gm/sticker-packs/${ids.draft}`,
      headers: { "x-test-auth": "gm" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const body = response.json();
    expect(body).toMatchObject({ lifecycle: "DRAFT", audience: "GM_ONLY" });
    expect(body.stickers[0]).toMatchObject({
      id: ids.sticker,
      mediaId: ids.media,
      provenanceType: "IMPORTED",
      sourceReference: "owner-selected source folder",
      authorCredit: "User confirmed owner",
      licenseNote: "Owner rights confirmed",
      sha256: "a".repeat(64),
    });
    expect(JSON.stringify(body)).not.toContain("storageKey");
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
  });

  it("rejects missing sessions, players, and cross-campaign detail reads", async () => {
    const missing = await app.inject({
      method: "GET",
      url: "/api/gm/sticker-packs",
    });
    expect(missing.statusCode).toBe(401);
    const player = await app.inject({
      method: "GET",
      url: "/api/gm/sticker-packs",
      headers: { "x-test-auth": "player" },
    });
    expect(player.statusCode).toBe(403);
    const foreign = await app.inject({
      method: "GET",
      url: `/api/gm/sticker-packs/${ids.draft}`,
      headers: { "x-test-auth": "foreign" },
    });
    expect(foreign.statusCode).toBe(404);
  });
});
