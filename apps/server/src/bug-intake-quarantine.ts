/** Bounded human-review projection, not raw Update disclosure or normalized intake.
 * Hash identifies the entire payload; equal previews may still differ elsewhere. */
export function quarantineVariantPreview(
  hash: string,
  payload: Record<string, unknown>,
) {
  const key = [
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
  ].find((name) => payload[name] && typeof payload[name] === "object");
  const message = key ? (payload[key] as Record<string, unknown>) : {};
  const text =
    typeof message.text === "string"
      ? message.text
      : typeof message.caption === "string"
        ? message.caption
        : "";
  const kinds = [
    "document",
    "animation",
    "audio",
    "video",
    "voice",
    "photo",
    "sticker",
    "video_note",
    "live_photo",
    "rich_message",
    "paid_media",
    "contact",
    "location",
    "poll",
  ].filter((name) => message[name] !== undefined);
  const names = kinds.flatMap((name) => {
    const item = message[name];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const filename = (item as Record<string, unknown>).file_name;
    return typeof filename === "string" ? [filename.slice(0, 200)] : [];
  });
  return {
    hash,
    kind: key ?? "unknown",
    text: text.slice(0, 50000),
    textTruncated: text.length > 50000,
    mediaKinds: kinds,
    filenames: names,
    editedAt:
      typeof message.edit_date === "number" &&
      Number.isSafeInteger(message.edit_date)
        ? message.edit_date
        : null,
  };
}
