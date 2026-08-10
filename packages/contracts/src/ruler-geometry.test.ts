import { describe, expect, it } from "vitest";
import {
  RULER_MAX_POINTS,
  rulerPolylineDistance,
  rulerUpdateSchema,
} from "./ruler-geometry.js";

describe("ruler geometry (UIX-381)", () => {
  describe("rulerPolylineDistance", () => {
    it("matches the old single-segment distance (back-compat)", () => {
      // 3-4-5 triangle, grid disabled (gridSize=1).
      expect(
        rulerPolylineDistance(
          [
            { x: 0, y: 0 },
            { x: 30, y: 40 },
          ],
          1,
        ),
      ).toBe(50);
    });

    it("divides by grid size when grid is enabled", () => {
      expect(
        rulerPolylineDistance(
          [
            { x: 0, y: 0 },
            { x: 30, y: 40 },
          ],
          10,
        ),
      ).toBe(5);
    });

    it("sums distance across every leg of a multi-segment route", () => {
      const total = rulerPolylineDistance(
        [
          { x: 0, y: 0 },
          { x: 30, y: 40 }, // +50
          { x: 30, y: 40 + 3 }, // +3
          { x: 34, y: 43 }, // +4 (3-4-5)
        ],
        1,
      );
      expect(total).toBeCloseTo(57, 10);
    });

    it("returns 0 for a degenerate polyline with coincident points", () => {
      expect(
        rulerPolylineDistance(
          [
            { x: 5, y: 5 },
            { x: 5, y: 5 },
          ],
          1,
        ),
      ).toBe(0);
    });
  });

  describe("rulerUpdateSchema", () => {
    const sceneId = "11111111-1111-1111-1111-111111111111";

    it("accepts the single-segment case (back-compat)", () => {
      const result = rulerUpdateSchema.safeParse({
        sceneId,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("accepts a multi-segment polyline", () => {
      const result = rulerUpdateSchema.safeParse({
        sceneId,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 0 },
          { x: 30, y: 15 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects fewer than 2 points", () => {
      expect(
        rulerUpdateSchema.safeParse({ sceneId, points: [{ x: 0, y: 0 }] })
          .success,
      ).toBe(false);
      expect(
        rulerUpdateSchema.safeParse({ sceneId, points: [] }).success,
      ).toBe(false);
    });

    it("rejects non-finite coordinates", () => {
      expect(
        rulerUpdateSchema.safeParse({
          sceneId,
          points: [
            { x: 0, y: 0 },
            { x: Infinity, y: 10 },
          ],
        }).success,
      ).toBe(false);
      expect(
        rulerUpdateSchema.safeParse({
          sceneId,
          points: [
            { x: 0, y: 0 },
            { x: NaN, y: 10 },
          ],
        }).success,
      ).toBe(false);
    });

    it("rejects a point count over the cap", () => {
      const points = Array.from({ length: RULER_MAX_POINTS + 1 }, (_, i) => ({
        x: i,
        y: i,
      }));
      expect(rulerUpdateSchema.safeParse({ sceneId, points }).success).toBe(
        false,
      );
    });

    it("accepts exactly the cap", () => {
      const points = Array.from({ length: RULER_MAX_POINTS }, (_, i) => ({
        x: i,
        y: i,
      }));
      expect(rulerUpdateSchema.safeParse({ sceneId, points }).success).toBe(
        true,
      );
    });
  });
});
