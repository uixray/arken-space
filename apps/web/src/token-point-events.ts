import type { GameSnapshot, TokenDto } from "@arken/contracts";

/** Sequence at which a canonical snapshot stopped exposing a token. Retained
 * across reappearance so a delayed event for an old incarnation cannot replace it. */
export type TokenRemovalWatermarks = Map<string, number>;

export function recordTokenRemovals(
  previous: GameSnapshot | null,
  next: GameSnapshot,
  watermarks: TokenRemovalWatermarks,
): void {
  if (
    !previous ||
    previous.campaign.id !== next.campaign.id ||
    previous.me.id !== next.me.id
  ) {
    watermarks.clear();
    return;
  }
  const present = new Set(next.tokens.map((token) => token.id));
  for (const token of previous.tokens) {
    if (!present.has(token.id))
      watermarks.set(
        token.id,
        Math.max(watermarks.get(token.id) ?? -1, next.snapshotVersion),
      );
  }
}

export function applyTokenPointEvent(
  current: GameSnapshot,
  event: { sequence: number; data: TokenDto },
  watermarks: ReadonlyMap<string, number>,
  allowEqualRevision = false,
): GameSnapshot {
  const existing = current.tokens.find((token) => token.id === event.data.id);
  if (!existing || existing.sceneId !== event.data.sceneId) return current;
  if (event.sequence <= (watermarks.get(event.data.id) ?? -1)) return current;
  if (
    allowEqualRevision
      ? event.data.revision < existing.revision
      : event.data.revision <= existing.revision
  )
    return current;
  return {
    ...current,
    snapshotVersion: Math.max(current.snapshotVersion, event.sequence),
    tokens: current.tokens.map((token) =>
      token.id === event.data.id ? event.data : token,
    ),
  };
}

type TokenPreviewIdentity = {
  tokenId: string;
  revision: number;
  sceneId?: string;
  snapshotVersion?: number;
  previewEpoch?: string;
};

function updateTokenPreview(
  current: GameSnapshot,
  movement: TokenPreviewIdentity,
  watermarks: ReadonlyMap<string, number>,
  currentEpoch: string | undefined,
  update: (token: TokenDto) => TokenDto,
): GameSnapshot {
  const existing = current.tokens.find(
    (token) => token.id === movement.tokenId,
  );
  // Legacy previews remain suppressed after disappearance; modern previews
  // carry the sender scene and canonical snapshot cursor.
  if (
    !existing ||
    (currentEpoch !== undefined && movement.previewEpoch !== currentEpoch) ||
    (movement.sceneId !== undefined && movement.sceneId !== existing.sceneId) ||
    (watermarks.has(movement.tokenId) &&
      (currentEpoch === undefined || movement.previewEpoch !== currentEpoch ||
       movement.snapshotVersion === undefined ||
       movement.snapshotVersion < watermarks.get(movement.tokenId)!)) ||
    existing.revision !== movement.revision
  )
    return current;
  return {
    ...current,
    tokens: current.tokens.map((token) => token === existing ? update(token) : token),
  };
}

export function applyTokenPreview(
  current: GameSnapshot,
  movement: TokenPreviewIdentity & { x: number; y: number },
  watermarks: ReadonlyMap<string, number>,
  currentEpoch?: string,
): GameSnapshot {
  return updateTokenPreview(current, movement, watermarks, currentEpoch, (token) => ({
    ...token, x: movement.x, y: movement.y,
    // A player's canonical projection never includes an invisible token.
    // Thus a valid public preview may restore a token hidden by a redacted one.
    visible: current.me.role === "PLAYER" ? true : token.visible,
  }));
}

export function applyHiddenTokenPreview(
  current: GameSnapshot,
  event: TokenPreviewIdentity,
  watermarks: ReadonlyMap<string, number>,
  currentEpoch?: string,
): GameSnapshot {
  if (current.me.role !== "PLAYER" || !currentEpoch) return current;
  return updateTokenPreview(current, event, watermarks, currentEpoch, (token) => ({
    ...token, visible: false,
  }));
}
