import { and, eq, gt, lt, sum } from "drizzle-orm";
import { assets, campaignMediaReservations } from "@arken/db";
import { sql } from "drizzle-orm";
import { assertStorageCapacity } from "./storage.js";
type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

const RESERVATION_TTL_MS = 30 * 60 * 1000;

/** Use the same campaign-scoped mutex for reservation mutation and media commit. */
export async function lockCampaignMediaQuota(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], campaignId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${campaignId}))`);
}

/** A writer may commit only while its durable quota reservation is still live. */
export async function requireLiveCampaignMediaReservation(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  campaignId: string,
  requestKey: string,
  actualBytes?: number,
) {
  const [reservation] = await tx.select({ id: campaignMediaReservations.id, reservedBytes: campaignMediaReservations.reservedBytes })
    .from(campaignMediaReservations)
    .where(and(
      eq(campaignMediaReservations.campaignId, campaignId),
      eq(campaignMediaReservations.requestKey, requestKey),
      gt(campaignMediaReservations.expiresAt, new Date()),
    )).limit(1);
  if (!reservation) throw new Error("MEDIA_QUOTA_EXCEEDED");
  if (actualBytes !== undefined && actualBytes > reservation.reservedBytes)
    throw new Error("MEDIA_QUOTA_EXCEEDED");
}

/** Campaign-locked durable quota reservation shared by upload, replace, token and clip writers. */
export async function reserveCampaignMediaBytes(
  db: Database,
  campaignId: string,
  requestKey: string,
  reservedBytes: number,
) {
  if (!Number.isSafeInteger(reservedBytes) || reservedBytes <= 0) throw new Error("INVALID_RESERVATION");
  return db.transaction(async (tx) => {
    await lockCampaignMediaQuota(tx, campaignId);
    await tx.delete(campaignMediaReservations).where(and(
      eq(campaignMediaReservations.campaignId, campaignId),
      lt(campaignMediaReservations.expiresAt, new Date()),
    ));
    const [existing] = await tx.select().from(campaignMediaReservations).where(and(
      eq(campaignMediaReservations.campaignId, campaignId), eq(campaignMediaReservations.requestKey, requestKey),
    )).limit(1);
    if (existing) {
      if (existing.reservedBytes !== reservedBytes) throw new Error("ACTION_CONFLICT");
      return existing.id;
    }
    const [usage] = await tx.select({ bytes: sum(assets.sizeBytes) }).from(assets).where(eq(assets.campaignId, campaignId));
    const [reservations] = await tx.select({ bytes: sum(campaignMediaReservations.reservedBytes) }).from(campaignMediaReservations).where(eq(campaignMediaReservations.campaignId, campaignId));
    const used = Number(usage?.bytes ?? 0) + Number(reservations?.bytes ?? 0);
    await assertStorageCapacity(used, reservedBytes);
    const [row] = await tx.insert(campaignMediaReservations).values({
      campaignId, requestKey, reservedBytes,
      expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
    }).returning({ id: campaignMediaReservations.id });
    if (!row) throw new Error("RESERVATION_FAILED");
    return row.id;
  });
}

export async function releaseCampaignMediaBytes(db: Database, campaignId: string, requestKey: string) {
  await db.transaction(async (tx) => {
    await lockCampaignMediaQuota(tx, campaignId);
    await tx.delete(campaignMediaReservations).where(and(
      eq(campaignMediaReservations.campaignId, campaignId), eq(campaignMediaReservations.requestKey, requestKey),
    ));
  });
}
