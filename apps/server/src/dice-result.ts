import { z } from "zod";
import {
  DICE_FRAME_SOURCES,
  type DiceResult,
  type SkillCardSnapshot,
} from "@arken/contracts";

const diceTermSchema = z.object({
  notation: z.string().max(16),
  rolls: z.array(z.number().finite()).max(100),
  subtotal: z.number().finite(),
});

const diceResultSchema = z.object({
  formula: z.string().max(160),
  resolvedFormula: z.string().max(512),
  terms: z.array(diceTermSchema).max(80),
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
  rollMode: z.enum(["NORMAL", "ADVANTAGE", "DISADVANTAGE"]).optional(),
  poolTotals: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  poolTerms: z
    .tuple([z.array(diceTermSchema).max(80), z.array(diceTermSchema).max(80)])
    .optional(),
  selectedPool: z.union([z.literal(0), z.literal(1)]).optional(),
  semanticOutcome: z
    .object({
      kind: z.enum(["NORMAL", "CRITICAL_FAILURE", "CRITICAL_SUCCESS"]),
      keptNaturalD20: z.number().int().min(1).max(20).nullable(),
    })
    .optional(),
  frame: z
    .object({
      setKey: z.literal("ARKEN_CRITICAL_V1"),
      frameKey: z.enum(["critical-failure", "critical-success"]),
    })
    .nullable()
    .optional(),
  styleFrame: z
    .object({
      assetId: z.string().uuid(),
      source: z.enum(DICE_FRAME_SOURCES),
    })
    .nullable()
    .optional(),
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

const skillCardActionSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(["HIT", "DAMAGE", "CUSTOM"]),
  label: z.string().min(1).max(100),
  dice: z.string().max(16),
  advantage: z.boolean(),
  consumeUse: z.boolean(),
});

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
  action: skillCardActionSchema.nullable(),
  formula: z.string().max(160).nullable(),
  result: diceResultSchema.nullable(),
  rolls: z
    .array(
      z.object({
        action: skillCardActionSchema,
        formula: z.string().max(160),
        result: diceResultSchema,
      }),
    )
    .max(20)
    .optional(),
  activationCost: z
    .object({
      type: z.enum(["physical", "magic"]),
      amount: z.number().int().positive().max(100000),
      before: z.number().finite(),
      after: z.number().finite(),
    })
    .nullable()
    .optional(),
  uses: z
    .object({
      before: z.number().int().nonnegative(),
      after: z.number().int().nonnegative(),
      max: z.number().int().positive(),
      recharge: z.enum(["DAY", "BATTLE", "WEEK", "SHORT_REST"]),
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
