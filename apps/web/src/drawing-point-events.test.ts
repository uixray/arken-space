import { describe, expect, it } from "vitest";
import type { DrawingDto, GameSnapshot } from "@arken/contracts";
import {
  applyDrawingRemoved,
  applyDrawingUpserted,
} from "./drawing-point-events";

const drawing = (id: string, revision = 0): DrawingDto => ({
  id,
  sceneId: "scene",
  authorMembershipId: "member",
  points: [0, 0, 1, 1],
  color: "#ffffff",
  x: 0,
  y: 0,
  revision,
  kind: "FREEHAND",
});
const snapshot = (drawings: DrawingDto[], snapshotVersion = 10) =>
  ({ snapshotVersion, drawings }) as unknown as GameSnapshot;

describe("UIX-412 drawing point events on the client", () => {
  it("appends a new drawing and replaces a known one in place", () => {
    const start = snapshot([drawing("a"), drawing("b")]);
    const added = applyDrawingUpserted(start, {
      sequence: 11,
      data: drawing("c"),
    });
    expect(added.drawings!.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(added.snapshotVersion).toBe(11);
    const moved = applyDrawingUpserted(added, {
      sequence: 12,
      data: drawing("a", 1),
    });
    expect(moved.drawings!.map(({ id, revision }) => [id, revision])).toEqual([
      ["a", 1],
      ["b", 0],
      ["c", 0],
    ]);
  });

  it("applies an event older than the snapshot version without lowering it", () => {
    // The server orders delivery; an earlier snapshot may already carry the
    // sequence while missing the row, and the event must still land.
    const next = applyDrawingUpserted(snapshot([], 20), {
      sequence: 15,
      data: drawing("a"),
    });
    expect(next.drawings).toHaveLength(1);
    expect(next.snapshotVersion).toBe(20);
  });

  it("removes a drawing and ignores an unknown id", () => {
    const start = snapshot([drawing("a"), drawing("b")]);
    const removed = applyDrawingRemoved(start, {
      sequence: 11,
      data: { drawingId: "a" },
    });
    expect(removed.drawings!.map(({ id }) => id)).toEqual(["b"]);
    expect(
      applyDrawingRemoved(removed, { sequence: 12, data: { drawingId: "z" } })
        .drawings,
    ).toEqual(removed.drawings);
  });
});
