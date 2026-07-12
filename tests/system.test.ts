import { describe, expect, it } from "vitest";
import { arkenSystem, createStarterCharacter } from "../packages/system/src";
import {
  createSceneSchema,
  moveTokenSchema,
  projectionSchema,
} from "../packages/contracts/src";

describe("system definition", () => {
  it("contains unique stat keys and produces a complete starter character", () => {
    const keys = arkenSystem.stats.map((stat) => stat.key);
    expect(new Set(keys).size).toBe(keys.length);
    const starter = createStarterCharacter();
    expect(Object.keys(starter.stats)).toEqual(keys);
  });

  it("keeps future projections in the contract while defaulting scenes to 2D", () => {
    expect(projectionSchema.options).toEqual([
      "ORTHOGRAPHIC_2D",
      "ISOMETRIC",
      "THREE_D",
    ]);
    const scene = createSceneSchema.parse({
      name: "Тест",
      actionId: crypto.randomUUID(),
    });
    expect(scene.grid.size).toBe(64);
  });

  it("keeps z and levelId in token movement", () => {
    const movement = moveTokenSchema.parse({
      actionId: crypto.randomUUID(),
      tokenId: crypto.randomUUID(),
      x: 12,
      y: 24,
      revision: 0,
    });
    expect(movement.z).toBe(0);
    expect(movement.levelId).toBeNull();
  });
});
