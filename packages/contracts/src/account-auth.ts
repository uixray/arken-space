import { z } from "zod";

const emailSchema = z.string().trim().min(3).max(254).email();
const bearerSchema = z.string().min(40).max(64).regex(/^[A-Za-z0-9_-]+$/);
const passwordSchema = z.string().max(512);

export const accountRegistrationSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
}).strict();
export type AccountRegistrationInput = z.infer<typeof accountRegistrationSchema>;

export const accountLoginSchema = accountRegistrationSchema;
export type AccountLoginInput = AccountRegistrationInput;

export const accountEmailInputSchema = z.object({ email: emailSchema }).strict();
export const accountActionTokenSchema = z.object({ token: bearerSchema }).strict();
export const accountPasswordResetSchema = z.object({
  token: bearerSchema,
  password: passwordSchema,
}).strict();
export const accountPasswordChangeSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
}).strict();

export const accountSessionSchema = z.object({
  authenticated: z.literal(true),
  account: z.object({
    id: z.string().uuid(),
    email: emailSchema,
    verified: z.boolean(),
  }).strict(),
  csrfToken: bearerSchema,
}).strict();
export type AccountSession = z.infer<typeof accountSessionSchema>;

export const anonymousAccountSessionSchema = z.object({
  authenticated: z.literal(false),
}).strict();
export const accountActionAcceptedSchema = z.object({ accepted: z.literal(true) }).strict();
export const accountCapabilitiesSchema = z.object({
  accountAuthEnabled: z.boolean(),
  registrationEnabled: z.boolean(),
  legacyDevEnabled: z.boolean(),
  campaignLinkAccessEnabled: z.boolean(),
  campaignCreationEnabled: z.boolean(),
}).strict();
export type AccountCapabilities = z.infer<typeof accountCapabilitiesSchema>;

export const accountCampaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  idempotencyKey: z.string().uuid(),
}).strict();
export const accountCampaignListSchema = z.object({
  campaigns: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    role: z.enum(["GM", "PLAYER"]),
    membershipId: z.string().uuid(),
    selected: z.boolean(),
  }).strict()),
}).strict();
export const accountCampaignIdSchema = z.object({ campaignId: z.string().uuid() }).strict();
export const accountCampaignInviteCreateSchema = z.object({
  campaignId: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  expiresInHours: z.number().int().min(1).max(168).default(72),
}).strict();
export const accountCampaignInviteRevokeSchema = z.object({
  campaignId: z.string().uuid(),
  inviteId: z.string().uuid(),
}).strict();
export const accountCampaignInviteClaimSchema = z.object({
  token: bearerSchema,
}).strict();
