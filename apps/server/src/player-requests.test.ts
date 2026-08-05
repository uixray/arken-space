import { describe, expect, it } from "vitest";
import {
  createPlayerRequestSchema,
  listPlayerRequestsSchema,
  playerRequestDtoSchema,
  transitionPlayerRequestSchema,
  updatePlayerRequestSchema,
} from "@arken/contracts";
import {
  canCreatePlayerRequest,
  playerRequestStateStatuses,
  playerRequestTransitions,
} from "./player-requests.js";

const actionId = "00000000-0000-4000-8000-000000000001";
describe("player request contracts", () => {
  it("keeps audience immutable and rejects attachments or unknown filters", () => {
    expect(
      createPlayerRequestSchema.safeParse({
        actionId,
        audience: "PUBLIC",
        horizon: "NOW",
        title: "Help",
        body: "Please",
        attachments: [],
      }).success,
    ).toBe(false);
    expect(
      updatePlayerRequestSchema.safeParse({
        actionId,
        revision: 0,
        title: "Help",
        body: "Please",
        audience: "GM_ONLY",
      }).success,
    ).toBe(false);
    expect(
      listPlayerRequestsSchema.safeParse({ campaignId: actionId }).success,
    ).toBe(false);
    expect(
      listPlayerRequestsSchema.safeParse({
        horizon: "BEFORE_BREAK",
        state: "OPEN",
        audience: "GM_ONLY",
      }).success,
    ).toBe(true);
    expect(listPlayerRequestsSchema.safeParse({ state: "STALE" }).success).toBe(
      false,
    );
  });
  it("accepts only the bounded transition command surface", () => {
    expect(
      transitionPlayerRequestSchema.safeParse({
        actionId,
        revision: 0,
        action: "ACKNOWLEDGE",
      }).success,
    ).toBe(true);
    expect(
      transitionPlayerRequestSchema.safeParse({
        actionId,
        revision: 0,
        action: "REOPEN",
      }).success,
    ).toBe(false);
    expect(
      transitionPlayerRequestSchema.safeParse({
        actionId,
        revision: 0,
        action: "RESOLVE",
        resolutionNote: "Handled",
      }).success,
    ).toBe(true);
    expect(
      transitionPlayerRequestSchema.safeParse({
        actionId,
        revision: 0,
        action: "CANCEL",
        resolutionNote: "leak",
      }).success,
    ).toBe(false);
  });

  it("models resolution metadata inside the ACL-filtered request DTO", () => {
    expect(
      playerRequestDtoSchema.safeParse({
        id: actionId,
        campaignId: actionId,
        authorMembershipId: actionId,
        authorDisplayName: "Player",
        characterId: null,
        characterName: null,
        audience: "GM_ONLY",
        horizon: "NEXT_SESSION",
        status: "RESOLVED",
        title: "Help",
        body: "Please",
        resolutionNote: "Done privately",
        resolvedByMembershipId: actionId,
        resolvedByDisplayName: "GM",
        revision: 1,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }).success,
    ).toBe(true);
  });
});
describe("player request creation policy", () => {
  const base = {
    membershipId: actionId,
    campaignId: actionId,
    displayName: "Member",
  };
  it("allows players and denies GMs", () => {
    expect(canCreatePlayerRequest({ ...base, role: "PLAYER" })).toBe(true);
    expect(canCreatePlayerRequest({ ...base, role: "GM" })).toBe(false);
    expect(playerRequestStateStatuses.OPEN).toEqual([
      "SUBMITTED",
      "ACKNOWLEDGED",
    ]);
    expect(playerRequestStateStatuses.CLOSED).toEqual([
      "RESOLVED",
      "DECLINED",
      "CANCELLED",
    ]);
  });
});

describe("player request transition policy", () => {
  it("makes terminal states immutable", () => {
    expect(playerRequestTransitions.RESOLVED).toEqual([]);
    expect(playerRequestTransitions.DECLINED).toEqual([]);
    expect(playerRequestTransitions.CANCELLED).toEqual([]);
  });
  it("allows the specified submitted and acknowledged transitions", () => {
    expect(playerRequestTransitions.SUBMITTED).toEqual([
      "ACKNOWLEDGE",
      "RESOLVE",
      "DECLINE",
      "CANCEL",
    ]);
    expect(playerRequestTransitions.ACKNOWLEDGED).toEqual([
      "RESOLVE",
      "DECLINE",
      "CANCEL",
    ]);
  });
});
