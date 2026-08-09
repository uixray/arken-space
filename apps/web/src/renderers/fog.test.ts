import { describe, expect, it } from "vitest";
import { fogGeometryBounds, fogGeometryContains } from "@arken/contracts";
import type { FogGeometry } from "@arken/contracts";
import { fogOpacity, isRectFullyRevealed, type FogOperation } from "./fog";

/**
 * UIX-395: the exact pre-optimization algorithm, kept here purely as a
 * differential-test oracle. `isRectFullyRevealed` was made dramatically
 * cheaper (bbox pre-check, back-to-front scan with early exit, hoisted
 * geometry resolution) because it ran per token per render and dominated
 * the main thread on busy scenes. Those changes must not alter a single
 * answer, which the randomized test below asserts against this reference.
 */
function referenceIsRectFullyRevealed(
  rect: { x: number; y: number; width: number; height: number },
  reveals: readonly FogOperation[],
) {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const intersecting = reveals.filter(
    (operation) =>
      operation.x < right &&
      operation.x + operation.width > rect.x &&
      operation.y < bottom &&
      operation.y + operation.height > rect.y,
  );
  const xs = new Set([rect.x, right]);
  const ys = new Set([rect.y, bottom]);
  for (const operation of intersecting) {
    xs.add(Math.max(rect.x, operation.x));
    xs.add(Math.min(right, operation.x + operation.width));
    ys.add(Math.max(rect.y, operation.y));
    ys.add(Math.min(bottom, operation.y + operation.height));
  }
  const xCuts = [...xs].sort((a, b) => a - b);
  const yCuts = [...ys].sort((a, b) => a - b);
  for (let xIndex = 0; xIndex < xCuts.length - 1; xIndex++) {
    for (let yIndex = 0; yIndex < yCuts.length - 1; yIndex++) {
      const x = (xCuts[xIndex]! + xCuts[xIndex + 1]!) / 2;
      const y = (yCuts[yIndex]! + yCuts[yIndex + 1]!) / 2;
      let visible = false;
      for (const operation of intersecting) {
        const geometry: FogGeometry = operation.geometry ?? {
          type: "RECT",
          x: operation.x,
          y: operation.y,
          width: operation.width,
          height: operation.height,
        };
        if (fogGeometryContains(geometry, { x, y }))
          visible = operation.operation !== "COVER";
      }
      if (!visible) return false;
    }
  }
  return true;
}

