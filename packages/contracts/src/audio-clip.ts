import { z } from "zod";

export const audioClipActionIdSchema = z.string().uuid();

export const audioClipAnalysisSchema = z
  .object({
    sourceAssetId: z.string().uuid(),
    sourceVersion: z.string().min(1),
    durationMs: z.number().positive(),
    sampleRate: z.number().int().positive(),
    channels: z.number().int().min(1).max(8),
    frames: z.number().int().positive(),
    peaks: z.array(z.number().min(0).max(1)).min(1).max(2048),
  })
  .strict();

export const audioClipPreviewRequestSchema = z
  .object({
    actionId: audioClipActionIdSchema,
    sourceVersion: z.string().min(1).max(128),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  })
  .strict()
  .refine((value) => value.startMs < value.endMs, {
    path: ["endMs"],
    message: "End must be after start",
  })
  .refine((value) => value.endMs - value.startMs <= 10_000, {
    path: ["endMs"],
    message: "Clip range must not exceed 10 seconds",
  });

export const audioClipRangeSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    actualStartMs: z.number().nonnegative(),
    actualEndMs: z.number().positive(),
    actualStartFrame: z.number().int().nonnegative(),
    actualEndFrame: z.number().int().positive(),
    sampleRate: z.number().int().positive(),
    channels: z.number().int().min(1).max(8),
    frames: z.number().int().positive(),
  })
  .strict();

export const audioClipPreviewSchema = z
  .object({
    candidateId: z.string().uuid(),
    status: z.enum(["PROCESSING", "READY", "EXPIRED", "CANCELLED", "FAILED"]),
    range: audioClipRangeSchema.nullable(),
    previewUrl: z.string().nullable(),
    expiresAt: z.string().datetime(),
    sizeBytes: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const audioClipCandidateStatusSchema = z
  .object({
    candidateId: z.string().uuid(),
    status: z.enum([
      "PROCESSING",
      "READY",
      "EXPIRED",
      "CANCELLED",
      "FAILED",
      "SAVED",
    ]),
    range: audioClipRangeSchema.nullable(),
    previewUrl: z.string().nullable(),
    expiresAt: z.string().datetime(),
    sizeBytes: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const audioClipSaveRequestSchema = z
  .object({
    actionId: audioClipActionIdSchema,
    candidateId: z.string().uuid(),
    label: z.string().trim().min(1).max(60),
    icon: z.string().trim().min(1).max(8).default("🔊"),
    category: z.string().trim().min(1).max(32).default("Другое"),
    defaultGain: z.number().min(0).max(1).default(0.5),
    audience: z.enum(["ALL_MEMBERS", "GM_ONLY"]).default("ALL_MEMBERS"),
    sourceNote: z.string().trim().max(240).nullable().default(null),
  })
  .strict();

export const audioClipSaveResultSchema = z
  .object({
    packId: z.string().uuid(),
    sound: z.object({
      id: z.string().uuid(),
      packId: z.string().uuid(),
      assetId: z.string().uuid(),
      label: z.string(),
      icon: z.string(),
      category: z.string(),
      sortOrder: z.number().int(),
      defaultGain: z.number().min(0).max(1),
      audience: z.enum(["ALL_MEMBERS", "GM_ONLY"]),
      sourceNote: z.string().nullable(),
    }),
    provenance: z
      .object({
        sourceAssetId: z.string().uuid().nullable(),
        sourceVersion: z.string(),
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive(),
        actualStartFrame: z.number().int().nonnegative(),
        actualEndFrame: z.number().int().positive(),
        sampleRate: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export const audioClipErrorSchema = z
  .object({
    error: z.enum([
      "INVALID_RANGE",
      "UNSUPPORTED_AUDIO",
      "SOURCE_NOT_FOUND",
      "SOURCE_STALE",
      "MEDIA_QUOTA_EXCEEDED",
      "LOW_DISK_SPACE",
      "PROCESSING_BUSY",
      "PROCESSING_TIMEOUT",
      "PROCESSING_OUTPUT_LIMIT",
      "ANALYSIS_RESOURCE_LIMIT",
      "CODEC_UNAVAILABLE",
      "CANDIDATE_EXPIRED",
      "ACTION_CONFLICT",
      "CANDIDATE_NOT_FOUND",
      "GM_REQUIRED",
      "INVALID_COMMAND",
      "AUTH_REQUIRED",
    ]),
  })
  .strict();

export type AudioClipAnalysis = z.infer<typeof audioClipAnalysisSchema>;
export type AudioClipPreviewRequest = z.infer<
  typeof audioClipPreviewRequestSchema
>;
export type AudioClipPreview = z.infer<typeof audioClipPreviewSchema>;
export type AudioClipSaveRequest = z.infer<typeof audioClipSaveRequestSchema>;
