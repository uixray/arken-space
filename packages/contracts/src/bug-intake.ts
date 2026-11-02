import { z } from "zod";

/** Adapter-neutral input. This is NOT an authenticated Telegram webhook. */
const sourceId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^-?[1-9][0-9]*$/);
export const bugSourceMessageSchema = z
  .object({
    provider: z.literal("TELEGRAM"),
    chatId: sourceId,
    messageId: sourceId,
    /** Stable source revision timestamp, not the time our worker happened to retry. */
    sourceRevisionAt: z.string().datetime(),
    albumId: z.string().min(1).max(128).nullable().default(null),
    authorLabel: z.string().max(200).nullable().default(null),
    originalText: z.string().max(50000),
    sourceUrl: z
      .string()
      .url()
      .max(1024)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.hostname === "t.me" &&
          !url.username &&
          !url.password
        );
      })
      .nullable()
      .default(null),
    attachments: z
      .array(
        z
          .object({
            sourceFileId: z.string().min(1).max(256),
            name: z.string().min(1).max(200),
            /** Advisory until bytes are inspected; never trust the source MIME. */
            declaredMime: z.string().min(1).max(120).nullable().default(null),
            declaredSizeBytes: z
              .number()
              .int()
              .nonnegative()
              .max(1024 * 1024 * 1024)
              .nullable()
              .default(null),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.originalText.trim() && !value.attachments.length)
      ctx.addIssue({
        code: "custom",
        path: ["originalText"],
        message: "Нужен текст или вложение",
      });
    const seen = new Set<string>();
    value.attachments.forEach((item, index) => {
      if (seen.has(item.sourceFileId))
        ctx.addIssue({
          code: "custom",
          path: ["attachments", index],
          message: "Повтор вложения",
        });
      seen.add(item.sourceFileId);
    });
  });
export type BugSourceMessage = z.infer<typeof bugSourceMessageSchema>;

export const bugQueueStateSchema = z.enum([
  "REVIEW",
  "APPROVED",
  "LINKED",
  "DISMISSED",
]);
export const bugAttachmentStateSchema = z.enum([
  "MISSING",
  "STORED",
  "FAILED",
  "EXCLUDED",
]);
export type BugAttachmentState = z.infer<typeof bugAttachmentStateSchema>;

/** Operator-selected outbound content; source/private IDs are never implied. */
export const reviewedBugCopySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(50000),
    attachmentIds: z.array(z.string().uuid()).max(20),
    reviewed: z.literal(true),
    /** Explicit consent to transfer the selected contents, not all original data. */
    transferApproved: z.literal(true),
  })
  .strict()
  .superRefine((copy, ctx) => {
    if (new Set(copy.attachmentIds).size !== copy.attachmentIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["attachmentIds"],
        message: "Повтор вложения",
      });
  });
export type ReviewedBugCopy = z.infer<typeof reviewedBugCopySchema>;

export const bugQueueCommandSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export const approveBugCopySchema = bugQueueCommandSchema.extend({
  copy: reviewedBugCopySchema,
});

/** Every referenced file must be durably stored; missing files cannot be silently omitted. */
export function bugCopyAttachmentError(
  copy: ReviewedBugCopy,
  attachments: readonly { id: string; state: BugAttachmentState }[],
):
  | "UNKNOWN_ATTACHMENT"
  | "ATTACHMENT_NOT_STORED"
  | "UNRESOLVED_ATTACHMENT"
  | null {
  const selected = new Set(copy.attachmentIds);
  for (const id of selected) {
    const item = attachments.find((candidate) => candidate.id === id);
    if (!item) return "UNKNOWN_ATTACHMENT";
    if (item.state !== "STORED") return "ATTACHMENT_NOT_STORED";
  }
  // An operator must explicitly exclude every omitted attachment, including
  // failed downloads. This distinguishes an intentional omission from data loss.
  if (
    attachments.some(
      (item) => !selected.has(item.id) && item.state !== "EXCLUDED",
    )
  )
    return "UNRESOLVED_ATTACHMENT";
  return null;
}
