import type { ChatMessageDto } from "@arken/contracts";

export type ChatTimelineItem =
  | { type: "DATE"; key: string; label: string }
  | { type: "MESSAGE"; message: ChatMessageDto };

function dateParts(value: string, timeZone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    key: `${values.year}-${values.month}-${values.day}`,
    date,
  };
}

/**
 * Builds display-only date markers from the same local time zone used by the
 * chat's message timestamps. Message order remains the server's sequence.
 */
export function buildChatTimeline(
  messages: ChatMessageDto[],
  options: { timeZone?: string; locale?: string } = {},
): ChatTimelineItem[] {
  const formatter = new Intl.DateTimeFormat(options.locale ?? "ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
  let currentKey: string | null = null;
  const timeline: ChatTimelineItem[] = [];

  for (const message of messages) {
    const parts = dateParts(message.createdAt, options.timeZone);
    const key = parts?.key ?? `invalid-${message.id}`;
    if (key !== currentKey) {
      timeline.push({
        type: "DATE",
        key: `${key}:${message.id}`,
        label: parts ? formatter.format(parts.date) : "Неизвестная дата",
      });
      currentKey = key;
    }
    timeline.push({ type: "MESSAGE", message });
  }

  return timeline;
}
