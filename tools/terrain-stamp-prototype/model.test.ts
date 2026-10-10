import { describe, expect, it } from "vitest";
import {
  TerrainStampModel,
  validateDocument,
  type StampKind,
  type StampLayer,
} from "./model";

const create = (
  stampId: StampKind = "forest",
  layer: StampLayer = "DECORATION_PUBLIC",
) => ({
  stampId,
  authorKey: "local-prototype-author",
  x: 80,
  y: 96,
  size: 72,
  rotation: 0,
  layer,
});

describe("terrain stamp prototype model", () => {
  it("supports repeat placement, transforms, copy, deletion, undo and redo", () => {
    const model = new TerrainStampModel();
    const first = model.add(create());
    const second = model.add(create("mountain"));
    expect(model.stamps).toHaveLength(2);
    const moved = model.move(first.id, 160, 160);
    expect(moved).toMatchObject({ x: 160, y: 160, revision: 1 });
    const turned = model.transform(first.id, { size: 120, rotation: -45 });
    expect(turned).toMatchObject({ size: 120, rotation: 315, revision: 2 });
    const duplicate = model.copy(second.id);
    expect(duplicate.id).not.toBe(second.id);
    expect(duplicate).toMatchObject({ x: 100, y: 116, revision: 0 });
    model.delete(first.id);
    expect(model.stamps.map(({ id }) => id)).toEqual([second.id, duplicate.id]);
    expect(model.undo()).toBe(true);
    expect(model.stamps.map(({ id }) => id)).toEqual([
      first.id,
      second.id,
      duplicate.id,
    ]);
    expect(model.redo()).toBe(true);
    expect(model.stamps.map(({ id }) => id)).toEqual([second.id, duplicate.id]);
  });

  it("serializes stable object identities and validates restored transforms/layers", () => {
    const model = new TerrainStampModel();
    const forest = model.add(create());
    model.add(create("cloud", "DECORATION_GM"));
    const serialized = model.serialize();
    const restored = new TerrainStampModel();
    restored.load(serialized);
    expect(restored.serialize()).toBe(serialized);
    expect(restored.stamps[0]).toEqual(forest);
    expect(validateDocument(JSON.parse(serialized))).toBe(true);
  });

  it("rejects duplicate IDs, invalid layers, bad transforms and unsupported documents", () => {
    const model = new TerrainStampModel();
    const stamp = model.add({ ...create(), id: "stable-id" });
    expect(() => model.add({ ...create("cloud"), id: stamp.id })).toThrow(
      "duplicate",
    );
    expect(() => model.move(stamp.id, Number.NaN, 0)).toThrow("out of bounds");
    expect(() => model.transform(stamp.id, { size: 999 })).toThrow("Invalid");
    const invalid = JSON.parse(model.serialize());
    invalid.stamps[0].layer = "SECRET";
    expect(validateDocument(invalid)).toBe(false);
    expect(() =>
      model.load(JSON.stringify({ schemaVersion: 2, stamps: [] })),
    ).toThrow("Invalid");
  });
});
