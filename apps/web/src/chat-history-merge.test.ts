import { describe, expect, it } from "vitest";
import type { ChatMessageDto, GameSnapshot } from "@arken/contracts";
import { mergeChatHistory } from "./chat-state";

/**
 * UIX-450. Подшивка истории — место, где легко получить дубли и потерянный
 * порядок: страница приходит по запросу человека, а событие `chat:created` —
 * само, и они пересекаются.
 */
const message = (id: string, sequence: number, threadId = "table") =>
  ({ id, sequence, threadId, body: id }) as unknown as ChatMessageDto;

const snapshotWith = (messages: ChatMessageDto[]) =>
  ({ messages }) as unknown as GameSnapshot;

describe("mergeChatHistory", () => {
  it("ставит старые сообщения перед новыми по номеру", () => {
    const merged = mergeChatHistory(snapshotWith([message("d", 4)]), [
      message("b", 2),
      message("a", 1),
    ]);
    expect(merged.messages.map((item) => item.id)).toEqual(["a", "b", "d"]);
  });

  it("не задваивает то, что уже пришло событием", () => {
    // Страница берётся строго старше показанного, но между запросом и ответом
    // могло прийти новое сообщение — и оно окажется в обеих выборках.
    const snapshot = snapshotWith([message("b", 2), message("c", 3)]);
    const merged = mergeChatHistory(snapshot, [
      message("a", 1),
      message("b", 2),
    ]);
    expect(merged.messages.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("возвращает тот же снапшот, когда нового нет", () => {
    // Ссылочное равенство важно: новый объект заставил бы React перерисовать
    // всю ленту на пустой подгрузке.
    const snapshot = snapshotWith([message("a", 1)]);
    expect(mergeChatHistory(snapshot, [message("a", 1)])).toBe(snapshot);
    expect(mergeChatHistory(snapshot, [])).toBe(snapshot);
  });

  it("не перемешивает потоки", () => {
    const merged = mergeChatHistory(
      snapshotWith([message("table-2", 2, "table")]),
      [message("direct-1", 1, "direct")],
    );
    expect(
      merged.messages.filter((item) => item.threadId === "table"),
    ).toHaveLength(1);
    expect(
      merged.messages.filter((item) => item.threadId === "direct"),
    ).toHaveLength(1);
  });
});
