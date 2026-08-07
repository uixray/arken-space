import { describe, expect, it } from "vitest";
import { transferRelativePosition } from "./encounter-transform.js";

describe("transferRelativePosition", () => {
  it("is the identity transform when source and destination bounds match", () => {
    const source = { width: 1000, height: 800 };
    expect(
      transferRelativePosition(source, source, { x: 300, y: 480 }),
    ).toEqual({ x: 300, y: 480 });
  });

  it("scales up proportionally onto a larger destination", () => {
    const source = { width: 1000, height: 1000 };
    const destination = { width: 2000, height: 2000 };
    expect(
      transferRelativePosition(source, destination, { x: 300, y: 600 }),
    ).toEqual({ x: 600, y: 1200 });
  });

  it("scales down proportionally onto a smaller destination", () => {
    const source = { width: 2000, height: 2000 };
    const destination = { width: 500, height: 500 };
    expect(
      transferRelativePosition(source, destination, { x: 1000, y: 1500 }),
    ).toEqual({ x: 250, y: 375 });
  });

  it("preserves independent fractions across non-square source and destination scenes", () => {
    // 30%-across, 60%-down on a 1200x400 source lands at the same fractions
    // on a 400x1200 destination.
    const source = { width: 1200, height: 400 };
    const destination = { width: 400, height: 1200 };
    const result = transferRelativePosition(source, destination, {
      x: 360, // 30% of 1200
      y: 240, // 60% of 400
    });
    expect(result.x).toBeCloseTo(120); // 30% of 400
    expect(result.y).toBeCloseTo(720); // 60% of 1200
  });

  it("maps the top-left corner to the top-left corner", () => {
    const source = { width: 1000, height: 800 };
    const destination = { width: 300, height: 900 };
    expect(
      transferRelativePosition(source, destination, { x: 0, y: 0 }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("maps the bottom-right corner to the bottom-right corner", () => {
    const source = { width: 1000, height: 800 };
    const destination = { width: 300, height: 900 };
    const result = transferRelativePosition(source, destination, {
      x: 1000,
      y: 800,
    });
    expect(result.x).toBeCloseTo(300);
    expect(result.y).toBeCloseTo(900);
  });

  it("maps an off-center point (not on an axis or the diagonal)", () => {
    const source = { width: 1600, height: 900 };
    const destination = { width: 800, height: 1400 };
    // 25%-across, 75%-down
    const result = transferRelativePosition(source, destination, {
      x: 400,
      y: 675,
    });
    expect(result.x).toBeCloseTo(200); // 25% of 800
    expect(result.y).toBeCloseTo(1050); // 75% of 1400
  });

  it("is total: degenerate zero-sized source dimensions do not produce NaN", () => {
    const source = { width: 0, height: 0 };
    const destination = { width: 500, height: 500 };
    expect(
      transferRelativePosition(source, destination, { x: 10, y: 10 }),
    ).toEqual({ x: 0, y: 0 });
  });
});
