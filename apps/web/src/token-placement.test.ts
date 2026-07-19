import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import { characterTokenPlacementRequest } from "./token-placement";

const character = {
  id: "character-ed",
  name: "Ed",
  ownerMembershipId: "member-ed",
} as GameSnapshot["characters"][number];
const scene = {
  id: "scene-two",
  width: 1600,
  height: 1000,
  grid: { size: 64 },
} as GameSnapshot["scenes"][number];

function snapshot(
  tokenDefinitions: NonNullable<GameSnapshot["tokenDefinitions"]>,
) {
  return {
    characters: [character],
    tokenDefinitions,
  } as GameSnapshot;
}

describe("character token placement", () => {
  it("reuses the linked definition on repeated placement and targets the viewed scene", () => {
    const definition = {
      id: "definition-ed",
      characterId: character.id,
    } as NonNullable<GameSnapshot["tokenDefinitions"]>[number];
    const first = characterTokenPlacementRequest(
      snapshot([definition]),
      character.id,
      scene,
      "action-one",
    );
    const second = characterTokenPlacementRequest(
      snapshot([definition]),
      character.id,
      scene,
      "action-two",
    );

    expect(first?.path).toBe(
      "/api/token-definitions/definition-ed/placements",
    );
    expect(first?.body).toMatchObject({
      definitionId: definition.id,
      sceneId: scene.id,
    });
    expect(second?.path).toBe(first?.path);
    expect(second?.body).toMatchObject({
      definitionId: definition.id,
      sceneId: scene.id,
    });
  });

  it("uses the legacy bootstrap route only when no linked definition exists", () => {
    const request = characterTokenPlacementRequest(
      snapshot([]),
      character.id,
      scene,
      "bootstrap-action",
    );

    expect(request).toEqual({
      path: "/api/tokens",
      body: {
        actionId: "bootstrap-action",
        sceneId: scene.id,
        characterId: character.id,
        ownerMembershipId: character.ownerMembershipId,
        name: character.name,
        x: 800,
        y: 500,
        width: 64,
        height: 64,
      },
    });
  });
});
