import { describe, expect, it, vi } from "vitest";
import { MapMoveQueue } from "./map-move-queue";

const token = (revision = 1) => [
  { targetType: "TOKEN" as const, targetId: "t1", revision },
];
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const ack = (revision: number) => ({
  revisions: { tokens: { t1: revision }, drawings: {} },
});

describe("MapMoveQueue", () => {
  it("keeps one request in flight, coalesces repeats, and uses ack revision", async () => {
    const first = deferred<ReturnType<typeof ack>>();
    const execute = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(ack(3));
    const queue = new MapMoveQueue(execute);
    queue.reset("scene:TOKEN:t1", token());
    queue.enqueue(token(), { x: 1, y: 0 });
    queue.enqueue(token(), { x: 2, y: 0 });
    queue.enqueue(token(), { x: 3, y: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
    first.resolve(ack(2));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]![0]).toEqual({
      targets: token(2),
      delta: { x: 5, y: 1 },
    });
  });

  it("does not retry conflicts and discards queued movement", async () => {
    const first = deferred<ReturnType<typeof ack>>();
    const execute = vi.fn().mockReturnValueOnce(first.promise);
    const queue = new MapMoveQueue(execute);
    queue.reset("scene:TOKEN:t1", token());
    queue.enqueue(token(), { x: 1, y: 0 });
    queue.enqueue(token(), { x: 1, y: 0 });
    first.reject(new Error("STALE_REVISION"));
    await Promise.resolve();
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("drops pending work when scene or selection scope changes", async () => {
    const first = deferred<ReturnType<typeof ack>>();
    const execute = vi.fn().mockReturnValueOnce(first.promise);
    const queue = new MapMoveQueue(execute);
    queue.reset("scene-a:TOKEN:t1", token());
    queue.enqueue(token(), { x: 1, y: 0 });
    queue.enqueue(token(), { x: 2, y: 0 });
    queue.reset("scene-b:", []);
    first.resolve(ack(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("starts current-scope pending work after a stale in-flight request settles", async () => {
    const old = deferred<ReturnType<typeof ack>>();
    const execute = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(ack(9));
    const queue = new MapMoveQueue(execute);
    queue.reset("scene-a:TOKEN:t1", token(1));
    queue.enqueue(token(1), { x: 1, y: 0 });
    queue.reset("scene-b:TOKEN:t1", token(8));
    queue.enqueue(token(8), { x: 0, y: 4 });
    expect(execute).toHaveBeenCalledTimes(1);
    old.resolve(ack(2));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]![0]).toEqual({
      targets: token(8),
      delta: { x: 0, y: 4 },
    });
  });

  it("refreshes same-scope revisions after a terminal conflict", async () => {
    const conflicted = deferred<ReturnType<typeof ack>>();
    const execute = vi
      .fn()
      .mockReturnValueOnce(conflicted.promise)
      .mockResolvedValueOnce(ack(8));
    const queue = new MapMoveQueue(execute);
    queue.reset("scene:TOKEN:t1", token(1));
    queue.enqueue(token(1), { x: 1, y: 0 });
    queue.reset("scene:TOKEN:t1", token(7));
    conflicted.reject(new Error("STALE_REVISION"));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    queue.enqueue(token(1), { x: 2, y: 0 });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]![0].targets).toEqual(token(7));
  });

  it("refreshes same-scope revisions while idle", async () => {
    const execute = vi.fn().mockResolvedValue(ack(12));
    const queue = new MapMoveQueue(execute);
    queue.reset("scene:TOKEN:t1", token(1));
    queue.reset("scene:TOKEN:t1", token(11));
    queue.enqueue(token(1), { x: 1, y: 0 });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0]![0].targets).toEqual(token(11));
  });

  it("preserves a burst when snapshot revision arrives before the delayed ack", async () => {
    const first = deferred<ReturnType<typeof ack>>();
    const execute = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(ack(3));
    const queue = new MapMoveQueue(execute);
    const scope = "scene:TOKEN:t1";
    queue.reset(scope, token(1));
    queue.enqueue(token(1), { x: 1, y: 0 });
    queue.enqueue(token(1), { x: 2, y: 0 });
    // The socket snapshot for the first move beats its delayed HTTP response.
    queue.reset(scope, token(2));
    queue.enqueue(token(2), { x: 3, y: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
    first.resolve(ack(2));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]![0]).toEqual({
      targets: token(2),
      delta: { x: 5, y: 0 },
    });
  });
});
