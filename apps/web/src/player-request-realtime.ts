import type { GameSnapshot, PlayerRequestDto } from "@arken/contracts";

/** Upsert a canonical authorized realtime DTO without allowing revision regression. */
export function applyPlayerRequestChanged(
  current: GameSnapshot | null,
  request: PlayerRequestDto,
): GameSnapshot | null {
  if (!current || current.campaign.id !== request.campaignId) return current;
  const requests = current.playerRequests ?? [];
  const existing = requests.find((item) => item.id === request.id);
  if (existing && existing.revision >= request.revision) return current;
  return {
    ...current,
    playerRequests: existing
      ? requests.map((item) => (item.id === request.id ? request : item))
      : [...requests, request],
  };
}

/** Merge a snapshot projection without deleting realtime entries absent from it. */
export function reconcilePlayerRequests(
  current: readonly PlayerRequestDto[] | undefined,
  incoming: readonly PlayerRequestDto[] | undefined,
): PlayerRequestDto[] | undefined {
  if (!current) return incoming ? [...incoming] : undefined;
  if (!incoming) return [...current];
  const merged = new Map(incoming.map((request) => [request.id, request]));
  for (const request of current) {
    const candidate = merged.get(request.id);
    if (!candidate || request.revision > candidate.revision)
      merged.set(request.id, request);
  }
  return [...merged.values()];
}
