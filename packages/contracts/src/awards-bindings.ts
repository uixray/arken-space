import { z } from "zod";

export const instanceBindingCommandSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    tokenDefinitionId: z.string().uuid().nullable(),
    containerInstanceId: z.string().uuid().nullable(),
  })
  .strict();
export type InstanceBindingView = {
  revision: number;
  tokenDefinitionId: string | null;
  containerInstanceId: string | null;
  type: string;
  tokens: Array<{ id: string; name: string }>;
  containers: Array<{ id: string; name: string }>;
};
export const achievementFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(4000),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    iconAssetId: z.string().uuid().nullable(),
    provenance: z.string().trim().max(1000),
  })
  .strict();
const command = { actionId: z.string().uuid() };
const entity = {
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
};
export const achievementCommandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...command,
      operation: z.literal("create"),
      fields: achievementFieldsSchema,
    })
    .strict(),
  z
    .object({
      ...command,
      ...entity,
      operation: z.literal("edit"),
      fields: achievementFieldsSchema,
    })
    .strict(),
  z
    .object({
      ...command,
      ...entity,
      operation: z.literal("archive"),
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...command,
      ...entity,
      operation: z.literal("award"),
      membershipIds: z.array(z.string().uuid()).min(1).max(100),
      public: z.boolean().default(false),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      ...command,
      ...entity,
      operation: z.literal("award-state"),
      revoked: z.boolean(),
      public: z.boolean(),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
]);
export type AchievementCommand = z.infer<typeof achievementCommandSchema>;
export type AchievementFields = z.infer<typeof achievementFieldsSchema>;
export type AchievementDto = AchievementFields & {
  id: string;
  revision: number;
  archived: boolean;
};
export type AchievementAwardDto = {
  id: string;
  achievementId: string;
  membershipId: string;
  displayName: string;
  public: boolean;
  revoked: boolean;
  revision: number;
};
export type AchievementView = {
  definitions: AchievementDto[];
  awards: AchievementAwardDto[];
  history: Array<{
    id: string;
    operation: string;
    actor: string;
    reason: string;
    details: unknown;
    createdAt: string;
  }>;
};
