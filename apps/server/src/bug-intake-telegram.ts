import { z } from "zod";
import { bugSourceMessageSchema } from "@arken/contracts";

const integer = z.number().int().safe();
const fileSchema = z.object({
  file_id: z.string().min(1).max(256),
  file_name: z.string().max(200).optional(),
  mime_type: z.string().max(120).optional(),
  file_size: integer.nonnegative().optional(),
});
const messageSchema = z
  .object({
    message_id: integer.positive(),
    date: integer.nonnegative(),
    edit_date: integer.nonnegative().optional(),
    chat: z.object({
      id: integer,
      type: z.enum(["group", "supergroup", "channel", "private"]),
      username: z
        .string()
        .regex(/^[A-Za-z0-9_]{1,64}$/)
        .optional(),
    }),
    media_group_id: z.string().min(1).max(128).optional(),
    text: z.string().max(50000).optional(),
    caption: z.string().max(50000).optional(),
    from: z
      .object({ first_name: z.string(), last_name: z.string().optional() })
      .optional(),
    author_signature: z.string().optional(),
    document: fileSchema.optional(),
    video: fileSchema.optional(),
    audio: fileSchema.optional(),
    voice: fileSchema.optional(),
    animation: fileSchema.optional(),
    photo: z
      .array(
        fileSchema.extend({
          width: integer.positive(),
          height: integer.positive(),
        }),
      )
      .max(20)
      .optional(),
  })
  .passthrough();

/** Pure normalization only. Caller authenticates updates and persists cursor;
 * no Telegram calls, tokens, polling or webhook registration here.
 * Reference: https://core.telegram.org/bots/api#message */
export function normalizeTelegramBugUpdate(
  input: unknown,
  allowedChatId: string,
) {
  if (!/^-?[1-9][0-9]*$/.test(allowedChatId))
    throw new Error("CHAT_ALLOWLIST_REQUIRED");
  const update = z
    .object({
      update_id: integer.nonnegative(),
      message: messageSchema.optional(),
      edited_message: messageSchema.optional(),
      channel_post: messageSchema.optional(),
      edited_channel_post: messageSchema.optional(),
    })
    .parse(input);
  const messages = [
    update.message,
    update.edited_message,
    update.channel_post,
    update.edited_channel_post,
  ].filter((item) => item !== undefined);
  if (messages.length !== 1) return { status: "UNSUPPORTED_UPDATE" as const };
  const message = messages[0]!;
  if (String(message.chat.id) !== allowedChatId)
    return { status: "OTHER_CHAT" as const };
  if (!["group", "supergroup", "channel"].includes(message.chat.type))
    return { status: "UNSUPPORTED_CHAT" as const };
  // Do not silently discard unsupported attachments, protected or rich content.
  const unsupported = [
    "rich_message",
    "live_photo",
    "paid_media",
    "sticker",
    "video_note",
    "story",
    "contact",
    "location",
    "venue",
    "poll",
    "checklist",
    "dice",
    "game",
    "business_connection_id",
    "has_protected_content",
  ];
  if (unsupported.some((key) => message[key] !== undefined))
    return { status: "UNSUPPORTED_CONTENT" as const };
  const files: z.infer<typeof fileSchema>[] = [];
  // Animation also appears as document for Bot API compatibility; select it once.
  if (message.animation) files.push(message.animation);
  else if (message.document) files.push(message.document);
  for (const file of [message.video, message.audio, message.voice])
    if (file) files.push(file);
  if (message.photo?.length)
    files.push(
      [...message.photo].sort(
        (a, b) => b.width * b.height - a.width * a.height,
      )[0]!,
    );
  if (!message.text && !message.caption && !files.length)
    return { status: "UNSUPPORTED_CONTENT" as const };
  const source = bugSourceMessageSchema.parse({
    provider: "TELEGRAM",
    chatId: allowedChatId,
    messageId: String(message.message_id),
    sourceRevisionAt: new Date(
      (message.edit_date ?? message.date) * 1000,
    ).toISOString(),
    albumId: message.media_group_id ?? null,
    authorLabel:
      (
        message.author_signature ??
        (message.from
          ? [message.from.first_name, message.from.last_name]
              .filter(Boolean)
              .join(" ")
          : "")
      ).slice(0, 200) || null,
    originalText: message.text ?? message.caption ?? "",
    sourceUrl: message.chat.username
      ? `https://t.me/${message.chat.username}/${message.message_id}`
      : null,
    attachments: files.map((file, index) => ({
      sourceFileId: file.file_id,
      name: file.file_name || `attachment-${index + 1}`,
      declaredMime: file.mime_type ?? null,
      declaredSizeBytes: file.file_size ?? null,
    })),
  });
  return { status: "READY" as const, updateId: update.update_id, source };
}
