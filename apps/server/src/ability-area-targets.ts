import { z } from "zod";
import { abilityAreaCircle } from "@arken/contracts";

const placement = z.object({
  id: z.string().uuid(),
  characterId: z.string().uuid().nullable(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
const inputSchema = z.object({
  casterTokenId: z.string().uuid(),
  casterCharacterId: z.string().uuid(),
  radiusMeters: z.number().finite().positive().max(1000000),
  gridSize: z.number().finite().positive(),
  metersPerCell: z.number().finite().positive().max(1000000),
  placements: z.array(placement).max(10000),
  playerCharacterIds: z.array(z.string().uuid()).max(10000),
});

/** Pure geometry over a server-authorized single-scene snapshot. Caller must
 * derive PLAYER ownership from character membership, not token layer/owner,
 * exclude archived/cross-campaign characters and hold consistency locks.
 * Hidden targets must not be disclosed through a player-facing preview.
 */
export function selectAbilityAreaTargets(input: unknown) {
  const value = inputSchema.parse(input);
  const origins = value.placements.filter(
    (token) =>
      token.id === value.casterTokenId &&
      token.characterId === value.casterCharacterId,
  );
  if (origins.length !== 1) throw new Error("AREA_ORIGIN_UNAVAILABLE");
  const origin = origins[0]!;
  const circle = abilityAreaCircle(origin, value.radiusMeters, {
    size: value.gridSize,
    metersPerCell: value.metersPerCell,
  });
  if (!circle) throw new Error("AREA_SCALE_REQUIRED");
  const eligible = new Set(value.playerCharacterIds);
  const selected = new Set<string>();
  for (const token of value.placements) {
    if (!token.characterId || !eligible.has(token.characterId)) continue;
    const distance = Math.hypot(
      token.x + token.width / 2 - circle.x,
      token.y + token.height / 2 - circle.y,
    );
    if (distance <= circle.radius) selected.add(token.characterId);
  }
  // Stable order supports deterministic multi-character resource locking.
  return [...selected].sort();
}
