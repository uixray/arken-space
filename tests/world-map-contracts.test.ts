import { describe, expect, it } from "vitest";
import {
  createWorldMapLocationSchema,
  createWorldMapSchema,
  setWorldMapPartyPositionSchema,
  updateWorldMapLocationSchema,
  updateWorldMapSchema,
} from "../packages/contracts/src/index.js";

const actionId = "10000000-0000-4000-8000-000000000001";
const mapId = "10000000-0000-4000-8000-000000000002";
const locationId = "10000000-0000-4000-8000-000000000003";

describe("world-map contracts", () => {
  it("bounds draft maps and rejects unmodelled hierarchy or routes", () => {
    expect(createWorldMapSchema.parse({ actionId, name: "Arken" })).toEqual({
      actionId,
      name: "Arken",
      scope: "REGION",
      visibility: "CAMPAIGN",
    });
    expect(
      createWorldMapSchema.safeParse({
        actionId,
        name: "Arken",
        parentMapId: mapId,
      }).success,
    ).toBe(false);
    expect(
      updateWorldMapSchema.safeParse({ actionId, mapId, revision: 0 }).success,
    ).toBe(false);
  });

  it("accepts only normalized location coordinates and meaningful updates", () => {
    expect(
      createWorldMapLocationSchema.parse({
        actionId,
        mapId,
        name: "Port",
        x: 0,
        y: 1,
      }),
    ).toMatchObject({
      kind: "OTHER",
      visibility: "GM_ONLY",
      summary: "",
      gmNotes: "",
      x: 0,
      y: 1,
    });
    expect(
      createWorldMapLocationSchema.safeParse({
        actionId,
        mapId,
        name: "Port",
        x: -0.01,
        y: 0.5,
      }).success,
    ).toBe(false);
    expect(
      createWorldMapLocationSchema.safeParse({
        actionId,
        mapId,
        name: "Port",
        x: 0.5,
        y: 0.5,
        routeTo: locationId,
      }).success,
    ).toBe(false);
    expect(
      createWorldMapLocationSchema.safeParse({
        actionId,
        mapId,
        name: "Port",
        x: 0.5,
        y: 0.5,
        gmNotes: "x".repeat(10001),
      }).success,
    ).toBe(false);
    expect(
      updateWorldMapLocationSchema.safeParse({
        actionId,
        locationId,
        revision: 1,
      }).success,
    ).toBe(false);
  });

  it("makes initial party placement explicit and location-only", () => {
    expect(
      setWorldMapPartyPositionSchema.parse({ actionId, mapId, locationId }),
    ).toEqual({ actionId, mapId, locationId, revision: null });
    expect(
      setWorldMapPartyPositionSchema.safeParse({
        actionId,
        mapId,
        locationId,
        revision: null,
        inTransit: true,
      }).success,
    ).toBe(false);
  });
});
