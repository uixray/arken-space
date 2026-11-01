import { z } from "zod";
export const privateNotebookCommandSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    text: z.string().max(20000),
  })
  .strict();
export const inspirationStateSchema = z
  .object({
    current: z.number().int().min(0).max(100000),
    maximum: z.number().int().min(0).max(100000),
  })
  .refine((value) => value.current <= value.maximum);
export const inspirationAdjustSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    state: inspirationStateSchema,
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const inspirationRerollSchema = z
  .object({
    actionId: z.string().uuid(),
    sourceMessageId: z.string().uuid(),
  })
  .strict();
export const inspirationLinkSchema = z
  .object({
    sourceMessageId: z.string().uuid(),
    sourceTotal: z.number().finite(),
    sourceLabel: z.string().max(100),
  })
  .strict();
export type InspirationState = z.infer<typeof inspirationStateSchema>;
export type InspirationLink = z.infer<typeof inspirationLinkSchema>;
