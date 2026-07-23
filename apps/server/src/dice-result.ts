import { z } from "zod";
import type { DiceResult, SkillCardSnapshot } from "@arken/contracts";

const diceResultSchema = z.object({
  formula: z.string().max(160),
  resolvedFormula: z.string().max(512),
  terms: z
    .array(
      z.object({
        notation: z.string().max(16),
        rolls: z.array(z.number().finite()).max(100),
        subtotal: z.number().finite(),
      }),
    )
    .max(80),
  modifiers: z
    .array(
      z.object({
        source: z.string().max(160),
        value: z.number().finite(),
      }),
    )
    .max(160),
  total: z.number().finite(),
  label: z.string().max(100).optional(),
});

/**
 * Chat history predates the current DiceResult contract and is stored as
 * untyped JSONB. Invalid rows must remain readable as ordinary messages
 * rather than taking down the whole React tree.
 */
export function normalizeDiceResult(value: unknown): DiceResult | null {
  const result = diceResultSchema.safeParse(value);
  return result.success ? result.data : null;
}

const skillCardSchema = z.object({
  version: z.literal(1),
  execution: z.enum(["EXECUTED", "SHARED"]),
  entry: z.object({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    sourceCatalogEntryId: z.string().uuid().nullable(),
    kind: z.enum(["SKILL", "ABILITY"]),
    name: z.string().min(1).max(120),
    description: z.string().max(10000),
    notes: z.string().max(10000).nullable(),
  }),
  actor: z.object({
    membershipId: z.string().uuid(),
    displayName: z.string().min(1).max(40),
    characterId: z.string().uuid(),
    characterName: z.string().min(1).max(80),
  }),
  action: z
    .object({
      id: z.string().min(1).max(40),
      kind: z.enum(["HIT", "DAMAGE", "CUSTOM"]),
      label: z.string().min(1).max(100),
      dice: z.string().max(16),
      advantage: z.boolean(),
      consumeUse: z.boolean(),
    })
    .nullable(),
  formula: z.string().max(160).nullable(),
  result: diceResultSchema.nullable(),
  uses: z
    .object({
      before: z.number().int().nonnegative(),
      after: z.number().int().nonnegative(),
      max: z.number().int().positive(),
      recharge: z.enum(["DAY", "BATTLE", "WEEK"]),
    })
    .nullable(),
  visibility: z.enum(["PUBLIC", "GM_ONLY"]),
});
/** Cards are an additive payload in the established DICE JSON column. */
export function normalizeSkillCard(value: unknown): SkillCardSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const parsed = skillCardSchema.safeParse(
    (value as Record<string, unknown>).skillCard,
  );
  return parsed.success ? parsed.data : null;
}
