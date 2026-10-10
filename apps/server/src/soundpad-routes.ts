import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@arken/contracts";
import { and, asc, eq } from "drizzle-orm";
import {
  assets, campaignSounds, campaignSoundPacks, campaignSoundpadSettings,
} from "@arken/db";
import {
  soundpadPackCreateSchema, soundpadPackUpdateSchema,
  soundpadSoundCreateSchema, soundpadSoundUpdateSchema,
} from "@arken/contracts";
import { requireAuth, type AuthContext } from "./auth.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
type SoundpadSession = (request: FastifyRequest, reply: FastifyReply) => Promise<AuthContext | null>;

async function projectPacks(db: Database, campaignId: string, role: "GM" | "PLAYER") {
  const [packs, sounds] = await Promise.all([
    db.select().from(campaignSoundPacks).where(eq(campaignSoundPacks.campaignId, campaignId)).orderBy(asc(campaignSoundPacks.sortOrder), asc(campaignSoundPacks.createdAt)),
    db.select().from(campaignSounds).where(eq(campaignSounds.campaignId, campaignId)).orderBy(asc(campaignSounds.sortOrder), asc(campaignSounds.createdAt)),
  ]);
  return packs.filter((pack) => role === "GM" || (pack.published && pack.audience === "ALL_MEMBERS"))
    .map((pack) => ({
      id: pack.id, campaignId: pack.campaignId, name: pack.name, published: pack.published,
      audience: pack.audience as "ALL_MEMBERS" | "GM_ONLY", sortOrder: pack.sortOrder,
      sounds: sounds.filter((sound) => sound.packId === pack.id && (role === "GM" || sound.audience === "ALL_MEMBERS"))
        .map((sound) => ({
          id: sound.id, packId: sound.packId, assetId: sound.assetId, label: sound.label,
          icon: sound.icon, category: sound.category, sortOrder: sound.sortOrder,
          defaultGain: sound.defaultGain, audience: sound.audience as "ALL_MEMBERS" | "GM_ONLY",
          sourceNote: sound.sourceNote,
        })),
    }));
}

