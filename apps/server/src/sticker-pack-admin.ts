import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import {
  playerLikenessConsents,
  stickerMedia,
  stickerPacks,
  stickers,
} from "@arken/db";
import type { AuthContext } from "./auth.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
export type StickerPackAdminSession = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AuthContext | null>;

const sendError = (reply: FastifyReply, status: number, error: string) =>
  reply.code(status).send({ error });

function packDto(
  pack: typeof stickerPacks.$inferSelect,
  playerConsentStatus: "GRANTED" | "REVOKED" | null,
  stickerCount: number,
) {
  return {
    id: pack.id,
    name: pack.name,
    subject: pack.subject,
    subjectCharacterId: pack.subjectCharacterId,
    subjectMembershipId: pack.subjectMembershipId,
    subjectLabel: pack.subjectLabel,
    audience: pack.audience,
    sendPolicy: pack.sendPolicy,
    lifecycle: pack.lifecycle,
    revision: pack.revision,
    createdAt: pack.createdAt.toISOString(),
    updatedAt: pack.updatedAt.toISOString(),
    playerConsentStatus,
    stickerCount,
  };
}

async function packConsentStatus(
  db: Database,
  campaignId: string,
  packId: string,
  subject: string,
) {
  if (subject !== "PLAYER") return null;
  const [consent] = await db
    .select({ status: playerLikenessConsents.status })
    .from(playerLikenessConsents)
    .where(
      and(
        eq(playerLikenessConsents.campaignId, campaignId),
        eq(playerLikenessConsents.packId, packId),
      ),
    )
    .limit(1);
  return consent?.status ?? null;
}

export function registerStickerPackAdminRoutes(
  app: FastifyInstance,
  db: Database,
  getSession: StickerPackAdminSession,
) {
  app.get("/api/gm/sticker-packs", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const auth = await getSession(request, reply);
    if (!auth)
      return reply.sent ? undefined : sendError(reply, 401, "AUTH_REQUIRED");
    if (auth.role !== "GM") return sendError(reply, 403, "GM_REQUIRED");

    const packs = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          ne(stickerPacks.lifecycle, "ARCHIVED"),
        ),
      )
      .orderBy(desc(stickerPacks.updatedAt));
    const packIds = packs.map((pack) => pack.id);
    const [counts, consents] = packIds.length
      ? await Promise.all([
          db
            .select({ packId: stickers.packId, total: count(stickers.id) })
            .from(stickers)
            .where(
              and(
                eq(stickers.campaignId, auth.campaignId),
                inArray(stickers.packId, packIds),
              ),
            )
            .groupBy(stickers.packId),
          db
            .select({
              packId: playerLikenessConsents.packId,
              status: playerLikenessConsents.status,
            })
            .from(playerLikenessConsents)
            .where(
              and(
                eq(playerLikenessConsents.campaignId, auth.campaignId),
                inArray(playerLikenessConsents.packId, packIds),
              ),
            ),
        ])
      : [[], []];
    const countByPack = new Map(
      counts.map((row) => [row.packId, Number(row.total)]),
    );
    const consentByPack = new Map(
      consents.map((row) => [row.packId, row.status]),
    );
    return packs.map((pack) =>
      packDto(
        pack,
        pack.subject === "PLAYER" ? (consentByPack.get(pack.id) ?? null) : null,
        countByPack.get(pack.id) ?? 0,
      ),
    );
  });

  app.get("/api/gm/sticker-packs/:id", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const auth = await getSession(request, reply);
    if (!auth)
      return reply.sent ? undefined : sendError(reply, 401, "AUTH_REQUIRED");
    if (auth.role !== "GM") return sendError(reply, 403, "GM_REQUIRED");
    const { id } = request.params as { id: string };
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      return sendError(reply, 400, "INVALID_STICKER_PACK_ID");
    const [pack] = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
        ),
      )
      .limit(1);
    if (!pack) return sendError(reply, 404, "STICKER_PACK_NOT_FOUND");

    const [items, playerConsentStatus] = await Promise.all([
      db
        .select({ sticker: stickers, media: stickerMedia })
        .from(stickers)
        .innerJoin(
          stickerMedia,
          and(
            eq(stickerMedia.id, stickers.mediaId),
            eq(stickerMedia.campaignId, stickers.campaignId),
          ),
        )
        .where(
          and(
            eq(stickers.campaignId, auth.campaignId),
            eq(stickers.packId, id),
          ),
        )
        .orderBy(stickers.createdAt, stickers.id),
      packConsentStatus(db, auth.campaignId, pack.id, pack.subject),
    ]);
    return {
      ...packDto(pack, playerConsentStatus, items.length),
      stickers: items.map(({ sticker, media }) => ({
        id: sticker.id,
        packId: sticker.packId,
        mediaId: sticker.mediaId,
        name: sticker.name,
        altText: sticker.altText,
        provenanceType: sticker.provenanceType,
        sourceReference: sticker.sourceReference,
        authorCredit: sticker.authorCredit,
        licenseNote: sticker.licenseNote,
        sha256: media.sha256,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        width: media.width,
        height: media.height,
      })),
    };
  });
}
