import { describe, expect, it } from "vitest";
import type { CharacterDto, PlayerRequestDto } from "@arken/contracts";
import {
  canCancelRequest,
  canEditRequest,
  createRequestPayload,
  requestCharacters,
  requestLabels,
  visiblePlayerRequests,
} from "./player-request-ui";

const row = (overrides: Partial<PlayerRequestDto> = {}): PlayerRequestDto => ({
  id: crypto.randomUUID(),
  campaignId: crypto.randomUUID(),
  authorMembershipId: "author",
  authorDisplayName: "Игрок",
  characterId: null,
  characterName: null,
  audience: "PUBLIC",
  horizon: "NOW",
  status: "SUBMITTED",
  title: "Заявка",
  body: "Текст",
  resolutionNote: null,
  resolvedByMembershipId: null,
  resolvedByDisplayName: null,
  revision: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const character = (
  id: string,
  overrides: Partial<CharacterDto> = {},
): CharacterDto => ({
  id,
  name: id,
  ownerMembershipId: null,
  controllerMembershipIds: [],
  portraitAssetId: null,
  stats: {},
  skills: [],
  spells: [],
  notes: "",
  backstory: "",
  inventory: [],
  resources: {},
  wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
  entries: [],
  revision: 0,
  lifecycle: "ACTIVE",
  archivedAt: null,
  archivedByMembershipId: null,
  ...overrides,
});

describe("player request UI policy", () => {
  it("uses exact audience labels and trims create payload", () => {
    expect(requestLabels.audience).toEqual({
      PUBLIC: "Всем участникам",
      GM_ONLY: "Автору и всем мастерам",
    });
    expect(
      createRequestPayload({
        title: "  T ",
        body: " B  ",
        horizon: "NOW",
        audience: "GM_ONLY",
        characterId: "",
      }),
    ).toEqual({
      title: "T",
      body: "B",
      horizon: "NOW",
      audience: "GM_ONLY",
      characterId: null,
    });
    expect(
      createRequestPayload({
        title: "T",
        body: "B",
        horizon: "NOW",
        audience: "PUBLIC",
        characterId: "delegated",
      }).characterId,
    ).toBe("delegated");
  });
  it("offers owned, delegated-controlled, and active characters without leaking unrelated ones", () => {
    const characters = [
      character("owned", { ownerMembershipId: "member" }),
      character("delegated", { controllerMembershipIds: ["member"] }),
      character("active"),
      character("unrelated", {
        ownerMembershipId: "other",
        controllerMembershipIds: ["other"],
      }),
    ];

    expect(
      requestCharacters(characters, "member", "active").map(({ id }) => id),
    ).toEqual(["owned", "delegated", "active"]);
    expect(
      requestCharacters(
        [
          character("same", {
            ownerMembershipId: "member",
            controllerMembershipIds: ["member"],
          }),
        ],
        "member",
        "same",
      ),
    ).toHaveLength(1);
  });
  it("enforces player ownership and filters", () => {
    const rows = [
      row(),
      row({ authorMembershipId: "other", horizon: "NEXT_SESSION" }),
      row({ status: "RESOLVED" }),
    ];
    expect(
      visiblePlayerRequests(rows, "author", "PLAYER", {
        state: "OPEN",
        horizon: "ALL",
        audience: "ALL",
      }),
    ).toHaveLength(1);
    expect(
      visiblePlayerRequests(rows, "gm", "GM", {
        state: "CLOSED",
        horizon: "ALL",
        audience: "ALL",
      }),
    ).toHaveLength(1);
  });
  it("allows only canonical author transitions", () => {
    expect(canEditRequest(row(), "author")).toBe(true);
    expect(canEditRequest(row({ status: "ACKNOWLEDGED" }), "author")).toBe(
      false,
    );
    expect(canCancelRequest(row({ status: "ACKNOWLEDGED" }), "author")).toBe(
      true,
    );
    expect(canCancelRequest(row(), "other")).toBe(false);
  });
});
