import type { ChatStream, GameSnapshot } from "@arken/contracts";
import {
  CHAT_STREAM_ORDER,
  messagesForStream,
  threadForStream,
} from "./chat-state";

export type SidebarFeed = "ACTIVITY" | ChatStream;

/** TABLE is authored in the unified activity feed instead of a separate tab. */
export function feedForChatStream(stream: ChatStream): SidebarFeed {
  return stream === "TABLE" || stream === "ROLLS" ? "ACTIVITY" : stream;
}

/**
 * UIX-467: порядок вкладок боковой панели, уже отфильтрованный по роли.
 *
 * «Сюжет» ведёт мастер, игроку поток доставался только на чтение — вкладка
 * занимала место и обещала больше, чем давала. Порядок и видимость считаются
 * в одном месте, потому что из него берут и разметку вкладок, и переход по
 * стрелкам: разъедься они, клавиатура уводила бы игрока на вкладку, которой
 * он не видит.
 */
export function chatFeedOrder(isGm: boolean): readonly SidebarFeed[] {
  return [
    "ACTIVITY",
    // TABLE и ROLLS живут внутри «Событий», отдельной вкладки у них нет.
    ...CHAT_STREAM_ORDER.filter(
      (stream) =>
        stream !== "TABLE" &&
        stream !== "ROLLS" &&
        (isGm || stream !== "STORY"),
    ),
  ];
}

/**
 * Лента, которую можно показывать этой роли. Игрок, оставшийся на «Сюжете»
 * (например, его туда увёл переход к сообщению), возвращается к «Событиям».
 */
export function allowedSidebarFeed(
  feed: SidebarFeed,
  isGm: boolean,
): SidebarFeed {
  return chatFeedOrder(isGm).includes(feed) ? feed : "ACTIVITY";
}

export function activityTableReadTarget(snapshot: GameSnapshot): {
  threadId: string;
  sequence: number;
} | null {
  const thread = threadForStream(snapshot, "TABLE");
  const latest = messagesForStream(
    snapshot.messages,
    "TABLE",
    snapshot.chatThreads,
  ).at(-1);
  return thread && latest
    ? { threadId: thread.id, sequence: latest.sequence }
    : null;
}
