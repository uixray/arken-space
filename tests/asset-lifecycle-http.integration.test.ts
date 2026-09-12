import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import type { AssetUsageDto } from "@arken/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { env } from "../apps/server/src/env.js";
import { hashToken } from "../apps/server/src/security.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
let mediaRoot: string;
const originalMediaRoot = env.MEDIA_ROOT;
const originalMinFreeDiskBytes = env.MIN_FREE_DISK_BYTES;
const originalMediaQuotaBytes = env.MEDIA_QUOTA_BYTES;
const ids = {
  campaign: crypto.randomUUID(),
  foreignCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  foreignGm: crypto.randomUUID(),
  scene: crypto.randomUUID(),
  used: crypto.randomUUID(),
  unused: crypto.randomUUID(),
  foreign: crypto.randomUUID(),
};
const secrets = { gm: "g".repeat(40), player: "p".repeat(40) };
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const multipartFile = (
  content = tinyPng,
  filename = "replacement.png",
  mimeType = "image/png",
) => {
  const boundary = `arken-uix609-${crypto.randomUUID()}`;
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
};
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const fileInventory = async () =>
  Promise.all(
    (await readdir(mediaRoot)).sort().map(async (name) => ({
      name,
      sha256: hash(await readFile(join(mediaRoot, name))),
    })),
  );
const assetRow = async (id: string) => {
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.id, id));
  expect(asset).toBeDefined();
  return asset!;
};
const assetIdentity = (asset: typeof schema.assets.$inferSelect) => ({
  id: asset.id,
  campaignId: asset.campaignId,
  uploadedByMembershipId: asset.uploadedByMembershipId,
  kind: asset.kind,
  name: asset.name,
  createdAt: asset.createdAt,
});
const actionReceipts = (actionId: string) =>
  db
    .select()
    .from(schema.gameEvents)
    .where(
      and(
        eq(schema.gameEvents.campaignId, ids.campaign),
        eq(schema.gameEvents.actionId, actionId),
      ),
    );

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "arken-asset-lifecycle-"));
  env.MEDIA_ROOT = mediaRoot;
  env.MIN_FREE_DISK_BYTES = 0;
  env.MEDIA_QUOTA_BYTES = 64 * 1024 * 1024;
  for (const key of ["used.webp", "unused.webp", "foreign.webp"])
    await writeFile(join(mediaRoot, key), Buffer.from(key));
  database = new PGlite();
  for (const file of (
    await readdir(new URL("../packages/db/drizzle/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(
      (
        await readFile(
          new URL(`../packages/db/drizzle/${file}`, import.meta.url),
          "utf8",
        )
      ).replaceAll("--> statement-breakpoint", ""),
    );
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "A", activeSceneId: ids.scene },
    { id: ids.foreignCampaign, name: "B" },
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
      id: ids.foreignGm,
      campaignId: ids.foreignCampaign,
      role: "GM",
      displayName: "Other",
    },
  ]);
  await db.insert(schema.sessions).values([
    {
      membershipId: ids.gm,
      tokenHash: hashToken(secrets.gm),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      membershipId: ids.player,
      tokenHash: hashToken(secrets.player),
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]);
  await db.insert(schema.assets).values([
    {
      id: ids.used,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      kind: "MAP",
      name: "Used",
      storageKey: "used.webp",
      mimeType: "image/webp",
      sizeBytes: 9,
    },
    {
      id: ids.unused,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      kind: "IMAGE",
      name: "Unused",
      storageKey: "unused.webp",
      mimeType: "image/webp",
      sizeBytes: 11,
    },
    {
      id: ids.foreign,
      campaignId: ids.foreignCampaign,
      uploadedByMembershipId: ids.foreignGm,
      kind: "IMAGE",
      name: "Foreign",
      storageKey: "foreign.webp",
      mimeType: "image/webp",
      sizeBytes: 12,
    },
  ]);
  await db.insert(schema.scenes).values({
    id: ids.scene,
    campaignId: ids.campaign,
    name: "Secret scene",
    mapAssetId: ids.used,
    grid: {
      enabled: true,
      size: 64,
      offsetX: 0,
      offsetY: 0,
      color: "#fff",
      opacity: 0.2,
    },
  });
  app = Fastify();
  await app.register(cookie);
  await app.register(multipart);
  registerRoutes(
    app,
    db as never,
    {
      in: () => ({ fetchSockets: async () => [] }),
      to: () => ({ emit() {} }),
    } as never,
  );
  await app.ready();
});

