import { z } from "zod";
import type { DiceResult } from "@arken/contracts";

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
