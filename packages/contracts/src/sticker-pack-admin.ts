import { z } from "zod";

export const stickerPackAdminLifecycleSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "DEPRECATED",
  "ARCHIVED",
]);
export const stickerPackAdminConsentSchema = z.enum(["GRANTED", "REVOKED"]);
export const stickerPackAdminProvenanceSchema = z.enum([
  "ORIGINAL",
  "COMMISSIONED",
  "IMPORTED",
]);

export const stickerPackAdminStickerSchema = z.object({
  id: z.string().uuid(),
  packId: z.string().uuid(),
  mediaId: z.string().uuid(),
  name: z.string(),
  altText: z.string(),
  provenanceType: stickerPackAdminProvenanceSchema,
  sourceReference: z.string().nullable(),
  authorCredit: z.string().nullable(),
  licenseNote: z.string().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
});

export const stickerPackAdminSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  subject: z.enum(["CHARACTER", "PLAYER", "NPC", "CREATURE"]),
  subjectCharacterId: z.string().uuid().nullable(),
  subjectMembershipId: z.string().uuid().nullable(),
  subjectLabel: z.string().nullable(),
  audience: z.enum(["CAMPAIGN", "GM_ONLY"]),
  sendPolicy: z.enum(["ALL_MEMBERS", "GM_ONLY"]),
  lifecycle: stickerPackAdminLifecycleSchema,
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  playerConsentStatus: stickerPackAdminConsentSchema.nullable(),
  stickerCount: z.number().int().nonnegative(),
});

export const stickerPackAdminDetailSchema =
  stickerPackAdminSummarySchema.extend({
    stickers: z.array(stickerPackAdminStickerSchema),
  });

export const stickerPackAdminListSchema = z.array(
  stickerPackAdminSummarySchema,
);

export type StickerPackAdminSticker = z.infer<
  typeof stickerPackAdminStickerSchema
>;
export type StickerPackAdminSummary = z.infer<
  typeof stickerPackAdminSummarySchema
>;
export type StickerPackAdminDetail = z.infer<
  typeof stickerPackAdminDetailSchema
>;
