import { describe, expect, it } from "vitest";
import {
  canViewWorldMap,
  canViewWorldMapLocation,
} from "./world-map-access.js";
import {
  insertInitialWorldMapPartyPosition,
  resolveInitialPartyPositionRace,
  runWorldMapMutation,
} from "./world-map-routes.js";

const gm = {
  membershipId: "00000000-0000-4000-8000-000000000001",
  campaignId: "00000000-0000-4000-8000-000000000002",
  role: "GM" as const,
  displayName: "GM",
};
const player = { ...gm, role: "PLAYER" as const };

const map = (
  lifecycle: "DRAFT" | "PUBLISHED" | "ARCHIVED",
  visibility: "CAMPAIGN" | "GM_ONLY",
) => ({ lifecycle, visibility }) as never;
const location = (visibility: "PUBLIC" | "DISCOVERED" | "GM_ONLY") =>
  ({ visibility }) as never;

describe("world map visibility policy", () => {
  it("does not disclose drafts, archived maps, or GM-only maps to players", () => {
    expect(canViewWorldMap(map("DRAFT", "CAMPAIGN"), player)).toBe(false);
    expect(canViewWorldMap(map("ARCHIVED", "CAMPAIGN"), player)).toBe(false);
    expect(canViewWorldMap(map("PUBLISHED", "GM_ONLY"), player)).toBe(false);
    expect(canViewWorldMap(map("PUBLISHED", "CAMPAIGN"), player)).toBe(true);
  });

  it("keeps GM inspection available while hiding GM-only locations from players", () => {
    expect(canViewWorldMap(map("DRAFT", "GM_ONLY"), gm)).toBe(true);
    expect(canViewWorldMapLocation(location("PUBLIC"), player)).toBe(true);
    expect(canViewWorldMapLocation(location("DISCOVERED"), player)).toBe(true);
    expect(canViewWorldMapLocation(location("GM_ONLY"), player)).toBe(false);
    expect(canViewWorldMapLocation(location("GM_ONLY"), gm)).toBe(true);
  });
});

describe("world map action idempotency", () => {
  it("replays the committed action when concurrent requests lose the game-event unique race", async () => {
    const actionId = "00000000-0000-4000-8000-000000000010";
    const event = {
      sequence: 1,
      campaignId: gm.campaignId,
      actionId,
      membershipId: gm.membershipId,
      type: "world_map.created",
      entityType: "WORLD_MAP",
      entityId: "00000000-0000-4000-8000-000000000011",
      entityRevision: 0,
      payload: { mapId: "00000000-0000-4000-8000-000000000011" },
      createdAt: new Date(),
    };
    let transactionCalls = 0;
    let mutationCalls = 0;
    const db = {
      transaction: async (mutation: (tx: never) => Promise<string>) => {
        transactionCalls += 1;
        if (transactionCalls === 2)
          throw {
            code: "23505",
            constraint_name: "game_events_campaign_action_idx",
          };
        return mutation(undefined as never);
      },
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [event] }),
        }),
      }),
    } as never;

    const [first, retry] = await Promise.all([
      runWorldMapMutation(db, gm, actionId, "world_map.created", async () => {
        mutationCalls += 1;
        return "created";
      }),
      runWorldMapMutation(db, gm, actionId, "world_map.created", async () => {
        mutationCalls += 1;
        return "created twice";
      }),
    ]);

    expect(first).toEqual({ result: "created" });
    expect(retry).toEqual({ replay: event });
    expect(mutationCalls).toBe(1);
  });

  it("returns a conflict result when distinct first-write actions race on the campaign position", async () => {
    let conflictTarget: unknown;
    const tx = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: (options: { target: unknown }) => {
            conflictTarget = options.target;
            return { returning: async () => [] };
          },
        }),
      }),
    } as never;

    const position = await insertInitialWorldMapPartyPosition(tx, {
      campaignId: gm.campaignId,
      mapId: "00000000-0000-4000-8000-000000000020",
      locationId: "00000000-0000-4000-8000-000000000021",
      updatedByMembershipId: gm.membershipId,
    });

    expect(conflictTarget).toBeDefined();
    expect(position).toBeNull();
  });

  it("re-reads the action deterministically after losing the initial position insert", async () => {
    const actionId = "00000000-0000-4000-8000-000000000030";
    const event = {
      membershipId: gm.membershipId,
      type: "world_map.party_position_set",
    };
    const replayDb = (rows: unknown[]) =>
      ({
        select: () => ({
          from: () => ({
            where: () => ({ limit: async () => rows }),
          }),
        }),
      }) as never;

    await expect(
      resolveInitialPartyPositionRace(
        replayDb([event]),
        gm,
        actionId,
        "world_map.party_position_set",
      ),
    ).resolves.toBe("duplicate");
    await expect(
      resolveInitialPartyPositionRace(
        replayDb([]),
        gm,
        actionId,
        "world_map.party_position_set",
      ),
    ).resolves.toBe("conflict");
  });
});
