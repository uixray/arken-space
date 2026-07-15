import type { ChatMessageDto, GameSnapshot } from "@arken/contracts";

export function appendChatMessage(
  snapshot: GameSnapshot,
  message: ChatMessageDto,
  sequence: number,
) {
  if (snapshot.messages.some((item) => item.id === message.id)) return snapshot;
  const messages = [...snapshot.messages, message]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-200);
  if (!messages.some((item) => item.id === message.id)) return snapshot;
  return {
    ...snapshot,
    snapshotVersion: Math.max(snapshot.snapshotVersion, sequence),
    messages,
  };
}
