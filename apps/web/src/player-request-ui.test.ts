import { describe, expect, it } from "vitest";
import type { PlayerRequestDto } from "@arken/contracts";
import { canCancelRequest, canEditRequest, createRequestPayload, requestLabels, visiblePlayerRequests } from "./player-request-ui";

const row = (overrides: Partial<PlayerRequestDto> = {}): PlayerRequestDto => ({
  id: crypto.randomUUID(), campaignId: crypto.randomUUID(), authorMembershipId: "author",
  authorDisplayName: "Игрок", characterId: null, characterName: null, audience: "PUBLIC",
  horizon: "NOW", status: "SUBMITTED", title: "Заявка", body: "Текст", resolutionNote: null,
  resolvedByMembershipId: null, resolvedByDisplayName: null, revision: 0,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...overrides,
});

describe("player request UI policy", () => {
  it("uses exact audience labels and trims create payload", () => {
    expect(requestLabels.audience).toEqual({ PUBLIC: "Всем участникам", GM_ONLY: "Автору и всем мастерам" });
    expect(createRequestPayload({ title: "  T ", body: " B  ", horizon: "NOW", audience: "GM_ONLY", characterId: "" }))
      .toEqual({ title: "T", body: "B", horizon: "NOW", audience: "GM_ONLY", characterId: null });
  });
  it("enforces player ownership and filters", () => {
    const rows = [row(), row({ authorMembershipId: "other", horizon: "NEXT_SESSION" }), row({ status: "RESOLVED" })];
    expect(visiblePlayerRequests(rows, "author", "PLAYER", { state: "OPEN", horizon: "ALL", audience: "ALL" })).toHaveLength(1);
    expect(visiblePlayerRequests(rows, "gm", "GM", { state: "CLOSED", horizon: "ALL", audience: "ALL" })).toHaveLength(1);
  });
  it("allows only canonical author transitions", () => {
    expect(canEditRequest(row(), "author")).toBe(true);
    expect(canEditRequest(row({ status: "ACKNOWLEDGED" }), "author")).toBe(false);
    expect(canCancelRequest(row({ status: "ACKNOWLEDGED" }), "author")).toBe(true);
    expect(canCancelRequest(row(), "other")).toBe(false);
  });
});
