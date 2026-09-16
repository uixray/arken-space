import { describe, expect, it, vi } from "vitest";
import { MapMoveQueue, type MapMoveRequest } from "./map-move-queue";

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
    expect(execute.mock.calls[1]![0]).toEqual(
      expect.objectContaining({
        targets: token(2),
        delta: { x: 5, y: 1 },
      }),
    );
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

  it("reports a terminal failure exactly once with the failed request", async () => {
    const reason = new Error("STALE_REVISION");
    const onFailure = vi.fn();
    const queue = new MapMoveQueue(
      vi.fn().mockRejectedValue(reason),
      onFailure,
    );
    queue.reset("scene:TOKEN:t1", token());
    queue.enqueue(token(), { x: 3, y: 4 });
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1));
    expect(onFailure).toHaveBeenCalledWith(
      reason,
      expect.objectContaining({
        targets: token(),
        delta: { x: 3, y: 4 },
      }),
    );
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
    expect(execute.mock.calls[1]![0]).toEqual(
      expect.objectContaining({
        targets: token(8),
        delta: { x: 0, y: 4 },
      }),
    );
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
    expect(execute.mock.calls[1]![0]).toEqual(
      expect.objectContaining({
        targets: token(2),
        delta: { x: 5, y: 0 },
      }),
    );
  });
  it("previews queued moves immediately and rehydrates the pending baseline", async () => {
    const first = deferred<ReturnType<typeof ack>>();
    const previews: MapMoveRequest[] = [];
    const execute = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(ack(3));
    const queue = new MapMoveQueue(execute, undefined, (request) =>
      previews.push(request),
    );
    queue.reset("scene:TOKEN:t1", token());
    queue.enqueue(token(), { x: 64, y: 0 });
    queue.enqueue(token(), { x: 64, y: 0 });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(previews).toHaveLength(2);
    expect(previews[0]?.delta).toEqual({ x: 64, y: 0 });
    expect(previews[1]?.delta).toEqual({ x: 64, y: 0 });
    expect(previews[1]?.intentId).not.toBe(previews[0]?.intentId);

    first.resolve(ack(2));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(previews.at(-1)?.targets).toEqual(token(2));
    expect(execute.mock.calls[1]?.[0].targets).toEqual(token(2));
  });

  it("discards an unsent optimistic request when the selection scope changes", () => {
    const first = deferred<ReturnType<typeof ack>>();
    const discarded = vi.fn();
    const queue = new MapMoveQueue(
      vi.fn().mockReturnValueOnce(first.promise),
      undefined,
      undefined,
      discarded,
    );
    queue.reset("scene:TOKEN:t1", token());
    queue.enqueue(token(), { x: 1, y: 0 });
    queue.enqueue(token(), { x: 2, y: 0 });
    queue.reset("scene:TOKEN:t2", [
      { targetType: "TOKEN", targetId: "t2", revision: 1 },
    ]);
    expect(discarded).toHaveBeenCalledWith([expect.any(String)]);
  });
});
