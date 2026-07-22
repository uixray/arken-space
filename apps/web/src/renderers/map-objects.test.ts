import type { DrawingDto, TokenDto } from "@arken/contracts";
import { describe, expect, it } from "vitest";
import {
  canSelectDrawing,
  canSelectToken,
  drawingBounds,
  selectMapObjects,
} from "./map-objects";

const token = (patch: Partial<TokenDto> = {}): TokenDto => ({
  id: "token",
  definitionId: "definition",
  definitionRevision: 1,
  controllerMembershipIds: ["player"],
  sceneId: "scene",
  characterId: null,
  ownerMembershipId: "player",
  assetId: null,
  name: "Token",
  x: 10,
  y: 10,
  z: 0,
  levelId: null,
  width: 20,
  height: 20,
  rotation: 0,
  visible: true,
  locked: false,
  baseColor: "#000",
  frameColor: null,
  layer: "PLAYER",
  revision: 1,
  ...patch,
});

const drawing = (patch: Partial<DrawingDto> = {}): DrawingDto => ({
  id: "drawing",
  sceneId: "scene",
  authorMembershipId: "player",
  points: [0, 0, 20, 20],
  color: "#000",
  x: 10,
  y: 10,
  revision: 1,
  ...patch,
});

const context = {
  role: "PLAYER" as const,
  membershipId: "player",
  world: { width: 100, height: 100 },
  fogReveals: [
    { id: "fog", sceneId: "scene", x: 0, y: 0, width: 50, height: 50 },
  ],
};

describe("canonical map object selection", () => {
  it("lets the GM select valid in-world objects and respects the GM layer toggle", () => {
    const gm = { ...context, role: "GM" as const, membershipId: "gm" };
    expect(canSelectToken(token({ visible: false }), gm)).toBe(true);
    expect(canSelectToken(token({ layer: "MAP" }), gm)).toBe(true);
    expect(
      canSelectToken(token({ layer: "GM" }), { ...gm, showGmLayer: false }),
    ).toBe(false);
    expect(canSelectDrawing(drawing(), gm)).toBe(true);
  });

  it("restricts players by layer, visibility and ownership", () => {
    expect(canSelectToken(token(), context)).toBe(true);
    expect(canSelectToken(token({ layer: "GM" }), context)).toBe(false);
    expect(canSelectToken(token({ layer: "MAP" }), context)).toBe(false);
    expect(canSelectToken(token({ visible: false }), context)).toBe(false);
    expect(
      canSelectToken(
        token({ ownerMembershipId: "other", controllerMembershipIds: [] }),
        context,
      ),
    ).toBe(false);
    expect(
      canSelectDrawing(drawing({ authorMembershipId: "other" }), context),
    ).toBe(false);
  });

  it("allows a controlled player token through fog but requires fog for owner-only tokens and drawings", () => {
    const hidden = { ...context, fogReveals: [] };
    expect(canSelectToken(token(), hidden)).toBe(true);
    expect(canSelectToken(token({ controllerMembershipIds: [] }), hidden)).toBe(
      false,
    );
    expect(canSelectDrawing(drawing(), hidden)).toBe(false);
    expect(canSelectDrawing(drawing(), context)).toBe(true);
  });

  it("rejects objects wholly outside the world and accepts intersecting objects", () => {
    const gm = { ...context, role: "GM" as const };
    expect(canSelectToken(token({ x: 100 }), gm)).toBe(false);
    expect(canSelectToken(token({ x: 99 }), gm)).toBe(true);
    expect(canSelectDrawing(drawing({ x: -40 }), gm)).toBe(false);
    expect(canSelectDrawing(drawing({ x: -19 }), gm)).toBe(true);
  });

  it("handles empty, malformed and straight drawing points without unsafe bounds", () => {
    expect(drawingBounds(drawing({ points: [] }))).toBeNull();
    expect(drawingBounds(drawing({ points: [0, 0, 1] }))).toBeNull();
    expect(
      drawingBounds(drawing({ points: [0, 0, Number.NaN, 1] })),
    ).toBeNull();
    expect(drawingBounds(drawing({ points: [0, 0, 20, 0] }))).toEqual({
      x: 10,
      y: 10,
      width: 20,
      height: 1,
    });
  });

  it("returns the same bounded policy for bulk candidates", () => {
    const result = selectMapObjects(
      [token(), token({ id: "gm", layer: "GM" })],
      [drawing(), drawing({ id: "empty", points: [] })],
      context,
    );
    expect(result.tokens.map(({ id }) => id)).toEqual(["token"]);
    expect(result.drawings.map(({ id }) => id)).toEqual(["drawing"]);
  });
});
