import { describe, expect, it } from "vitest";
import { fogOpacity, isRectFullyRevealed } from "./fog";

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