/** Deterministic PRNG so a failure is always reproducible. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomOperation(random: () => number): FogOperation {
  const operation = random() < 0.5 ? "REVEAL" : "COVER";
  const shape = random();
  const px = () => Math.round(random() * 200);
  let geometry: FogGeometry;
  if (shape < 0.25) {
    geometry = {
      type: "RECT",
      x: px(),
      y: px(),
      width: 1 + Math.round(random() * 80),
      height: 1 + Math.round(random() * 80),
    };
  } else if (shape < 0.5) {
    geometry = {
      type: "CIRCLE",
      center: { x: px(), y: px() },
      radius: 1 + Math.round(random() * 40),
    };
  } else if (shape < 0.75) {
    geometry = {
      type: "POLYGON",
      points: [
        { x: px(), y: px() },
        { x: px(), y: px() },
        { x: px(), y: px() },
      ],
    };
  } else {
    geometry = {
      type: "BRUSH",
      points: Array.from({ length: 2 + Math.round(random() * 4) }, () => ({
        x: px(),
        y: px(),
      })),
      radius: 1 + Math.round(random() * 25),
    };
  }
  // Mirrors the server: the row's x/y/width/height columns are always
  // `fogGeometryBounds(geometry)` (see `canonicalizeFogGeometry`).
  const bounds = fogGeometryBounds(geometry);
  return { ...bounds, operation, geometry };
}

describe("player fog invariants", () => {
  const reveals = [{ x: 100, y: 200, width: 80, height: 60 }];

  it("is fully opaque for players and remains translucent for the GM", () => {
    expect(fogOpacity("PLAYER")).toBe(1);
    expect(fogOpacity("GM")).toBe(0.35);
  });

  it("reveals another token only when its complete bounds are revealed", () => {
    expect(
      isRectFullyRevealed({ x: 110, y: 210, width: 20, height: 20 }, reveals),
    ).toBe(true);
    expect(
      isRectFullyRevealed({ x: 90, y: 210, width: 20, height: 20 }, reveals),
    ).toBe(false);
    expect(
      isRectFullyRevealed({ x: 170, y: 250, width: 20, height: 20 }, reveals),
    ).toBe(false);
  });

  it("applies reveal and cover rectangles in durable order", () => {
    const token = { x: 10, y: 10, width: 10, height: 10 };
    expect(
      isRectFullyRevealed(token, [
        { x: 0, y: 0, width: 100, height: 100, operation: "REVEAL" },
        { x: 5, y: 5, width: 30, height: 30, operation: "COVER" },
      ]),
    ).toBe(false);
    expect(
      isRectFullyRevealed(token, [
        { x: 0, y: 0, width: 100, height: 100, operation: "REVEAL" },
        { x: 5, y: 5, width: 30, height: 30, operation: "COVER" },
        { x: 8, y: 8, width: 20, height: 20, operation: "REVEAL" },
      ]),
    ).toBe(true);
  });

  it("uses exact union and partial-cover geometry for hit testing", () => {
    const token = { x: 0, y: 0, width: 20, height: 20 };
    expect(
      isRectFullyRevealed(token, [
        { x: 0, y: 0, width: 10, height: 20, operation: "REVEAL" },
        { x: 10, y: 0, width: 10, height: 20, operation: "REVEAL" },
      ]),
    ).toBe(true);
    expect(
      isRectFullyRevealed(token, [
        { x: 0, y: 0, width: 20, height: 20, operation: "REVEAL" },
        { x: 5, y: 5, width: 2, height: 2, operation: "COVER" },
      ]),
    ).toBe(false);
  });

  it("evaluates CIRCLE reveal/cover geometry", () => {
    const circleReveal = {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      operation: "REVEAL" as const,
      geometry: {
        type: "CIRCLE" as const,
        center: { x: 100, y: 100 },
        radius: 50,
      },
    };
    // Fully inside the circle.
    expect(
      isRectFullyRevealed({ x: 90, y: 90, width: 20, height: 20 }, [
        circleReveal,
      ]),
    ).toBe(true);
    // Corner sticks out past the circle boundary.
    expect(
      isRectFullyRevealed({ x: 130, y: 130, width: 20, height: 20 }, [
        circleReveal,
      ]),
    ).toBe(false);
    // A COVER circle punches a hole back into an earlier full-scene reveal.
    const rectReveal = {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      operation: "REVEAL" as const,
    };
    const circleCover = {
      x: 80,
      y: 80,
      width: 40,
      height: 40,
      operation: "COVER" as const,
      geometry: {
        type: "CIRCLE" as const,
        center: { x: 100, y: 100 },
        radius: 20,
      },
    };
    expect(
      isRectFullyRevealed({ x: 95, y: 95, width: 10, height: 10 }, [
        rectReveal,
        circleCover,
      ]),
    ).toBe(false);
    expect(
      isRectFullyRevealed({ x: 5, y: 5, width: 10, height: 10 }, [
        rectReveal,
        circleCover,
      ]),
    ).toBe(true);
  });

  it("evaluates POLYGON reveal geometry", () => {
    // A triangle covering the top-left half of a 100x100 square.
    const polygonReveal = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      operation: "REVEAL" as const,
      geometry: {
        type: "POLYGON" as const,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 0, y: 100 },
        ],
      },
    };
    // Fully inside the triangle (near the right-angle corner).
    expect(
      isRectFullyRevealed({ x: 5, y: 5, width: 10, height: 10 }, [
        polygonReveal,
      ]),
    ).toBe(true);
    // Fully outside the triangle (bottom-right region).
    expect(
      isRectFullyRevealed({ x: 60, y: 60, width: 20, height: 20 }, [
        polygonReveal,
      ]),
    ).toBe(false);
  });

  it("evaluates BRUSH reveal geometry as a stroked path", () => {
    const brushReveal = {
      x: 0,
      y: 0,
      width: 220,
      height: 20,
      operation: "REVEAL" as const,
      geometry: {
        type: "BRUSH" as const,
        points: [
          { x: 0, y: 10 },
          { x: 200, y: 10 },
        ],
        radius: 10,
      },
    };
    // Under the stroke's path.
    expect(
      isRectFullyRevealed({ x: 95, y: 5, width: 10, height: 10 }, [
        brushReveal,
      ]),
    ).toBe(true);
    // Well outside the stroke radius.
    expect(
      isRectFullyRevealed({ x: 95, y: 100, width: 10, height: 10 }, [
        brushReveal,
      ]),
    ).toBe(false);
  });
});

describe("fog evaluator optimization is behaviour-preserving (UIX-395)", () => {
  it("matches the pre-optimization algorithm across randomized mixed-shape scenes", () => {
    const random = createRandom(20260809);
    let checked = 0;
    let revealedCount = 0;
    for (let scene = 0; scene < 250; scene++) {
      const reveals = Array.from(
        { length: 1 + Math.round(random() * 7) },
        () => randomOperation(random),
      );
      for (let probe = 0; probe < 4; probe++) {
        const rect = {
          x: Math.round(random() * 200),
          y: Math.round(random() * 200),
          width: 1 + Math.round(random() * 30),
          height: 1 + Math.round(random() * 30),
        };
        const expected = referenceIsRectFullyRevealed(rect, reveals);
        expect({ rect, result: isRectFullyRevealed(rect, reveals) }).toEqual({
          rect,
          result: expected,
        });
        checked++;
        if (expected) revealedCount++;
      }
    }
    expect(checked).toBe(1000);
    // Guard against a degenerate corpus that only ever exercises the
    // "nothing is revealed" path and would pass even if the optimization
    // broke the revealed case.
    expect(revealedCount).toBeGreaterThan(20);
  });

  it("still short-circuits when no operation intersects the rect", () => {
    expect(
      isRectFullyRevealed({ x: 500, y: 500, width: 10, height: 10 }, [
        { x: 0, y: 0, width: 100, height: 100, operation: "REVEAL" },
      ]),
    ).toBe(false);
    expect(isRectFullyRevealed({ x: 0, y: 0, width: 10, height: 10 }, [])).toBe(
      false,
    );
  });
});
