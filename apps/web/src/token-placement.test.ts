import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import {
  canPlaceTokenDefinition,
  characterTokenPlacementRequest,
  mapWorldPointFromDrop,
} from "./token-placement";

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

    expect(first?.path).toBe("/api/token-definitions/definition-ed/placements");
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
        // UIX-400: имя не передаётся — токен персонажа зовётся как персонаж и
        // переименовывается вместе с ним. Копия имени в момент создания и была
        // причиной «Хориста», оставшегося у «Могучего Тэйна».
        x: 800,
        y: 500,
        width: 64,
        height: 64,
      },
    });
  });
});

describe("token definition drag placement permission", () => {
  it("allows the GM to drag-place regardless of controllers", () => {
    expect(
      canPlaceTokenDefinition({
        role: "GM",
        membershipId: "member-gm",
        controllerMembershipIds: [],
      }),
    ).toBe(true);
  });

  it("allows a player who controls the definition to drag-place", () => {
    expect(
      canPlaceTokenDefinition({
        role: "PLAYER",
        membershipId: "member-ed",
        controllerMembershipIds: ["member-ed", "member-other"],
      }),
    ).toBe(true);
  });

  it("denies a player without control rights over the definition", () => {
    expect(
      canPlaceTokenDefinition({
        role: "PLAYER",
        membershipId: "member-ed",
        controllerMembershipIds: ["member-other"],
      }),
    ).toBe(false);
  });
});

describe("mapWorldPointFromDrop", () => {
  it("converts a drop event's client coordinates to map world coordinates", () => {
    const point = mapWorldPointFromDrop({
      clientX: 340,
      clientY: 220,
      containerRect: { left: 40, top: 20 },
      pan: { x: 100, y: 50 },
      scale: 2,
    });

    expect(point).toEqual({ x: 100, y: 75 });
  });

  it("accounts for zero pan/unit scale as the identity transform", () => {
    const point = mapWorldPointFromDrop({
      clientX: 150,
      clientY: 90,
      containerRect: { left: 0, top: 0 },
      pan: { x: 0, y: 0 },
      scale: 1,
    });

    expect(point).toEqual({ x: 150, y: 90 });
  });
});
