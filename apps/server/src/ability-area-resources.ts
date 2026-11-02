import { z } from "zod";
import { entryDataSchema } from "@arken/contracts";

const poolSchema = z.object({ current: z.number().finite().nonnegative(),
  maximum: z.number().finite().nonnegative().optional(),
}).passthrough();
const resourcesSchema = z.record(z.string(), poolSchema);

/** Build updates from locked server rows, never client-provided resource values.
 * No mutation/randomness here. The caller rolls one canonical server d6 and
 * commits all returned updates, entry use and journal in one transaction.
 */
export function planAbilityAreaResources(input: {
  casterId: string;
  entryData: unknown;
  sharedRoll: number;
  targetIds: readonly string[];
  characters: readonly { id: string; resources: unknown }[];
}) {
  const data = entryDataSchema.parse(input.entryData);
  if (!data.areaEffect) throw new Error("AREA_EFFECT_REQUIRED");
  const roll = z.number().int().min(1).max(6).parse(input.sharedRoll);
  const ids = new Set(input.targetIds);
  if (ids.size !== input.targetIds.length) throw new Error("DUPLICATE_AREA_TARGET");
  const rows = new Map(input.characters.map((row) => [row.id, row]));
  if (rows.size !== input.characters.length) throw new Error("DUPLICATE_CHARACTER");
  const caster = rows.get(input.casterId);
  if (!caster || [...ids].some((id) => !rows.has(id))) throw new Error("AREA_CHARACTER_MISSING");
  if (ids.size === 0) throw new Error("AREA_TARGETS_EMPTY");
  // Area use is one activation, not a rollAction or executeAll multiplier.
  // An explicit ability-wide cost wins; contradictory legacy costs must be
  // resolved by the author, never silently dropped when activating an area.
  const legacyCosts = [data.activation?.cost, ...(data.rollActions ?? []).map((action) => action.cost)]
    .filter((cost): cost is NonNullable<typeof cost> => Boolean(cost));
  const distinct = legacyCosts.filter((cost, index) => legacyCosts.findIndex((entry) =>
    entry.type === cost.type && entry.amount === cost.amount) === index);
  if (data.usageCost === undefined && distinct.length > 1)
    throw new Error("ABILITY_ACTION_COST_MISMATCH");
  const cost = data.usageCost === undefined ? distinct[0] : data.usageCost;
  if (data.uses && data.uses.current < 1) throw new Error("ABILITY_USES_EXHAUSTED");
  const changes = new Map<string, z.infer<typeof resourcesSchema>>();
  function resources(id: string) {
    let value = changes.get(id);
    if (!value) {
      value = { ...resourcesSchema.parse(rows.get(id)!.resources) };
      changes.set(id, value);
    }
    return value;
  }
  let spent: { type: string; amount: number; before: number; after: number } | null = null;
  if (cost) {
    const key = cost.type === "magic" ? "magicPower" : "physicalPower";
    const current = resources(input.casterId);
    const pool = poolSchema.parse(current[key]);
    if (pool.current < cost.amount) throw new Error("INSUFFICIENT_CHARACTER_RESOURCE");
    spent = { ...cost, before: pool.current, after: pool.current - cost.amount };
    current[key] = { ...pool, current: spent.after };
  }
  const effects = [];
  for (const id of [...ids].sort()) {
    const current = resources(id);
    const pool = poolSchema.parse(current.magicPower);
    // Do not reduce an already-over-cap pool, and do not invent a maximum.
    const amount = pool.maximum === undefined ? roll : Math.max(0, Math.min(roll, pool.maximum - pool.current));
    const after = pool.current + amount;
    if (!Number.isFinite(after)) throw new Error("INVALID_RESOURCE_RESULT");
    current.magicPower = { ...pool, current: after };
    effects.push({ characterId: id, before: pool.current, after, restored: amount });
  }
  return { sharedRoll: roll, spent, effects,
    updates: [...changes].sort(([a], [b]) => a.localeCompare(b))
      .map(([id, resources]) => ({ id, resources })),
    entryData: { ...data, ...(data.uses ? { uses: { ...data.uses, current: data.uses.current - 1 } } : {}) },
  };
}