afterEach(async () => {
  await app?.close();
  await database?.close();
  await rm(mediaRoot, { recursive: true, force: true });
  env.MEDIA_ROOT = originalMediaRoot;
  env.MIN_FREE_DISK_BYTES = originalMinFreeDiskBytes;
  env.MEDIA_QUOTA_BYTES = originalMediaQuotaBytes;
});

describe("UIX-293 asset lifecycle HTTP", () => {
  it("localizes resolved usage details without translating names or changing access and deletion policy", async () => {
    const tokenAssetId = crypto.randomUUID();
    const portraitAssetId = crypto.randomUUID();
    const audioAssetId = crypto.randomUUID();
    await db.insert(schema.assets).values(
      [
        { id: tokenAssetId, kind: "TOKEN", name: "Guardian Token" },
        { id: portraitAssetId, kind: "PORTRAIT", name: "Elminster Portrait" },
        { id: audioAssetId, kind: "AUDIO", name: "Baldur's Gate Theme" },
      ].map((asset) => ({
        ...asset,
        kind: asset.kind as "TOKEN" | "PORTRAIT" | "AUDIO",
        campaignId: ids.campaign,
        uploadedByMembershipId: ids.gm,
        storageKey: `${asset.id}.media`,
        mimeType: asset.kind === "AUDIO" ? "audio/mpeg" : "image/webp",
        sizeBytes: 10,
      })),
    );
    const [character] = await db
      .insert(schema.characters)
      .values({
        campaignId: ids.campaign,
        name: "Elminster Aumar",
        ownerMembershipId: ids.player,
        portraitAssetId,
      })
      .returning();
    const [namedToken, inheritedToken] = await db
      .insert(schema.tokenDefinitions)
      .values([
        {
          campaignId: ids.campaign,
          defaultAssetId: tokenAssetId,
          name: "Storm Guard",
        },
        {
          campaignId: ids.campaign,
          defaultAssetId: tokenAssetId,
          characterId: character!.id,
          name: null,
        },
      ])
      .returning();
    const [captionedMedia, inheritedMedia] = await db
      .insert(schema.characterMedia)
      .values(
        ["North Gate", null].map((caption, ordering) => ({
          campaignId: ids.campaign,
          characterId: character!.id,
          assetId: ids.unused,
          category: "CHARACTER_ART" as const,
          uploadedByMembershipId: ids.gm,
          caption,
          ordering,
        })),
      )
      .returning();
    const [map] = await db
      .insert(schema.worldMaps)
      .values({
        campaignId: ids.campaign,
        name: "Neverwinter",
        backgroundAssetId: ids.used,
        lifecycle: "PUBLISHED",
        visibility: "CAMPAIGN",
        backgroundAssetApprovedByMembershipId: ids.gm,
        backgroundAssetApprovedAt: new Date(),
        publishedAt: new Date(),
      })
      .returning();
    const [audio] = await db
      .insert(schema.campaignAudioTracks)
      .values({ campaignId: ids.campaign, assetId: audioAssetId, slotOrder: 2 })
      .returning();
    const [content, otherContent] = await db
      .insert(schema.worldContent)
      .values([
        {
          slug: "waterdeep",
          type: "LOCATION",
          name: "Waterdeep",
          coverAssetId: ids.unused,
        },
        {
          slug: "neverwinter-chronicle",
          type: "ARTICLE",
          name: "Neverwinter Chronicle",
        },
      ])
      .returning();
    const [captionedContentMedia, inheritedContentMedia] = await db
      .insert(schema.worldContentMedia)
      .values([
        {
          worldContentId: content!.id,
          assetId: ids.unused,
          caption: "The Yawning Portal",
        },
        { worldContentId: otherContent!.id, assetId: ids.unused },
      ])
      .returning();
    const [provenance] = await db
      .insert(schema.gameEvents)
      .values({
        campaignId: ids.campaign,
        actionId: crypto.randomUUID(),
        membershipId: ids.gm,
        type: "asset.created",
        entityType: "asset",
        entityId: tokenAssetId,
        payload: { sourceAssetId: ids.unused },
      })
      .returning();

    const usage = (
      kind: AssetUsageDto["kind"],
      entityId: string,
      label: string,
      location: string,
      visibility: AssetUsageDto["visibility"] = "GM_ONLY",
      deletionPolicy: AssetUsageDto["deletionPolicy"] = "BLOCK",
    ): AssetUsageDto => ({
      kind,
      entityId,
      label,
      location,
      visibility,
      deletionPolicy,
    });
    const cases = [
      {
        assetId: ids.used,
        kind: "MAP",
        name: "Used",
        usages: [
          usage("SCENE_BACKGROUND", ids.scene, "Secret scene", "Сцена"),
          usage(
            "WORLD_MAP_BACKGROUND",
            map!.id,
            "Neverwinter",
            "Карта мира",
            "PUBLIC",
          ),
        ],
      },
      {
        assetId: tokenAssetId,
        kind: "TOKEN",
        name: "Guardian Token",
        usages: [
          usage(
            "TOKEN_DEFINITION",
            namedToken!.id,
            "Storm Guard",
            "Каталог токенов",
          ),
          usage(
            "TOKEN_DEFINITION",
            inheritedToken!.id,
            "Elminster Aumar",
            "Каталог токенов",
          ),
        ],
      },
      {
        assetId: portraitAssetId,
        kind: "PORTRAIT",
        name: "Elminster Portrait",
        usages: [
          usage(
            "CHARACTER_PORTRAIT",
            character!.id,
            "Elminster Aumar",
            "Персонаж",
            "PARTICIPANT",
          ),
        ],
      },
      {
        assetId: audioAssetId,
        kind: "AUDIO",
        name: "Baldur's Gate Theme",
        usages: [
          usage("AUDIO_TRACK", audio!.id, "Аудиодорожка 3", "Музыка", "PUBLIC"),
        ],
      },
      {
        assetId: ids.unused,
        kind: "IMAGE",
        name: "Unused",
        usages: [
          usage(
            "CHARACTER_MEDIA",
            captionedMedia!.id,
            "North Gate",
            "Галерея персонажа",
          ),
          usage(
            "CHARACTER_MEDIA",
            inheritedMedia!.id,
            "Elminster Aumar",
            "Галерея персонажа",
          ),
          usage(
            "WORLD_CONTENT_COVER",
            content!.id,
            "Waterdeep",
            "Обложка материала мира",
          ),
          usage(
            "WORLD_CONTENT_MEDIA",
            captionedContentMedia!.id,
            "The Yawning Portal",
            "Файлы материала мира",
          ),
          usage(
            "WORLD_CONTENT_MEDIA",
            inheritedContentMedia!.id,
            "Neverwinter Chronicle",
            "Файлы материала мира",
          ),
          usage(
            "GENERATED_TOKEN_SOURCE",
            String(provenance!.sequence),
            "Источник созданного токена",
            "История изменений",
            "GM_ONLY",
            "RETAIN_HISTORY",
          ),
        ],
      },
    ];
    for (const expected of cases) {
      const resolved = await app.inject({
        method: "GET",
        url: `/api/assets/${expected.assetId}/usage`,
        headers: headers(secrets.gm),
      });
      expect(resolved.statusCode, resolved.body).toBe(200);
      expect(resolved.json()).toMatchObject({
        asset: {
          id: expected.assetId,
          kind: expected.kind,
          name: expected.name,
        },
        inUse: true,
        canDelete: false,
        deletionBlockedReason: "ASSET_IN_USE",
        hiddenUsageCount: 0,
      });
      expect(resolved.json().usages).toHaveLength(expected.usages.length);
      expect(resolved.json().usages).toEqual(
        expect.arrayContaining(expected.usages),
      );
      const blocked = await app.inject({
        method: "DELETE",
        url: `/api/assets/${expected.assetId}`,
        headers: headers(secrets.gm),
      });
      expect(blocked.statusCode, blocked.body).toBe(409);
      expect(blocked.json()).toEqual({
        error: "ASSET_IN_USE",
        usageCount: expected.usages.length,
        usages: expect.arrayContaining(expected.usages),
      });
    }
    // Even visible public/participant assets must not disclose usage names to players.
    for (const assetId of [ids.used, portraitAssetId, audioAssetId]) {
      const visible = cases.find((entry) => entry.assetId === assetId)!;
      const playerUsage = await app.inject({
        method: "GET",
        url: `/api/assets/${assetId}/usage`,
        headers: headers(secrets.player),
      });
      expect(playerUsage.statusCode, playerUsage.body).toBe(200);
      expect(playerUsage.json()).toMatchObject({
        usages: [],
        hiddenUsageCount: visible.usages.length,
        inUse: true,
        canDelete: false,
        deletionBlockedReason: "GM_REQUIRED",
      });
      const denied = await app.inject({
        method: "DELETE",
        url: `/api/assets/${assetId}`,
        headers: headers(secrets.player),
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({ error: "GM_REQUIRED" });
    }
  });

  it("keeps translated provenance as non-blocking history after source deletion", async () => {
    const [event] = await db
      .insert(schema.gameEvents)
      .values({
        campaignId: ids.campaign,
        actionId: crypto.randomUUID(),
        membershipId: ids.gm,
        type: "asset.created",
        entityType: "asset",
        entityId: crypto.randomUUID(),
        payload: { sourceAssetId: ids.unused },
      })
      .returning();
    const usage = await app.inject({
      method: "GET",
      url: `/api/assets/${ids.unused}/usage`,
      headers: headers(secrets.gm),
    });
    expect(usage.statusCode, usage.body).toBe(200);
    expect(usage.json()).toMatchObject({
      inUse: true,
      canDelete: true,
      deletionBlockedReason: null,
      usages: [
        {
          kind: "GENERATED_TOKEN_SOURCE",
          entityId: String(event!.sequence),
          label: "Источник созданного токена",
          location: "История изменений",
          visibility: "GM_ONLY",
          deletionPolicy: "RETAIN_HISTORY",
        },
      ],
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/assets/${ids.unused}`,
      headers: headers(secrets.gm),
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toMatchObject({
      assetId: ids.unused,
      deleted: true,
    });
    expect(await db.select().from(schema.gameEvents)).toEqual(
      expect.arrayContaining([event]),
    );
  });

  it("returns GM usage, hides foreign assets, and rejects player deletion", async () => {
    const usage = await app.inject({
      method: "GET",
      url: `/api/assets/${ids.used}/usage`,
      headers: headers(secrets.gm),
    });
    expect(usage.statusCode, usage.body).toBe(200);
    expect(usage.json()).toMatchObject({
      inUse: true,
      canDelete: false,
      usages: [{ kind: "SCENE_BACKGROUND", label: "Secret scene" }],
    });
    const foreign = await app.inject({
      method: "GET",
      url: `/api/assets/${ids.foreign}/usage`,
      headers: headers(secrets.gm),
    });
    expect(foreign.statusCode).toBe(404);
    const denied = await app.inject({
      method: "DELETE",
      url: `/api/assets/${ids.unused}`,
      headers: headers(secrets.player),
    });
    expect(denied.statusCode).toBe(403);
  });

  it("returns 409 for used content and deletes unused metadata plus blob", async () => {
    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/assets/${ids.used}`,
      headers: headers(secrets.gm),
    });
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json()).toMatchObject({
      error: "ASSET_IN_USE",
      usageCount: 1,
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/assets/${ids.unused}`,
      headers: headers(secrets.gm),
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toEqual({
      assetId: ids.unused,
      deleted: true,
      blobCleanupPending: false,
    });
    const repeated = await app.inject({
      method: "DELETE",
      url: `/api/assets/${ids.unused}`,
      headers: headers(secrets.gm),
    });
    expect(repeated.statusCode).toBe(404);
    const content = await app.inject({
      method: "GET",
      url: `/api/assets/${ids.unused}/content`,
      headers: headers(secrets.gm),
    });
    expect(content.statusCode).toBe(404);
    await expect(
      readFile(join(mediaRoot, "unused.webp")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces referenced MAP, TOKEN, PORTRAIT, IMAGE, and AUDIO without changing their relation rows or content URLs", async () => {
    // Existing self-authored Vorbis fixture, also used by media-smoke.spec.ts.
    const audio = await readFile(
      new URL("./multiplayer/uix642-synthetic-tone.ogg", import.meta.url),
    );
    expect(hash(audio)).toBe(
      "21777ec04536e1d079ec8c5c14253fff1a12944a1f1ac1191490029d570e2a73",
    );
    const assetIds = {
      MAP: crypto.randomUUID(),
      TOKEN: crypto.randomUUID(),
      PORTRAIT: crypto.randomUUID(),
      IMAGE: crypto.randomUUID(),
      AUDIO: crypto.randomUUID(),
    };
    const kinds = ["MAP", "TOKEN", "PORTRAIT", "IMAGE", "AUDIO"] as const;
    for (const kind of kinds) {
      const isAudio = kind === "AUDIO";
      const content = isAudio ? audio : tinyPng;
      const storageKey = `referenced-${kind}.${isAudio ? "ogg" : "png"}`;
      await writeFile(join(mediaRoot, storageKey), content);
      await db.insert(schema.assets).values({
        id: assetIds[kind],
        campaignId: ids.campaign,
        uploadedByMembershipId: ids.gm,
        kind,
        name: `Referenced ${kind}`,
        storageKey,
        mimeType: isAudio ? "audio/ogg" : "image/png",
        sizeBytes: content.length,
        width: isAudio ? null : 1,
        height: isAudio ? null : 1,
        durationSeconds: isAudio ? 0.7 : null,
      });
    }
    const [scene] = await db
      .insert(schema.scenes)
      .values({
        campaignId: ids.campaign,
        name: "Referenced map scene",
        mapAssetId: assetIds.MAP,
        grid: {
          enabled: true,
          size: 64,
          offsetX: 0,
          offsetY: 0,
          color: "#fff",
          opacity: 0.2,
        },
      })
      .returning();
    await db.insert(schema.worldMaps).values({
      campaignId: ids.campaign,
      name: "Referenced world map",
      backgroundAssetId: assetIds.MAP,
    });
    const [character] = await db
      .insert(schema.characters)
      .values({
        campaignId: ids.campaign,
        name: "Referenced portrait character",
        ownerMembershipId: ids.player,
        portraitAssetId: assetIds.PORTRAIT,
      })
      .returning();
    const [definition] = await db
      .insert(schema.tokenDefinitions)
      .values({
        campaignId: ids.campaign,
        characterId: character!.id,
        name: "Referenced token",
        defaultAssetId: assetIds.TOKEN,
      })
      .returning();
    await db.insert(schema.tokens).values({
      definitionId: definition!.id,
      sceneId: scene!.id,
      characterId: character!.id,
      assetId: assetIds.TOKEN,
      name: "Placed referenced token",
      x: 64,
      y: 128,
    });
    await db.insert(schema.characterMedia).values({
      campaignId: ids.campaign,
      characterId: character!.id,
      assetId: assetIds.IMAGE,
      category: "CHARACTER_ART",
      uploadedByMembershipId: ids.gm,
      caption: "Referenced gallery image",
    });
    const [content] = await db
      .insert(schema.worldContent)
      .values({
        slug: "referenced-location",
        type: "LOCATION",
        name: "Referenced location",
        coverAssetId: assetIds.IMAGE,
      })
      .returning();
    await db.insert(schema.worldContentMedia).values({
      worldContentId: content!.id,
      assetId: assetIds.IMAGE,
      caption: "Referenced location image",
    });
    await db.insert(schema.campaignAudioTracks).values({
      campaignId: ids.campaign,
      assetId: assetIds.AUDIO,
      slotOrder: 2,
      mixVolume: 0.25,
      loop: true,
    });
    // Read actual relational rows, including their IDs, revisions and timestamps.
    const referenceRows = async () => ({
      scenes: await db.select().from(schema.scenes).orderBy(schema.scenes.id),
      worldMaps: await db
        .select()
        .from(schema.worldMaps)
        .orderBy(schema.worldMaps.id),
      characters: await db
        .select()
        .from(schema.characters)
        .orderBy(schema.characters.id),
      definitions: await db
        .select()
        .from(schema.tokenDefinitions)
        .orderBy(schema.tokenDefinitions.id),
      tokens: await db.select().from(schema.tokens).orderBy(schema.tokens.id),
      characterMedia: await db
        .select()
        .from(schema.characterMedia)
        .orderBy(schema.characterMedia.id),
      worldContent: await db
        .select()
        .from(schema.worldContent)
        .orderBy(schema.worldContent.id),
      worldContentMedia: await db
        .select()
        .from(schema.worldContentMedia)
        .orderBy(schema.worldContentMedia.id),
      audioTracks: await db
        .select()
        .from(schema.campaignAudioTracks)
        .orderBy(schema.campaignAudioTracks.id),
    });
    const relationsBefore = await referenceRows();
    for (const kind of kinds) {
      const id = assetIds[kind];
      const beforeRow = await assetRow(id);
      const contentUrl = `/api/assets/${id}/content`;
      const before = await app.inject({
        method: "GET",
        url: contentUrl,
        headers: headers(secrets.gm),
      });
      expect(before.statusCode, before.body).toBe(200);
      const form =
        kind === "AUDIO"
          ? multipartFile(audio, "replacement.ogg", "audio/ogg")
          : multipartFile();
      const actionId = crypto.randomUUID();
      const replaced = await app.inject({
        method: "PUT",
        url: contentUrl,
        headers: {
          ...headers(secrets.gm),
          "x-action-id": actionId,
          "if-match": before.headers.etag!,
          "content-type": form.contentType,
        },
        payload: form.body,
      });
      expect(replaced.statusCode, replaced.body).toBe(200);
      expect(replaced.json()).toMatchObject({
        asset: { id, kind, name: beforeRow.name, url: contentUrl },
        oldBlobCleanupPending: false,
        replayed: false,
      });
      const afterRow = await assetRow(id);
      expect(assetIdentity(afterRow)).toEqual(assetIdentity(beforeRow));
      expect(afterRow.storageKey).not.toBe(beforeRow.storageKey);
      expect(replaced.json().version).not.toBe(before.headers.etag);
      const refreshed = await app.inject({
        method: "GET",
        url: contentUrl,
        headers: headers(secrets.gm),
      });
      expect(refreshed.statusCode, refreshed.body).toBe(200);
      expect(refreshed.headers.etag).toBe(replaced.json().version);
      expect(refreshed.rawPayload).toEqual(
        await readFile(join(mediaRoot, afterRow.storageKey)),
      );
      expect(afterRow.sizeBytes).toBe(refreshed.rawPayload.length);
      if (kind === "AUDIO") {
        // Re-upload the one valid fixture unchanged: real parsing/storage, not
        // proof of a different song or audible playback in a browser.
        expect(refreshed.rawPayload).toEqual(audio);
        expect(afterRow.mimeType).toBe("audio/ogg");
        expect(afterRow.width).toBeNull();
        expect(afterRow.height).toBeNull();
        expect(afterRow.durationSeconds).toBeGreaterThan(0);
        expect(afterRow.durationSeconds).toBeCloseTo(0.7, 1);
      } else {
        expect(refreshed.rawPayload).not.toEqual(before.rawPayload);
        expect(afterRow).toMatchObject({
          mimeType: "image/webp",
          width: 1,
          height: 1,
          durationSeconds: null,
        });
      }
      await expect(
        readFile(join(mediaRoot, beforeRow.storageKey)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await actionReceipts(actionId)).toHaveLength(1);
      expect(await referenceRows()).toEqual(relationsBefore);
    }
  });

  it("rolls back the asset and removes the new blob after a real audit insert failure, then accepts the same actionId", async () => {
    const beforeRow = await assetRow(ids.unused);
    const contentUrl = `/api/assets/${ids.unused}/content`;
    const before = await app.inject({
      method: "GET",
      url: contentUrl,
      headers: headers(secrets.gm),
    });
    expect(before.statusCode, before.body).toBe(200);
    const beforeBytes = await readFile(join(mediaRoot, beforeRow.storageKey));
    const inventoryBefore = await fileInventory();
    const actionId = crypto.randomUUID();
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const sequence = `uix609_reached_${suffix}`;
    const rejectAudit = `uix609_reject_${suffix}`;
    const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
    try {
      await database.exec(`
        CREATE SEQUENCE ${sequence};
        CREATE FUNCTION ${rejectAudit}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.type = 'asset.replaced' AND NEW.action_id = TG_ARGV[0]::uuid THEN
            IF NOT EXISTS (
              SELECT 1 FROM assets
              WHERE id = NEW.entity_id AND storage_key <> TG_ARGV[1]
            ) THEN
              RAISE EXCEPTION 'UIX609_WRONG_FAILURE_SEAM';
            END IF;
            PERFORM nextval('${sequence}');
            RAISE EXCEPTION 'UIX609_INJECTED_AUDIT_FAILURE';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER ${rejectAudit} BEFORE INSERT ON game_events
          FOR EACH ROW EXECUTE FUNCTION ${rejectAudit}(
            ${sqlLiteral(actionId)}, ${sqlLiteral(beforeRow.storageKey)}
          );
      `);
      const form = multipartFile();
      const failed = await app.inject({
        method: "PUT",
        url: contentUrl,
        headers: {
          ...headers(secrets.gm),
          "x-action-id": actionId,
          "if-match": before.headers.etag!,
          "content-type": form.contentType,
        },
        payload: form.body,
      });
      expect(failed.statusCode).toBe(500);
      // Sequence state survives rollback and advances only after the real asset
      // UPDATE. This excludes a failure before upload or at an unrelated seam.
      const reached = await database.query<{ is_called: boolean }>(
        `SELECT is_called FROM ${sequence}`,
      );
      expect(reached.rows).toEqual([{ is_called: true }]);
      expect(await assetRow(ids.unused)).toEqual(beforeRow);
      expect(await readFile(join(mediaRoot, beforeRow.storageKey))).toEqual(
        beforeBytes,
      );
      expect(await fileInventory()).toEqual(inventoryBefore);
      expect(await actionReceipts(actionId)).toEqual([]);
      const restored = await app.inject({
        method: "GET",
        url: contentUrl,
        headers: headers(secrets.gm),
      });
      expect(restored.statusCode, restored.body).toBe(200);
      expect(restored.headers.etag).toBe(before.headers.etag);
      expect(restored.rawPayload).toEqual(before.rawPayload);
      expect(restored.rawPayload).toEqual(beforeBytes);
    } finally {
      await database.exec(`
        DROP TRIGGER IF EXISTS ${rejectAudit} ON game_events;
        DROP FUNCTION IF EXISTS ${rejectAudit}();
        DROP SEQUENCE IF EXISTS ${sequence};
      `);
    }

    const retryForm = multipartFile();
    const retry = await app.inject({
      method: "PUT",
      url: contentUrl,
      headers: {
        ...headers(secrets.gm),
        "x-action-id": actionId,
        "if-match": before.headers.etag!,
        "content-type": retryForm.contentType,
      },
      payload: retryForm.body,
    });
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toMatchObject({
      asset: { id: ids.unused, url: contentUrl },
      replayed: false,
      oldBlobCleanupPending: false,
    });
    expect(retry.json().version).not.toBe(before.headers.etag);
    expect(await actionReceipts(actionId)).toHaveLength(1);
    await expect(
      readFile(join(mediaRoot, beforeRow.storageKey)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("atomically replaces content, revalidates cache, and protects replay/version intent", async () => {
    const beforeRow = await assetRow(ids.unused);
    const contentUrl = `/api/assets/${ids.unused}/content`;
    const before = await app.inject({
      method: "GET",
      url: contentUrl,
      headers: headers(secrets.gm),
    });
    expect(before.statusCode, before.body).toBe(200);
    const beforeVersion = before.headers.etag;
    expect(beforeVersion).toMatch(/^"[a-f0-9]{64}"$/);

    const deniedForm = multipartFile();
    const denied = await app.inject({
      method: "PUT",
      url: `/api/assets/${ids.unused}/content`,
      headers: {
        ...headers(secrets.player),
        "x-action-id": crypto.randomUUID(),
        "if-match": beforeVersion!,
        "content-type": deniedForm.contentType,
      },
      payload: deniedForm.body,
    });
    expect(denied.statusCode).toBe(403);

    const actionId = crypto.randomUUID();
    const form = multipartFile();
    const replaced = await app.inject({
      method: "PUT",
      url: `/api/assets/${ids.unused}/content`,
      headers: {
        ...headers(secrets.gm),
        "x-action-id": actionId,
        "if-match": beforeVersion!,
        "content-type": form.contentType,
      },
      payload: form.body,
    });
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect(replaced.json()).toMatchObject({
      asset: {
        id: beforeRow.id,
        kind: beforeRow.kind,
        name: beforeRow.name,
        createdAt: beforeRow.createdAt.toISOString(),
        url: contentUrl,
        mimeType: "image/webp",
        width: 1,
        height: 1,
        durationSeconds: null,
      },
      oldBlobCleanupPending: false,
      replayed: false,
    });
    const afterVersion = replaced.json().version as string;
    expect(afterVersion).not.toBe(beforeVersion);
    const afterRow = await assetRow(ids.unused);
    expect(assetIdentity(afterRow)).toEqual(assetIdentity(beforeRow));
    expect(afterRow.storageKey).not.toBe(beforeRow.storageKey);
    const storedBytes = await readFile(join(mediaRoot, afterRow.storageKey));
    expect(afterRow.sizeBytes).toBe(storedBytes.length);
    const receipts = await actionReceipts(actionId);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      campaignId: ids.campaign,
      actionId,
      membershipId: ids.gm,
      type: "asset.replaced",
      entityType: "asset",
      entityId: ids.unused,
    });
    expect(receipts[0]!.payload).toEqual({
      assetId: ids.unused,
      beforeVersion,
      afterVersion,
      contentSha256: hash(tinyPng),
      mimeType: "image/webp",
      sizeBytes: storedBytes.length,
      width: 1,
      height: 1,
      durationSeconds: null,
    });
    // The audit hashes the upload, not the normalized WebP written to disk.
    expect(hash(storedBytes)).not.toBe(hash(tinyPng));
    for (const privateValue of [
      beforeRow.storageKey,
      afterRow.storageKey,
      mediaRoot,
    ]) {
      const serializedValue = JSON.stringify(privateValue).slice(1, -1);
      expect(JSON.stringify(receipts)).not.toContain(serializedValue);
      expect(replaced.body).not.toContain(serializedValue);
    }
    await expect(
      readFile(join(mediaRoot, "unused.webp")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const refreshed = await app.inject({
      method: "GET",
      url: contentUrl,
      headers: headers(secrets.gm),
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.headers.etag).toBe(afterVersion);
    expect(refreshed.headers["cache-control"]).toBe("private, no-cache");
    expect(refreshed.rawPayload.equals(before.rawPayload)).toBe(false);
    expect(refreshed.rawPayload).toEqual(storedBytes);
    const notModified = await app.inject({
      method: "GET",
      url: `/api/assets/${ids.unused}/content`,
      headers: { ...headers(secrets.gm), "if-none-match": afterVersion },
    });
    expect(notModified.statusCode).toBe(304);

    const inventoryAfterReplacement = await fileInventory();
    const replayForm = multipartFile();
    const replay = await app.inject({
      method: "PUT",
      url: `/api/assets/${ids.unused}/content`,
      headers: {
        ...headers(secrets.gm),
        "x-action-id": actionId,
        "if-match": beforeVersion!,
        "content-type": replayForm.contentType,
      },
      payload: replayForm.body,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({
      replayed: true,
      version: afterVersion,
      asset: replaced.json().asset,
    });
    expect(await actionReceipts(actionId)).toEqual(receipts);
    expect(await assetRow(ids.unused)).toEqual(afterRow);
    expect(await fileInventory()).toEqual(inventoryAfterReplacement);

    const reusedForm = multipartFile(
      Buffer.concat([tinyPng, Buffer.from("x")]),
    );
    const reused = await app.inject({
      method: "PUT",
      url: `/api/assets/${ids.unused}/content`,
      headers: {
        ...headers(secrets.gm),
        "x-action-id": actionId,
        "if-match": afterVersion,
        "content-type": reusedForm.contentType,
      },
      payload: reusedForm.body,
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toEqual({ error: "ACTION_ID_REUSED" });

    const staleForm = multipartFile();
    const stale = await app.inject({
      method: "PUT",
      url: `/api/assets/${ids.unused}/content`,
      headers: {
        ...headers(secrets.gm),
        "x-action-id": crypto.randomUUID(),
        "if-match": beforeVersion!,
        "content-type": staleForm.contentType,
      },
      payload: staleForm.body,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: "ASSET_VERSION_CONFLICT",
      currentVersion: afterVersion,
    });

    const foreignForm = multipartFile();
    const foreign = await app.inject({
      method: "PUT",
      url: `/api/assets/${ids.foreign}/content`,
      headers: {
        ...headers(secrets.gm),
        "x-action-id": crypto.randomUUID(),
        "if-match": beforeVersion!,
        "content-type": foreignForm.contentType,
      },
      payload: foreignForm.body,
    });
    expect(foreign.statusCode).toBe(404);
    expect(await actionReceipts(actionId)).toEqual(receipts);
    expect(await assetRow(ids.unused)).toEqual(afterRow);
    expect(await fileInventory()).toEqual(inventoryAfterReplacement);
  });
});
