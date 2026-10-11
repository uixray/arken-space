import { describe, expect, it, vi } from "vitest";
import {
  createMapPingAnimationDriver,
  MAP_PING_LIFETIME_MS,
  mapPingElapsed,
  subscribeReducedMotion,
} from "./map-ping-motion";

function fakeDriver(options: {
  durationMs?: number;
  startTime?: number;
  now: () => number;
  apply: (elapsed: number) => void;
}) {
  const loop = { start: vi.fn(), stop: vi.fn() };
  const driver = createMapPingAnimationDriver({
    startTime: options.startTime ?? 0,
    durationMs: options.durationMs ?? MAP_PING_LIFETIME_MS,
    now: options.now,
    apply: options.apply,
    loop,
  });
  return { driver, loop };
}

describe("map ping imperative animation lifecycle", () => {
  it("keeps eight independent ping drivers running and completes only the expired instance", () => {
    let now = 100;
    const frames = Array.from({ length: 8 }, () => vi.fn());
    const drivers = frames.map((apply) =>
      fakeDriver({ now: () => now, startTime: 100, apply }),
    );
    for (const item of drivers) item.driver.start();
    expect(drivers.map((item) => item.loop.start)).toHaveLength(8);
    expect(drivers.every((item) => item.driver.tick())).toBe(true);
    expect(frames.every((apply) => apply.mock.calls.length === 1)).toBe(true);
    now = MAP_PING_LIFETIME_MS + 100;
    expect(drivers[0]!.driver.tick()).toBe(false);
    expect(drivers[0]!.loop.stop).toHaveBeenCalledTimes(1);
    expect(drivers[0]!.driver.active).toBe(false);
    expect(drivers.slice(1).every((item) => item.driver.active)).toBe(true);
    expect(drivers[1]!.driver.tick()).toBe(false);
    expect(drivers[1]!.loop.stop).toHaveBeenCalledTimes(1);
  });

  it("stops on unmount and never applies another frame", () => {
    let now = 10;
    const apply = vi.fn();
    const { driver, loop } = fakeDriver({
      now: () => now,
      startTime: 0,
      apply,
    });
    driver.start();
    expect(driver.tick()).toBe(true);
    driver.stop();
    now += 100;
    expect(driver.tick()).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(loop.stop).toHaveBeenCalledTimes(1);
  });

  it("expires old timestamps without creating a fresh animation", () => {
    const now = 5000;
    const elapsed = mapPingElapsed(100, now);
    const apply = vi.fn();
    const { driver, loop } = fakeDriver({
      now: () => now,
      startTime: 100,
      apply,
    });
    if (elapsed < MAP_PING_LIFETIME_MS) driver.start();
    expect(elapsed).toBeGreaterThanOrEqual(MAP_PING_LIFETIME_MS);
    expect(loop.start).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("ends calm reduced-motion animation after its short fade window", () => {
    let now = 0;
    const apply = vi.fn();
    const { driver, loop } = fakeDriver({
      durationMs: 500,
      now: () => now,
      apply,
    });
    driver.start();
    now = 499;
    expect(driver.tick()).toBe(true);
    now = 500;
    expect(driver.tick()).toBe(false);
    expect(loop.stop).toHaveBeenCalledTimes(1);
  });

  it("subscribes and unsubscribes preference changes without leaking listeners", () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    let reduced = false;
    const addEventListener = vi.fn(
      (_type: string, callback: (event: MediaQueryListEvent) => void) => {
        listener = callback;
      },
    );
    const removeEventListener = vi.fn();
    const query = {
      get matches() {
        return reduced;
      },
      addEventListener,
      removeEventListener,
    } as unknown as MediaQueryList;
    const matchMedia = vi.fn(() => query);
    const updates: boolean[] = [];
    const cleanup = subscribeReducedMotion(
      (value) => updates.push(value),
      matchMedia,
    );
    reduced = true;
    listener?.({} as MediaQueryListEvent);
    cleanup();
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([false, true]);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });
});
