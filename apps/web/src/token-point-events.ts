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

export function applyTokenPreview(
  current: GameSnapshot,
  movement: { tokenId: string; revision: number; x: number; y: number },
  watermarks: ReadonlyMap<string, number>,
): GameSnapshot {
  const existing = current.tokens.find(
    (token) => token.id === movement.tokenId,
  );
  // Previews carry no sequence or scene. After an ID has disappeared, only a
  // committed event can distinguish a new placement from a delayed preview.
  if (
    !existing ||
    watermarks.has(movement.tokenId) ||
    existing.revision !== movement.revision
  )
    return current;
  return {
    ...current,
    tokens: current.tokens.map((token) =>
      token.id === movement.tokenId
        ? { ...token, x: movement.x, y: movement.y }
        : token,
    ),
  };
}
