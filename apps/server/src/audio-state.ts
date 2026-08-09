import { and, asc, eq } from "drizzle-orm";
import { assets, campaignAudioTracks } from "@arken/db";
import { inspectStoredAudioDuration } from "./storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export function effectiveAudioPosition(
  state: {
    playing: boolean;
    startedAt: Date | null;
    positionSeconds: number;
    loop: boolean;
  },
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
 * UIX-382: now applies per track row (a campaign can have up to 4 active
 * tracks, each with its own independent transport/deadline), so this
 * normalizes every track for the campaign and returns the resulting rows.
 */
export async function normalizeAudioTrackDeadlines(
  db: Database,
  campaignId: string,
  now = new Date(),
) {
  const rows = await db
    .select({ state: campaignAudioTracks, durationSeconds: assets.durationSeconds })
    .from(campaignAudioTracks)
    .leftJoin(assets, eq(campaignAudioTracks.assetId, assets.id))
    .where(eq(campaignAudioTracks.campaignId, campaignId))
    .orderBy(
      asc(campaignAudioTracks.slotOrder),
      asc(campaignAudioTracks.createdAt),
    );

  const results = await Promise.all(
    rows.map(async (row) => {
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
        .update(campaignAudioTracks)
        .set({
          playing: false,
          positionSeconds: durationSeconds,
          startedAt: null,
          revision: state.revision + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(campaignAudioTracks.id, state.id),
            eq(campaignAudioTracks.revision, state.revision),
          ),
        )
        .returning();
      if (normalized) return normalized;
      const [current] = await db
        .select()
        .from(campaignAudioTracks)
        .where(eq(campaignAudioTracks.id, state.id))
        .limit(1);
      return current ?? state;
    }),
  );
  return results;
}
