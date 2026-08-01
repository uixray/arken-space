import type { ChatStream, GameSnapshot } from "@arken/contracts";
import { messagesForStream, threadForStream } from "./chat-state";

export type SidebarFeed = "ACTIVITY" | ChatStream;

/** TABLE is authored in the unified activity feed instead of a separate tab. */
export function feedForChatStream(stream: ChatStream): SidebarFeed {
  return stream === "TABLE" || stream === "ROLLS" ? "ACTIVITY" : stream;
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
