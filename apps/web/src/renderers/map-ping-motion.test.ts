import { describe, expect, it } from "vitest";
import {
  evaluateMapPing,
  mapPingIsActive,
  mapPingElapsed,
  MAP_PING_LIFETIME_MS,
} from "./map-ping-motion";

describe("map ping motion", () => {
  it.each([0, 280, 1100, 3000, 3500])(
    "keeps existing motion equations at %i ms",
    (elapsed) => {
      const geometry = evaluateMapPing(elapsed, 1, false);
      const fade = Math.max(0, 1 - elapsed / 3500);
      const phase = (elapsed % 1100) / 1100;
      expect(geometry.rings[0]!).toEqual({
        radius: 6 + phase * 40,
        strokeWidth: 2.5,
        opacity: Math.max(0, (1 - phase) * fade * 0.85),
      });
      expect(geometry.coreRadius).toBeCloseTo(
        6 + Math.sin(elapsed / 160) * 1.5,
      );
    },
  );
  it.each([0.5, 1, 2])(
    "compensates all screen-space measures at scale %s",
    (scale) => {
      const result = evaluateMapPing(280, scale, false);
      expect(result.rings[0]!.radius * scale).toBeCloseTo(
        evaluateMapPing(280, 1, false).rings[0]!.radius,
      );
      expect(result.nameFontSize * scale).toBe(13);
    },
  );
  it("uses a fixed-radius, monotonic reduced-motion fade", () => {
    const a = evaluateMapPing(0, 1, true),
      b = evaluateMapPing(200, 1, true),
      c = evaluateMapPing(500, 1, true);
    expect(a.rings[0]!.radius).toBe(b.rings[0]!.radius);
    expect(b.rings[0]!.radius).toBe(c.rings[0]!.radius);
    expect(a.coreOpacity).toBeGreaterThan(b.coreOpacity);
    expect(b.coreOpacity).toBeGreaterThan(c.coreOpacity);
    expect(c.coreOpacity).toBe(0);
  });
  it("keeps expired pings hidden on mount and later rerenders", () => {
    const createdAt = 1_000;
    expect(mapPingIsActive(createdAt, 1_000)).toBe(true);
    expect(mapPingIsActive(createdAt, 4_499)).toBe(true);
    expect(mapPingIsActive(createdAt, 4_500)).toBe(false);
    expect(mapPingIsActive(createdAt, 5_000)).toBe(false);
  });
  it("clamps invalid and delayed elapsed times without restarting old pings", () => {
    expect(mapPingElapsed(100, 50)).toBe(0);
    expect(mapPingElapsed("invalid", 500)).toBe(0);
    expect(evaluateMapPing(9000, 1, false).coreOpacity).toBe(0);
    expect(MAP_PING_LIFETIME_MS).toBe(3500);
  });
});
