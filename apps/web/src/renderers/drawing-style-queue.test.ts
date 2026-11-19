import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDrawingStyleQueue,
  type DrawingStylePatch,
} from "./drawing-style-queue";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const setup = (
  save: (
    id: string,
    revision: number,
    patch: DrawingStylePatch,
  ) => Promise<void> = vi.fn(async () => {}),
) => {
  const onPending = vi.fn(),
    onError = vi.fn();
  return {
    queue: createDrawingStyleQueue({ save, onPending, onError }),
    save,
    onPending,
    onError,
  };
};
describe("drawing style intent queue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("coalesces width and color into one revision-checked PATCH", async () => {
    const { queue, save } = setup();
    queue.enqueue("a", 3, { strokeWidth: 10 });
    await vi.advanceTimersByTimeAsync(150);
    queue.enqueue("a", 3, { color: "#ef4444" });
    await vi.advanceTimersByTimeAsync(199);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith("a", 3, {
      strokeWidth: 10,
      color: "#ef4444",
    });
  });
  it("keeps the last intent independently for each field", async () => {
    const { queue, save, onPending } = setup();
    queue.enqueue("a", 0, { color: "red", strokeWidth: 4 });
    queue.enqueue("a", 0, { strokeWidth: 29 });
    queue.enqueue("a", 0, { color: "blue" });
    expect(onPending).toHaveBeenLastCalledWith("a", {
      color: "blue",
      strokeWidth: 29,
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledExactlyOnceWith("a", 0, {
      color: "blue",
      strokeWidth: 29,
    });
    expect(onPending).toHaveBeenLastCalledWith("a", null);
  });
  it("serializes gestures during a slow save using its acknowledged revision", async () => {
    const first = deferred(),
      save = vi.fn(async () => {}).mockImplementationOnce(() => first.promise);
    const { queue } = setup(save);
    queue.enqueue("a", 4, { strokeWidth: 8 });
    await vi.advanceTimersByTimeAsync(200);
    queue.enqueue("a", 4, { color: "red" });
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenNthCalledWith(2, "a", 5, { color: "red" });
  });
  it("does not flush a newer gesture before its own debounce expires", async () => {
    const first = deferred(),
      save = vi.fn(async () => {}).mockImplementationOnce(() => first.promise);
    const { queue } = setup(save);
    queue.enqueue("a", 1, { strokeWidth: 8 });
    await vi.advanceTimersByTimeAsync(200);
    queue.enqueue("a", 1, { color: "red" });
    await vi.advanceTimersByTimeAsync(50);
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(save).toHaveBeenNthCalledWith(2, "a", 2, { color: "red" });
  });
  it("does not regress to stale props after its own save resolves", async () => {
    const { queue, save } = setup();
    queue.enqueue("a", 7, { strokeWidth: 8 });
    await vi.advanceTimersByTimeAsync(200);
    queue.enqueue("a", 7, { color: "red" });
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenNthCalledWith(2, "a", 8, { color: "red" });
  });
  it("accepts a newer displayed revision for a new idle gesture", async () => {
    const { queue, save } = setup();
    queue.enqueue("a", 7, { strokeWidth: 8 });
    await vi.advanceTimersByTimeAsync(200);
    queue.enqueue("a", 12, { color: "red" });
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenNthCalledWith(2, "a", 12, { color: "red" });
  });
  it("does not silently rebase an already pending intent over a foreign update", async () => {
    const { queue, save } = setup();
    queue.enqueue("a", 7, { strokeWidth: 8 });
    queue.enqueue("a", 12, { color: "red" });
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledExactlyOnceWith("a", 7, {
      strokeWidth: 8,
      color: "red",
    });
  });
  it("keeps targets independent when selection changes before the timer fires", async () => {
    const { queue, save } = setup();
    queue.enqueue("a", 1, { strokeWidth: 8 });
    queue.enqueue("b", 9, { color: "red" });
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledWith("a", 1, { strokeWidth: 8 });
    expect(save).toHaveBeenCalledWith("b", 9, { color: "red" });
  });
  it("reports failure once, drops unsafe queued work and never auto-retries", async () => {
    const first = deferred(),
      save = vi.fn(async () => {}).mockImplementationOnce(() => first.promise);
    const { queue, onError, onPending } = setup(save);
    queue.enqueue("a", 1, { strokeWidth: 8 });
    await vi.advanceTimersByTimeAsync(200);
    queue.enqueue("a", 1, { color: "red" });
    const error = new Error("409 DRAWING_CONFLICT");
    first.reject(error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(onPending).toHaveBeenLastCalledWith("a", null);
    queue.enqueue("a", 6, { color: "blue" });
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenNthCalledWith(2, "a", 6, { color: "blue" });
  });
  it("retains in-flight optimistic fields while merging newer intent", async () => {
    const first = deferred();
    const { queue, onPending } = setup(vi.fn(() => first.promise));
    queue.enqueue("a", 1, { strokeWidth: 8 });
    await vi.advanceTimersByTimeAsync(200);
    queue.enqueue("a", 1, { color: "red" });
    expect(onPending).toHaveBeenLastCalledWith("a", {
      strokeWidth: 8,
      color: "red",
    });
    queue.dispose();
    first.resolve();
  });
  it("cancels unsent work on scope disposal", async () => {
    const { queue, save } = setup();
    queue.enqueue("a", 1, { strokeWidth: 8 });
    queue.dispose();
    queue.enqueue("b", 1, { color: "red" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });
  it("does not publish or save queued work after an in-flight scope is disposed", async () => {
    const first = deferred();
    const { queue, save, onPending, onError } = setup(
      vi.fn(() => first.promise),
    );
    queue.enqueue("a", 1, { strokeWidth: 8 });
    await vi.advanceTimersByTimeAsync(200);
    queue.enqueue("a", 1, { color: "red" });
    queue.dispose();
    onPending.mockClear();
    first.reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onPending).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
