import { and, eq, inArray } from "drizzle-orm";
import {
  memberships,
  playerLikenessConsents,
  stickerMedia,
  stickerPackEntitlements,
  stickerPacks,
  stickers,
} from "@arken/db";
import type { AuthContext } from "./auth.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Pack = typeof stickerPacks.$inferSelect;

export const stickerAssetUrl = (stickerId: string) =>
  `/api/stickers/${stickerId}/content`;

export function packAllowsViewer(
  pack: Pick<Pack, "audience" | "subject" | "subjectMembershipId">,
  member: { id: string; role: "GM" | "PLAYER" },
  entitled: boolean,
  consentGranted: boolean,
) {
  if (pack.subject === "PLAYER" && !consentGranted) return false;
  if (member.role === "GM") return true;
  if (pack.audience === "GM_ONLY") return false;
  return pack.audience === "CAMPAIGN" || entitled;
}

export function packAllowsSender(
  pack: Pick<Pack, "sendPolicy">,
  member: { role: "GM" | "PLAYER" },
  entitled: boolean,
) {
  if (member.role === "GM") return true;
  if (pack.sendPolicy === "GM_ONLY") return false;
  return pack.sendPolicy === "ALL_MEMBERS" || entitled;
}

async function accessRows(
  db: Database,
  campaignId: string,
  pack: Pack,
  memberIds: string[],
) {
  const [memberRows, entitlements, consents] = await Promise.all([
    db
      .select({ id: memberships.id, role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.campaignId, campaignId),
          inArray(memberships.id, memberIds),
        ),
      ),
    db
      .select({ membershipId: stickerPackEntitlements.membershipId })
      .from(stickerPackEntitlements)
      .where(
        and(
          eq(stickerPackEntitlements.campaignId, campaignId),
          eq(stickerPackEntitlements.packId, pack.id),
          inArray(stickerPackEntitlements.membershipId, memberIds),
        ),
      ),
    db
      .select({
        membershipId: playerLikenessConsents.membershipId,
        status: playerLikenessConsents.status,
      })
      .from(playerLikenessConsents)
      .where(
        and(
          eq(playerLikenessConsents.campaignId, campaignId),
          eq(playerLikenessConsents.packId, pack.id),
          inArray(playerLikenessConsents.membershipId, memberIds),
        ),
      ),
  ]);
  const entitled = new Set(entitlements.map((row) => row.membershipId));
  const consentGranted = consents.some(
    (row) =>
      row.membershipId === pack.subjectMembershipId && row.status === "GRANTED",
  );
  return memberRows.map((member) => ({
    member,
    entitled: entitled.has(member.id),
    consentGranted,
  }));
}

export async function resolveSticker(
  db: Database,
  auth: AuthContext,
  stickerId: string,
) {
  const [row] = await db
    .select({ sticker: stickers, pack: stickerPacks, media: stickerMedia })
    .from(stickers)
    .innerJoin(
      stickerPacks,
      and(
        eq(stickerPacks.id, stickers.packId),
        eq(stickerPacks.campaignId, stickers.campaignId),
      ),
    )
    .innerJoin(
      stickerMedia,
      and(
        eq(stickerMedia.id, stickers.mediaId),
        eq(stickerMedia.campaignId, stickers.campaignId),
      ),
    )
    .where(
      and(eq(stickers.id, stickerId), eq(stickers.campaignId, auth.campaignId)),
    )
    .limit(1);
  return row ?? null;
}

export async function canMembersViewPack(
  db: Database,
  campaignId: string,
  pack: Pack,
  memberIds: string[],
) {
  const rows = await accessRows(db, campaignId, pack, memberIds);
  return (
    rows.length === memberIds.length &&
    rows.every(({ member, entitled, consentGranted }) =>
      packAllowsViewer(pack, member, entitled, consentGranted),
    )
  );
}

export async function canMemberSendPack(
  db: Database,
  auth: AuthContext,
  pack: Pack,
) {
  const [row] = await accessRows(db, auth.campaignId, pack, [
    auth.membershipId,
  ]);
  return (
    !!row &&
    packAllowsViewer(pack, row.member, row.entitled, row.consentGranted) &&
    packAllowsSender(pack, row.member, row.entitled)
  );
}

export function stickerPresentation(
  row: NonNullable<Awaited<ReturnType<typeof resolveSticker>>>,
) {
  return {
    name: row.sticker.name,
    altText: row.sticker.altText,
    assetUrl: stickerAssetUrl(row.sticker.id),
    width: row.media.width,
    height: row.media.height,
  };
}

export function stickerMessageVisibility(
  audience: Pack["audience"],
): "PUBLIC" | "GM_ONLY" {
  return audience === "GM_ONLY" ? "GM_ONLY" : "PUBLIC";
}

export function isMatchingStickerReplay(
  event: { membershipId: string; type: string; payload: unknown },
  expected: { membershipId: string; threadId: string; stickerId: string },
): event is typeof event & {
  payload: { threadId: string; stickerId: string };
} {
  if (
    event.membershipId !== expected.membershipId ||
    event.type !== "chat.created" ||
    !event.payload ||
    typeof event.payload !== "object"
  )
    return false;
  const payload = event.payload as Record<string, unknown>;
  return (
    payload.threadId === expected.threadId &&
    payload.stickerId === expected.stickerId
  );
}

export const revokedStickerTombstone = {
  name: "Sticker unavailable",
  altText: "Sticker unavailable",
  assetUrl: "/api/stickers/unavailable/content",
  width: 1,
  height: 1,
} as const;

/** Called only after the consent transaction commits, so live snapshots cannot re-expose revoked media. */
export async function invalidateStickerConsentClients(
  broadcast: (campaignId: string) => Promise<void>,
  campaignId: string,
) {
  await broadcast(campaignId);
}
