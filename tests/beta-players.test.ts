import { describe, expect, it } from "vitest";
import {
  betaPlayerByHandle,
  betaPlayers,
  matchesBetaPlayerIdentity,
} from "../packages/contracts/src/beta-players.js";

describe("beta player aliases", () => {
  it("resolves every public handle case-insensitively", () => {
    for (const player of betaPlayers)
      expect(betaPlayerByHandle(player.handle.toUpperCase())).toEqual(player);
  });

  it("does not resolve unknown handles", () => {
    expect(betaPlayerByHandle("master")).toBeUndefined();
  });

  it("matches either display name or grant label independently", () => {
    const player = betaPlayers[0];
    expect(
      matchesBetaPlayerIdentity(player, {
        displayName: "Unrelated display name",
        label: player.handle.toUpperCase(),
      }),
    ).toBe(true);
    expect(
      matchesBetaPlayerIdentity(player, {
        displayName: player.name,
        label: "Unrelated label",
      }),
    ).toBe(true);
    expect(
      matchesBetaPlayerIdentity(player, {
        displayName: "Unrelated display name",
        label: "Unrelated label",
      }),
    ).toBe(false);
  });
});
