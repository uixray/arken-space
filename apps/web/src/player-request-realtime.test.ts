import { describe, expect, it } from "vitest";
import type { GameSnapshot, PlayerRequestDto } from "@arken/contracts";
import {
  applyPlayerRequestChanged,
  reconcilePlayerRequests,
} from "./player-request-realtime";

const request = (id: string, revision: number): PlayerRequestDto => ({
  id,
  campaignId: "campaign",
  authorMembershipId: "author",
  authorDisplayName: "Author",
  characterId: null,
  characterName: null,
  audience: "PUBLIC",
  horizon: "NOW",
  status: "SUBMITTED",
  title: `r${revision}`,
  body: "body",
  resolutionNote: null,
  resolvedByMembershipId: null,
  resolvedByDisplayName: null,
  revision,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(revision).toISOString(),
});
const snapshot = (requests: PlayerRequestDto[]): GameSnapshot =>
  ({
    campaign: { id: "campaign" },
    me: { id: "member" },
    playerRequests: requests,
  }) as GameSnapshot;

describe("player request realtime reconciliation", () => {
  it("upserts only a newer authorized DTO", () => {
    const current = snapshot([
      request("00000000-0000-4000-8000-000000000001", 2),
    ]);
    expect(
      applyPlayerRequestChanged(
        current,
        request("00000000-0000-4000-8000-000000000001", 2),
      ),
    ).toBe(current);
    expect(
      applyPlayerRequestChanged(
        current,
        request("00000000-0000-4000-8000-000000000001", 1),
      ),
    ).toBe(current);
    expect(
      applyPlayerRequestChanged(
        current,
        request("00000000-0000-4000-8000-000000000001", 3),
      )?.playerRequests?.[0]?.revision,
    ).toBe(3);
    expect(
      applyPlayerRequestChanged(
        current,
        request("00000000-0000-4000-8000-000000000002", 0),
      )?.playerRequests,
    ).toHaveLength(2);
  });

  it("preserves newer and snapshot-absent realtime entries", () => {
    const newer = request("00000000-0000-4000-8000-000000000001", 3);
    const absent = request("00000000-0000-4000-8000-000000000002", 1);
    const incomingOnly = request("00000000-0000-4000-8000-000000000003", 0);
    expect(
      reconcilePlayerRequests(
        [newer, absent],
        [request(newer.id, 2), incomingOnly],
      ),
    ).toEqual([newer, incomingOnly, absent]);
  });
});
