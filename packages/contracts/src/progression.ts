import { z } from "zod";

export const progressionTargetSchema = z
  .object({
    kind: z.enum(["STAT", "SKILL", "SPELL", "ENTRY"]),
    key: z.string().min(1).max(160),
  })
  .strict();
const sp = z.number().int().min(1).max(1_000_000);
const note = z.string().trim().min(1).max(2000);
export const progressionDataSchema = z.object({
  kind: z.enum(["UPGRADE", "GRANT"]),
  state: z.enum([
    "PENDING",
    "APPLIED",
    "DECLINED",
    "CANCELLED",
    "REVERSED",
    "GRANTED",
  ]),
  target: progressionTargetSchema.nullable(),
  targetLabel: z.string(),
  sp,
  proposedSp: sp.nullable(),
  roll: z.number().int().min(1).max(20).nullable(),
  effect: z.string(),
  appliedSequence: z.number().int().nonnegative().nullable(),
  adjustment: z
    .object({
      before: z.number().finite(),
      after: z.number().finite(),
    })
    .nullable(),
  history: z.array(
    z.object({
      action: z.string(),
      membershipId: z.string().uuid(),
      at: z.string().datetime(),
      note: z.string(),
      sp: z.number().int().nonnegative(),
    }),
  ),
});
export type ProgressionData = z.infer<typeof progressionDataSchema>;
export type ProgressionTarget = z.infer<typeof progressionTargetSchema>;
export const createProgressionSchema = z
  .object({
    actionId: z.string().uuid(),
    target: progressionTargetSchema,
    sp,
    comment: note,
  })
  .strict();
export const grantProgressionSpSchema = z
  .object({
    actionId: z.string().uuid(),
    sp,
    note,
  })
  .strict();
const actionBase = {
  actionId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
};
export const progressionActionSchema = z.discriminatedUnion("action", [
  z.object({ ...actionBase, action: z.literal("COUNTER"), sp, note }).strict(),
  z.object({ ...actionBase, action: z.literal("CONSENT") }).strict(),
  z
    .object({
      ...actionBase,
      action: z.literal("APPLY"),
      effect: note,
      // Numeric change is optional. Text effects do not alter shared spell packs.
      delta: z.number().finite().min(-100000).max(100000).optional(),
    })
    .strict(),
  z.object({ ...actionBase, action: z.literal("DECLINE"), note }).strict(),
  z.object({ ...actionBase, action: z.literal("CANCEL"), note }).strict(),
  z.object({ ...actionBase, action: z.literal("REVERSE"), note }).strict(),
]);
export type ProgressionAction = z.infer<typeof progressionActionSchema>;