export function registerSoundpadRoutes(app: FastifyInstance, db: Database, io: RealtimeServer, getSession: SoundpadSession = (request, reply) => requireAuth(request, reply, db)) {
  const invalidateCatalogue = (campaignId: string) => io.to(`campaign:${campaignId}`).emit("soundpad:catalog:changed");
  app.get("/api/soundpad", async (request, reply) => {
    const auth = await getSession(request, reply);
    if (!auth) return reply.sent ? undefined : reply.code(401).send({ error: "AUTH_REQUIRED" });
    const [settings] = await db.select().from(campaignSoundpadSettings)
      .where(eq(campaignSoundpadSettings.campaignId, auth.campaignId)).limit(1);
    return {
      packs: await projectPacks(db, auth.campaignId, auth.role),
      playerPlaybackEnabled: settings?.playerPlaybackEnabled ?? true,
    };
  });

  app.post("/api/soundpad/packs", async (request, reply) => {
    const auth = await getSession(request, reply);
    if (!auth) return reply.sent ? undefined : reply.code(401).send({ error: "AUTH_REQUIRED" });
    if (auth.role !== "GM") return reply.code(403).send({ error: "GM_REQUIRED" });
    const parsed = soundpadPackCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_COMMAND" });
    const [existing] = await db.select({ id: campaignSoundPacks.id }).from(campaignSoundPacks)
      .where(and(eq(campaignSoundPacks.campaignId, auth.campaignId), eq(campaignSoundPacks.name, parsed.data.name))).limit(1);
    if (existing) return reply.send({ packId: existing.id });
    const [pack] = await db.insert(campaignSoundPacks).values({ campaignId: auth.campaignId, name: parsed.data.name }).onConflictDoNothing().returning();
    if (pack) { invalidateCatalogue(auth.campaignId); return reply.code(201).send({ packId: pack.id }); }
    const [concurrent] = await db.select({ id: campaignSoundPacks.id }).from(campaignSoundPacks)
      .where(and(eq(campaignSoundPacks.campaignId, auth.campaignId), eq(campaignSoundPacks.name, parsed.data.name))).limit(1);
    if (!concurrent) return reply.code(500).send({ error: "PACK_CREATE_FAILED" });
    return reply.send({ packId: concurrent.id });
  });

  app.patch("/api/soundpad/packs/:packId", async (request, reply) => {
    const auth = await getSession(request, reply);
    if (!auth) return reply.sent ? undefined : reply.code(401).send({ error: "AUTH_REQUIRED" });
    if (auth.role !== "GM") return reply.code(403).send({ error: "GM_REQUIRED" });
    const params = (request.params ?? {}) as { packId?: string };
    const packId = params.packId;
    if (!packId) return reply.code(400).send({ error: "INVALID_COMMAND" });
    const parsed = soundpadPackUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_COMMAND" });
    const [pack] = await db.update(campaignSoundPacks).set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(campaignSoundPacks.id, packId), eq(campaignSoundPacks.campaignId, auth.campaignId))).returning({ id: campaignSoundPacks.id });
    if (!pack) return reply.code(404).send({ error: "PACK_NOT_FOUND" });
    invalidateCatalogue(auth.campaignId);
    return { ok: true };
  });

  app.delete("/api/soundpad/packs/:packId", async (request, reply) => {
    const auth = await getSession(request, reply);
    if (!auth) return reply.sent ? undefined : reply.code(401).send({ error: "AUTH_REQUIRED" });
    if (auth.role !== "GM") return reply.code(403).send({ error: "GM_REQUIRED" });
    const params = (request.params ?? {}) as { packId?: string };
    if (!params.packId) return reply.code(400).send({ error: "INVALID_COMMAND" });
    const [removed] = await db.delete(campaignSoundPacks).where(and(eq(campaignSoundPacks.id, params.packId), eq(campaignSoundPacks.campaignId, auth.campaignId))).returning({ id: campaignSoundPacks.id });
    if (!removed) return reply.code(404).send({ error: "PACK_NOT_FOUND" });
    invalidateCatalogue(auth.campaignId);
    return { ok: true };
  });

  app.post("/api/soundpad/packs/:packId/sounds", async (request, reply) => {
    const auth = await getSession(request, reply);
    if (!auth) return reply.sent ? undefined : reply.code(401).send({ error: "AUTH_REQUIRED" });
    if (auth.role !== "GM") return reply.code(403).send({ error: "GM_REQUIRED" });
    const params = (request.params ?? {}) as { packId?: string };
    const parsed = soundpadSoundCreateSchema.safeParse(request.body);
    if (!params.packId || !parsed.success) return reply.code(400).send({ error: "INVALID_COMMAND" });
    const outcome = await db.transaction(async (tx) => {
      const [pack] = await tx.select({ id: campaignSoundPacks.id }).from(campaignSoundPacks)
        .where(and(eq(campaignSoundPacks.id, params.packId!), eq(campaignSoundPacks.campaignId, auth.campaignId))).limit(1);
      if (!pack) return { error: "PACK_NOT_FOUND" as const };
      const [asset] = await tx.select({ id: assets.id, kind: assets.kind, audioPurpose: assets.audioPurpose, durationSeconds: assets.durationSeconds }).from(assets)
        .where(and(eq(assets.id, parsed.data.assetId), eq(assets.campaignId, auth.campaignId))).for("update").limit(1);
      if (!asset || asset.kind !== "AUDIO") return { error: "AUDIO_ASSET_REQUIRED" as const };
      if (asset.audioPurpose !== "SOUND_EFFECT" && asset.audioPurpose !== "BOTH") return { error: "SOUND_EFFECT_PURPOSE_REQUIRED" as const };
      if (!asset.durationSeconds || asset.durationSeconds <= 0 || asset.durationSeconds > 10) return { error: "SOUND_DURATION_INVALID" as const };
      const [sound] = await tx.insert(campaignSounds).values({ campaignId: auth.campaignId, packId: pack.id, ...parsed.data }).onConflictDoNothing().returning({ id: campaignSounds.id });
      return sound ? { soundId: sound.id, created: true as const } : { soundId: null, created: false as const, packId: pack.id };
    });
    if ("error" in outcome) {
      const status = outcome.error === "PACK_NOT_FOUND" ? 404 : 400;
      return reply.code(status).send({ error: outcome.error });
    }
    if (outcome.created) { invalidateCatalogue(auth.campaignId); return reply.code(201).send({ soundId: outcome.soundId }); }
    const [concurrent] = await db.select({ id: campaignSounds.id }).from(campaignSounds)
      .where(and(eq(campaignSounds.packId, outcome.packId), eq(campaignSounds.assetId, parsed.data.assetId))).limit(1);
    if (!concurrent) return reply.code(500).send({ error: "SOUND_CREATE_FAILED" });
    return reply.send({ soundId: concurrent.id });
  });

  app.patch("/api/soundpad/sounds/:soundId", async (request, reply) => {
    const auth = await getSession(request, reply);
    if (!auth) return reply.sent ? undefined : reply.code(401).send({ error: "AUTH_REQUIRED" });
    if (auth.role !== "GM") return reply.code(403).send({ error: "GM_REQUIRED" });
    const params = (request.params ?? {}) as { soundId?: string };
    const parsed = soundpadSoundUpdateSchema.safeParse(request.body);
    if (!params.soundId || !parsed.success) return reply.code(400).send({ error: "INVALID_COMMAND" });
    const outcome = await db.transaction(async (tx) => {
      if (parsed.data.assetId) {
        const [asset] = await tx.select({ id: assets.id, kind: assets.kind, audioPurpose: assets.audioPurpose, durationSeconds: assets.durationSeconds }).from(assets)
          .where(and(eq(assets.id, parsed.data.assetId), eq(assets.campaignId, auth.campaignId))).for("update").limit(1);
        if (!asset || asset.kind !== "AUDIO") return { error: "AUDIO_ASSET_REQUIRED" as const };
        if (asset.audioPurpose !== "SOUND_EFFECT" && asset.audioPurpose !== "BOTH") return { error: "SOUND_EFFECT_PURPOSE_REQUIRED" as const };
        if (!asset.durationSeconds || asset.durationSeconds <= 0 || asset.durationSeconds > 10) return { error: "SOUND_DURATION_INVALID" as const };
      }
      const [sound] = await tx.update(campaignSounds).set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(campaignSounds.id, params.soundId!), eq(campaignSounds.campaignId, auth.campaignId))).returning({ id: campaignSounds.id });
      return sound ? { id: sound.id } : { error: "SOUND_NOT_FOUND" as const };
    });
    if ("error" in outcome) {
      const status = outcome.error === "SOUND_NOT_FOUND" ? 404 : 400;
      return reply.code(status).send({ error: outcome.error });
    }
    const sound = outcome;
    if (!sound) return reply.code(404).send({ error: "SOUND_NOT_FOUND" });
    invalidateCatalogue(auth.campaignId);
    return { ok: true };
  });

  app.delete("/api/soundpad/sounds/:soundId", async (request, reply) => {
    const auth = await getSession(request, reply);
    if (!auth) return reply.sent ? undefined : reply.code(401).send({ error: "AUTH_REQUIRED" });
    if (auth.role !== "GM") return reply.code(403).send({ error: "GM_REQUIRED" });
    const params = (request.params ?? {}) as { soundId?: string };
    if (!params.soundId) return reply.code(400).send({ error: "INVALID_COMMAND" });
    const [removed] = await db.delete(campaignSounds).where(and(eq(campaignSounds.id, params.soundId), eq(campaignSounds.campaignId, auth.campaignId))).returning({ id: campaignSounds.id });
    if (!removed) return reply.code(404).send({ error: "SOUND_NOT_FOUND" });
    invalidateCatalogue(auth.campaignId);
    return { ok: true };
  });

  app.put("/api/soundpad/player-policy", async (request, reply) => {
    const auth = await getSession(request, reply);
    if (!auth) return reply.sent ? undefined : reply.code(401).send({ error: "AUTH_REQUIRED" });
    if (auth.role !== "GM") return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = request.body as { playerPlaybackEnabled?: unknown } | null;
    if (!body || typeof body.playerPlaybackEnabled !== "boolean") return reply.code(400).send({ error: "INVALID_COMMAND" });
    await db.insert(campaignSoundpadSettings).values({ campaignId: auth.campaignId, playerPlaybackEnabled: body.playerPlaybackEnabled })
      .onConflictDoUpdate({ target: campaignSoundpadSettings.campaignId, set: { playerPlaybackEnabled: body.playerPlaybackEnabled, updatedAt: new Date() } });
    io.to(`campaign:${auth.campaignId}`).emit("soundpad:policy", { playerPlaybackEnabled: body.playerPlaybackEnabled });
    return { playerPlaybackEnabled: body.playerPlaybackEnabled };
  });
}
