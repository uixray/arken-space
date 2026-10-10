import { z } from "zod";

export const soundpadAudienceSchema = z.enum(["ALL_MEMBERS", "GM_ONLY"]);
export const soundpadPackSchema = z.object({
  id: z.string().uuid(), campaignId: z.string().uuid(), name: z.string(),
  published: z.boolean(), audience: soundpadAudienceSchema, sortOrder: z.number().int(),
  sounds: z.array(z.object({
    id: z.string().uuid(), packId: z.string().uuid(), assetId: z.string().uuid(),
    label: z.string(), icon: z.string(), category: z.string(), sortOrder: z.number().int(),
    defaultGain: z.number().min(0).max(1), audience: soundpadAudienceSchema,
    sourceNote: z.string().nullable(),
  })),
});
export type SoundpadPackDto = z.infer<typeof soundpadPackSchema>;
export type SoundpadSoundDto = SoundpadPackDto["sounds"][number];

export const soundpadPackCreateSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const soundpadPackUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  published: z.boolean().optional(),
  audience: soundpadAudienceSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
export const soundpadSoundCreateSchema = z.object({
  assetId: z.string().uuid(), label: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(8).default("🔊"),
  category: z.string().trim().min(1).max(32).default("Другое"),
  defaultGain: z.number().min(0).max(1).default(0.5),
  audience: soundpadAudienceSchema.default("ALL_MEMBERS"),
  sourceNote: z.string().trim().max(240).nullable().default(null),
}).strict();
export const soundpadSoundUpdateSchema = soundpadSoundCreateSchema.partial().strict().refine((value) => Object.keys(value).length > 0);
export const soundpadTriggerSchema = z.object({ soundId: z.string().uuid(), actionId: z.string().uuid() }).strict();
export const soundpadPlaybackPolicySchema = z.object({ playerPlaybackEnabled: z.boolean() }).strict();
export interface SoundpadTriggeredEvent {
  eventId: string; soundId: string; assetId: string; label: string; defaultGain: number;
  membershipId: string; displayName: string; serverTime: string;
}
