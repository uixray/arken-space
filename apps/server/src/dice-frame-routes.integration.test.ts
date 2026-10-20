import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerRoutes } from "./routes.js";
import { buildSnapshot } from "./snapshot.js";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";

/**
 * UIX-457: рамки бросков как ассеты кампании — загрузка мастером, видимость,
 * личный выбор игрока, рамка навыка, приоритет при броске и отвязка при
 * удалении. Рамки здесь синтетические; исходники владельца сюда не попадают.
 */
let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
let mediaRoot: string;
const originalMediaRoot = env.MEDIA_ROOT;
const originalMinFreeDiskBytes = env.MIN_FREE_DISK_BYTES;
const originalMediaQuotaBytes = env.MEDIA_QUOTA_BYTES;

const id = () => crypto.randomUUID();
const ids = {
  campaign: id(),
  foreignCampaign: id(),
  gm: id(),
  player: id(),
  foreignGm: id(),
  character: id(),
  catalogEntry: id(),
  characterEntry: id(),
  plainImage: id(),
};
const secrets = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
  foreignGm: "f".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** Двухкадровый APNG 160×160: прозрачный кадр и цветная рамка. */
async function syntheticApng(color: [number, number, number]) {
  const size = 160;
  const frames = await Promise.all(
    [0, 1].map((alpha) =>
      sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: { r: color[0], g: color[1], b: color[2], alpha },
        },
      })
        .png()
        .toBuffer(),
    ),
  );
  const idat = (png: Buffer) => {
    const parts: Buffer[] = [];
    let offset = 8;
    while (offset < png.length) {
      const length = png.readUInt32BE(offset);
      if (png.toString("latin1", offset + 4, offset + 8) === "IDAT")
        parts.push(png.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
    }
    return Buffer.concat(parts);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2, 0);
  const fctl = (sequence: number) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(size, 4);
    data.writeUInt32BE(size, 8);
    data.writeUInt16BE(1, 20);
    data.writeUInt16BE(10, 22);
    return data;
  };
  const fdatSequence = Buffer.alloc(4);
  fdatSequence.writeUInt32BE(2);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("acTL", actl),
    pngChunk("fcTL", fctl(0)),
    pngChunk("IDAT", idat(frames[0]!)),
    pngChunk("fcTL", fctl(1)),
    pngChunk("fdAT", Buffer.concat([fdatSequence, idat(frames[1]!)])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function multipartFile(content: Buffer, filename = "frame.png") {
  const boundary = `arken-uix457-${id()}`;
  return {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

async function uploadFrame(secret: string, color: [number, number, number]) {
  const form = multipartFile(await syntheticApng(color));
  return app.inject({
    method: "POST",
    url: "/api/assets?kind=DICE_FRAME",
    headers: {
      ...headers(secret),
      "content-type": form["content-type"],
      "x-action-id": id(),
    },
    payload: form.body,
  });
}

const auth = (membershipId: string, role: "GM" | "PLAYER") => ({
  campaignId: ids.campaign,
  membershipId,
  role,
  displayName: role,
});

const setPlayerFrame = (secret: string, diceFrameAssetId: string | null) =>
  app.inject({
    method: "PATCH",
    url: "/api/me/dice-frame",
    headers: headers(secret),
    payload: { diceFrameAssetId },
  });

const rollEntry = () =>
  app.inject({
    method: "POST",
    url: `/api/characters/${ids.character}/catalog/${ids.characterEntry}/roll`,
    headers: headers(secrets.player),
    payload: { actionId: id(), rollActionId: "hit" },
  });

const rollDice = () =>
  app.inject({
    method: "POST",
    url: "/api/dice",
    headers: headers(secrets.player),
    payload: { actionId: id(), formula: "1d20" },
  });

const storedStyleFrame = async (messageId: string) => {
  const [message] = await db
    .select({ dice: schema.chatMessages.dice })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.id, messageId));
  return (message?.dice as { styleFrame?: unknown } | null)?.styleFrame;
};

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "arken-dice-frames-"));
  env.MEDIA_ROOT = mediaRoot;
  env.MIN_FREE_DISK_BYTES = 0;
  env.MEDIA_QUOTA_BYTES = 64 * 1024 * 1024;
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "A" },
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
      displayName: "Foreign GM",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm, secrets.gm],
    [ids.player, secrets.player],
    [ids.foreignGm, secrets.foreignGm],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });
  await db.insert(schema.assets).values({
    id: ids.plainImage,
    campaignId: ids.campaign,
    uploadedByMembershipId: ids.gm,
    kind: "IMAGE",
    name: "Plain",
    storageKey: "plain.webp",
    mimeType: "image/webp",
    sizeBytes: 5,
  });
  await db.insert(schema.characters).values({
    id: ids.character,
    campaignId: ids.campaign,
    name: "Hero",
    ownerMembershipId: ids.player,
  });
  const rollData = {
    rollActions: [
      {
        id: "hit",
        kind: "HIT",
        label: "Попадание",
        dice: "1d20",
        order: 0,
        advantage: false,
        consumeUse: false,
        modifiers: [],
      },
    ],
  };
  await db.insert(schema.catalogEntries).values({
    id: ids.catalogEntry,
    campaignId: ids.campaign,
    kind: "SKILL",
    name: "Огненный удар",
    data: rollData,
  });
  await db.insert(schema.characterCatalogEntries).values({
    id: ids.characterEntry,
    characterId: ids.character,
    sourceCatalogEntryId: ids.catalogEntry,
    kind: "SKILL",
    name: "Огненный удар",
    data: rollData,
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

describe("UIX-457 dice frame assets", () => {
  it("stores an animated derivative and a poster, counted together in the quota", async () => {
    const response = await uploadFrame(secrets.gm, [200, 40, 40]);
    expect(response.statusCode, response.body).toBe(201);
    const created = response.json<{ id: string }>();
    const [row] = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, created.id));
    expect(row).toMatchObject({
      kind: "DICE_FRAME",
      mimeType: "image/webp",
      width: 128,
      height: 128,
    });
    expect(row!.posterStorageKey).toBeTruthy();
    expect(row!.posterStorageKey).not.toBe(row!.storageKey);
    expect((await readdir(mediaRoot)).sort()).toEqual(
      [row!.storageKey, row!.posterStorageKey!].sort(),
    );

    const animated = await app.inject({
      method: "GET",
      url: `/api/assets/${created.id}/content`,
      headers: headers(secrets.player),
    });
    expect(animated.statusCode, animated.body).toBe(200);
    const poster = await app.inject({
      method: "GET",
      url: `/api/assets/${created.id}/content?variant=poster`,
      headers: headers(secrets.player),
    });
    expect(poster.statusCode, poster.body).toBe(200);
    expect(row!.sizeBytes).toBe(
      animated.rawPayload.length + poster.rawPayload.length,
    );
    expect(
      (await sharp(animated.rawPayload, { animated: true }).metadata()).pages,
    ).toBe(2);
    expect(
      (await sharp(poster.rawPayload, { animated: true }).metadata()).pages ??
        1,
    ).toBe(1);

    // Постер есть только у рамки; для обычной картинки — честный 404.
    const noPoster = await app.inject({
      method: "GET",
      url: `/api/assets/${ids.plainImage}/content?variant=poster`,
      headers: headers(secrets.gm),
    });
    expect(noPoster.statusCode).toBe(404);
  });

  it("lets only the GM upload frames and shows them to every member", async () => {
    expect((await uploadFrame(secrets.player, [1, 2, 3])).statusCode).toBe(403);
    const created = (await uploadFrame(secrets.gm, [1, 2, 3])).json<{
      id: string;
    }>();
    const playerView = await buildSnapshot(
      db as never,
      auth(ids.player, "PLAYER"),
    );
    const frame = playerView.assets.find((asset) => asset.id === created.id);
    expect(frame).toMatchObject({ kind: "DICE_FRAME" });
    expect(frame?.posterUrl).toMatch(
      new RegExp(`^/api/assets/${created.id}/content\\?variant=poster&v=`),
    );
    expect(playerView.me.diceFrameAssetId).toBeNull();
    // Замена содержимого рамки не поддерживается: её нужно загрузить заново.
    const replace = await app.inject({
      method: "PUT",
      url: `/api/assets/${created.id}/content`,
      headers: {
        ...headers(secrets.gm),
        "x-action-id": id(),
        "if-match": '"x"',
      },
    });
    expect(replace.statusCode).toBe(400);
    expect(replace.json().error).toBe("DICE_FRAME_REPLACE_UNSUPPORTED");
  });

  it("rejects a malformed animation without leaving blobs or rows", async () => {
    const valid = await syntheticApng([9, 9, 9]);
    const broken = Buffer.from(valid);
    broken[valid.length - 20] = broken[valid.length - 20]! ^ 0xff;
    const form = multipartFile(broken);
    const response = await app.inject({
      method: "POST",
      url: "/api/assets?kind=DICE_FRAME",
      headers: {
        ...headers(secrets.gm),
        "content-type": form["content-type"],
        "x-action-id": id(),
      },
      payload: form.body,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_DICE_FRAME");
    expect(await readdir(mediaRoot)).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.kind, "DICE_FRAME")),
    ).toEqual([]);
  });

  it("validates the personal choice against kind and campaign", async () => {
    const frame = (await uploadFrame(secrets.gm, [5, 5, 5])).json<{
      id: string;
    }>();
    const foreign = (await uploadFrame(secrets.foreignGm, [6, 6, 6])).json<{
      id: string;
    }>();
    expect((await setPlayerFrame(secrets.player, foreign.id)).statusCode).toBe(
      404,
    );
    expect(
      (await setPlayerFrame(secrets.player, ids.plainImage)).statusCode,
    ).toBe(404);
    expect((await setPlayerFrame(secrets.player, "nope")).statusCode).toBe(400);
    const chosen = await setPlayerFrame(secrets.player, frame.id);
    expect(chosen.statusCode, chosen.body).toBe(200);
    expect(chosen.json()).toEqual({
      id: ids.player,
      diceFrameAssetId: frame.id,
    });
    const view = await buildSnapshot(db as never, auth(ids.player, "PLAYER"));
    expect(view.me.diceFrameAssetId).toBe(frame.id);
    // Чужой выбор игроку не виден: в списке участников только он сам.
    const gmView = await buildSnapshot(db as never, auth(ids.gm, "GM"));
    expect(gmView.me.diceFrameAssetId).toBeNull();
    const cleared = await setPlayerFrame(secrets.player, null);
    expect(cleared.json().diceFrameAssetId).toBeNull();
  });

  it("lets the GM assign a skill frame and rejects foreign frames", async () => {
    const frame = (await uploadFrame(secrets.gm, [7, 7, 7])).json<{
      id: string;
    }>();
    const foreign = (await uploadFrame(secrets.foreignGm, [8, 8, 8])).json<{
      id: string;
    }>();
    const patch = (diceFrameAssetId: string | null, secret = secrets.gm) =>
      app.inject({
        method: "PATCH",
        url: `/api/catalog/${ids.catalogEntry}`,
        headers: headers(secret),
        payload: { actionId: id(), diceFrameAssetId },
      });
    expect((await patch(foreign.id)).statusCode).toBe(404);
    expect((await patch(ids.plainImage)).statusCode).toBe(404);
    expect((await patch(frame.id, secrets.player)).statusCode).toBe(403);
    const assigned = await patch(frame.id);
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(assigned.json().diceFrameAssetId).toBe(frame.id);
    const gmView = await buildSnapshot(db as never, auth(ids.gm, "GM"));
    expect(
      gmView.catalogEntries.find((entry) => entry.id === ids.catalogEntry)
        ?.diceFrameAssetId,
    ).toBe(frame.id);
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        kind: "SKILL",
        name: "С чужой рамкой",
        data: {},
        diceFrameAssetId: foreign.id,
      },
    });
    expect(created.statusCode).toBe(404);
  });

  it("stores skill → player precedence on the roll and keeps history after changes", async () => {
    const skillFrame = (await uploadFrame(secrets.gm, [10, 0, 0])).json<{
      id: string;
    }>();
    const playerFrame = (await uploadFrame(secrets.gm, [0, 10, 0])).json<{
      id: string;
    }>();

    const bare = await rollEntry();
    expect(bare.statusCode, bare.body).toBe(201);
    expect(await storedStyleFrame(bare.json().messageId)).toBeNull();

    await setPlayerFrame(secrets.player, playerFrame.id);
    const withPlayer = await rollEntry();
    expect(await storedStyleFrame(withPlayer.json().messageId)).toEqual({
      assetId: playerFrame.id,
      source: "PLAYER",
    });
    const pure = await rollDice();
    expect(pure.statusCode, pure.body).toBe(201);
    expect(await storedStyleFrame(pure.json().id)).toEqual({
      assetId: playerFrame.id,
      source: "PLAYER",
    });

    await db
      .update(schema.catalogEntries)
      .set({ diceFrameAssetId: skillFrame.id })
      .where(eq(schema.catalogEntries.id, ids.catalogEntry));
    const withSkill = await rollEntry();
    expect(await storedStyleFrame(withSkill.json().messageId)).toEqual({
      assetId: skillFrame.id,
      source: "SKILL",
    });
    // Навык не влияет на чистый бросок.
    expect(await storedStyleFrame((await rollDice()).json().id)).toEqual({
      assetId: playerFrame.id,
      source: "PLAYER",
    });
    // История неизменна: смена выбора не переписывает прошлый бросок.
    await setPlayerFrame(secrets.player, null);
    expect(await storedStyleFrame(withPlayer.json().messageId)).toEqual({
      assetId: playerFrame.id,
      source: "PLAYER",
    });
  });

  it("detaches a deleted frame from members and skills and removes both blobs", async () => {
    const frame = (await uploadFrame(secrets.gm, [3, 3, 3])).json<{
      id: string;
    }>();
    await setPlayerFrame(secrets.player, frame.id);
    await db
      .update(schema.catalogEntries)
      .set({ diceFrameAssetId: frame.id })
      .where(eq(schema.catalogEntries.id, ids.catalogEntry));
    const usage = await app.inject({
      method: "GET",
      url: `/api/assets/${frame.id}/usage`,
      headers: headers(secrets.gm),
    });
    expect(
      usage
        .json<{ usages: Array<{ kind: string; deletionPolicy: string }> }>()
        .usages.map((item) => [item.kind, item.deletionPolicy])
        .sort(),
    ).toEqual([
      ["MEMBER_DICE_FRAME", "DETACH"],
      ["SKILL_DICE_FRAME", "DETACH"],
    ]);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/assets/${frame.id}`,
      headers: headers(secrets.gm),
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().blobCleanupPending).toBe(false);
    expect(await readdir(mediaRoot)).toEqual([]);
    const [member] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, ids.player));
    expect(member?.diceFrameAssetId).toBeNull();
    const [entry] = await db
      .select()
      .from(schema.catalogEntries)
      .where(eq(schema.catalogEntries.id, ids.catalogEntry));
    expect(entry?.diceFrameAssetId).toBeNull();
    expect(entry?.revision).toBe(1);
    const roll = await rollEntry();
    expect(await storedStyleFrame(roll.json().messageId)).toBeNull();
  });
});
