import { describe, expect, it, vi } from "vitest";
import {
  CURSOR_INACTIVITY_MS,
  CursorMoveBatcher,
  cursorTransitionDurationMs,
  isCursorStale,
  isTrackableCursorPointerType,
  type FrameScheduler,
} from "./cursor-broadcast";

function fakeScheduler() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const scheduler: FrameScheduler = {
    schedule: (callback) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      pending.delete(handle);
    },
  };
  return {
    scheduler,
    /** Runs every callback currently scheduled, as if a frame elapsed. */
    flushFrame: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    pendingCount: () => pending.size,
  };
}

describe("isTrackableCursorPointerType", () => {
  it("tracks mouse pointers only", () => {
    expect(isTrackableCursorPointerType("mouse")).toBe(true);
    expect(isTrackableCursorPointerType("touch")).toBe(false);
    expect(isTrackableCursorPointerType("pen")).toBe(false);
  });
});

describe("isCursorStale", () => {
  it("is not stale within the inactivity window", () => {
    expect(isCursorStale(1000, 1000 + CURSOR_INACTIVITY_MS - 1)).toBe(false);
  });

  it("is stale once the inactivity window has elapsed", () => {
    expect(isCursorStale(1000, 1000 + CURSOR_INACTIVITY_MS + 1)).toBe(true);
  });
});

describe("cursorTransitionDurationMs", () => {
  it("is zero under prefers-reduced-motion", () => {
    expect(cursorTransitionDurationMs(true)).toBe(0);
  });

  it("is a positive duration otherwise", () => {
    expect(cursorTransitionDurationMs(false)).toBeGreaterThan(0);
  });
});

describe("CursorMoveBatcher", () => {
  it("does not flush until a frame elapses", () => {
    const { scheduler, flushFrame } = fakeScheduler();
    const onFlush = vi.fn();
    const batcher = new CursorMoveBatcher(scheduler, onFlush);
    batcher.queue({ x: 1, y: 1 });
    expect(onFlush).not.toHaveBeenCalled();
    flushFrame();
    expect(onFlush).toHaveBeenCalledWith({ x: 1, y: 1 });
  });

  it("collapses multiple queue() calls within a frame into the latest payload", () => {
    const { scheduler, flushFrame } = fakeScheduler();
    const onFlush = vi.fn();
    const batcher = new CursorMoveBatcher(scheduler, onFlush);
    batcher.queue({ x: 1, y: 1 });
    batcher.queue({ x: 2, y: 2 });
    batcher.queue({ x: 3, y: 3 });
    flushFrame();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({ x: 3, y: 3 });
  });

  it("schedules a fresh frame for the next batch after a flush", () => {
    const { scheduler, flushFrame } = fakeScheduler();
    const onFlush = vi.fn();
    const batcher = new CursorMoveBatcher(scheduler, onFlush);
    batcher.queue({ x: 1, y: 1 });
    flushFrame();
    batcher.queue({ x: 2, y: 2 });
    flushFrame();
    expect(onFlush).toHaveBeenNthCalledWith(1, { x: 1, y: 1 });
    expect(onFlush).toHaveBeenNthCalledWith(2, { x: 2, y: 2 });
  });

  it("cancel() drops a pending payload without flushing it", () => {
    const { scheduler, flushFrame, pendingCount } = fakeScheduler();
    const onFlush = vi.fn();
    const batcher = new CursorMoveBatcher(scheduler, onFlush);
    batcher.queue({ x: 1, y: 1 });
    batcher.cancel();
    expect(pendingCount()).toBe(0);
    flushFrame();
    expect(onFlush).not.toHaveBeenCalled();
  });
});
