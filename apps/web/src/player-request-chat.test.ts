import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChatMessageDto, PlayerRequestDto } from "@arken/contracts";
import { resolvePlayerRequestCard } from "./player-request-chat";
const message = { playerRequestId: "11111111-1111-4111-8111-111111111111" } as ChatMessageDto;
const request = { id: message.playerRequestId, revision: 3, status: "ACKNOWLEDGED" } as PlayerRequestDto;
describe("resolvePlayerRequestCard", () => {
  it("resolves the latest canonical DTO", () => expect(resolvePlayerRequestCard(message, [request])).toBe(request));
  it("returns unavailable without leaking an id", () => expect(resolvePlayerRequestCard(message, [])).toBeUndefined());
  it("ignores ordinary chat messages", () => expect(resolvePlayerRequestCard({} as ChatMessageDto, [request])).toBeNull());

  it("keeps localized source labels intact", () => {
    const source = readFileSync(new URL("./player-request-chat.tsx", import.meta.url), "utf8");
    for (const label of ["Заявка недоступна", "Карточка заявки", "Срок", "Аудитория", "Персонаж", "Открыть заявки"])
      expect(source).toContain(label);
    expect(source).not.toContain("?".repeat(4));
  });

  it("wires canonical requests into the unified activity feed", () => {
    const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    expect(sidebar).toContain("playerRequests={snapshot.playerRequests}");
    expect(sidebar).toContain("onOpenPlayerRequests={onOpenPlayerRequestCreate}");
  });
});
