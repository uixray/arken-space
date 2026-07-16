import { and, eq } from "drizzle-orm";
import { assets, audioStates } from "@arken/db";
import { inspectStoredAudioDuration } from "./storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export function effectiveAudioPosition(
  state: typeof audioStates.$inferSelect,
  now: Date,
  durationSeconds: number | null,
) {
  const elapsed =
    state.playing && state.startedAt
      ? Math.max(0, (now.getTime() - state.startedAt.getTime()) / 1000)
      : 0;
  const position = Math.max(0, state.positionSeconds + elapsed);
  if (!durationSeconds) return position;
  if (state.loop) return position % durationSeconds;
  return Math.min(position, durationSeconds);
}

export async function ensureAudioDuration(db: Database, assetId: string) {
  const [asset] = await db
    .select({
      durationSeconds: assets.durationSeconds,
      storageKey: assets.storageKey,
      kind: assets.kind,
    })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!asset || asset.kind !== "AUDIO") return null;
  if (asset.durationSeconds) return asset.durationSeconds;
  const durationSeconds = await inspectStoredAudioDuration(
    asset.storageKey,
  ).catch(() => null);
  if (!durationSeconds) return null;
  await db
    .update(assets)
    .set({ durationSeconds })
    .where(and(eq(assets.id, assetId), eq(assets.kind, "AUDIO")));
  return durationSeconds;
}

/**
 * Materializes an elapsed non-loop track as paused at its trusted duration.
 * The CAS update makes this safe when several snapshots reconnect together.
 */
export async function normalizeAudioDeadline(
  db: Database,
  campaignId: string,
  now = new Date(),
) {
  const [row] = await db
    .select({ state: audioStates, durationSeconds: assets.durationSeconds })
    .from(audioStates)
    .leftJoin(assets, eq(audioStates.assetId, assets.id))
    .where(eq(audioStates.campaignId, campaignId))
    .limit(1);
  if (!row) return null;
  const { state } = row;
  const durationSeconds =
    row.durationSeconds ??
    (state.assetId ? await ensureAudioDuration(db, state.assetId) : null);
  if (
    !state.playing ||
    state.loop ||
    !state.startedAt ||
    !durationSeconds ||
    effectiveAudioPosition(state, now, durationSeconds) < durationSeconds
  )
    return state;

  const [normalized] = await db
    .update(audioStates)
    .set({
      playing: false,
      positionSeconds: durationSeconds,
      startedAt: null,
      revision: state.revision + 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(audioStates.campaignId, campaignId),
        eq(audioStates.revision, state.revision),
      ),
    )
    .returning();
  if (normalized) return normalized;
  const [current] = await db
    .select()
    .from(audioStates)
    .where(eq(audioStates.campaignId, campaignId))
    .limit(1);
  return current ?? null;
}
