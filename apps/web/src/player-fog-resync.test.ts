import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPlayerFogResync } from "./player-fog-resync";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("batches a burst, allows one in flight, then one tail for uncovered edits", () => {
  const send = vi.fn();
  const fog = createPlayerFogResync(send);
  fog.request("A", 12);
  vi.advanceTimersByTime(100);
  fog.request("A", 12);
  fog.request("A", 14);
  vi.advanceTimersByTime(25);
  expect(send.mock.calls).toEqual([[14]]);
  fog.request("A", 15);
  fog.request("A", 16);
  fog.snapshot("A", 13);
  fog.snapshot("B", 99);
  vi.advanceTimersByTime(1000);
  expect(send.mock.calls).toEqual([[14]]);
  fog.snapshot("A", 14);
  fog.snapshot("A", 14);
  vi.advanceTimersByTime(125);
  expect(send.mock.calls).toEqual([[14], [16]]);
  fog.snapshot("A", 17);
  vi.advanceTimersByTime(1000);
  expect(send).toHaveBeenCalledTimes(2);
});

it("suppresses requests already covered by a canonical snapshot", () => {
  const send = vi.fn();
  const fog = createPlayerFogResync(send);
  fog.request("A", 7);
  fog.snapshot("A", 7);
  vi.advanceTimersByTime(250);
  expect(send).not.toHaveBeenCalled();
});

it("discards stale-scene and disconnected/unmounted work, including in-flight tails", () => {
  const send = vi.fn();
  const fog = createPlayerFogResync(send);
  fog.request("A", 3);
  fog.scope("B");
  vi.advanceTimersByTime(150);
  expect(send).not.toHaveBeenCalled();
  fog.request("B", 4);
  vi.advanceTimersByTime(125);
  fog.request("B", 5);
  fog.reset();
  fog.snapshot("B", 4);
  vi.advanceTimersByTime(150);
  expect(send.mock.calls).toEqual([[4]]);
  fog.request("C", 6);
  fog.scope("C");
  vi.advanceTimersByTime(125);
  expect(send.mock.calls).toEqual([[4], [6]]);
});

it("retries a missing ACK only once, then a later dirty event can start again", () => {
  const send = vi.fn();
  const fog = createPlayerFogResync(send);
  fog.request("A", 21);
  vi.advanceTimersByTime(125);
  vi.advanceTimersByTime(5000);
  expect(send.mock.calls).toEqual([[21]]);
  vi.advanceTimersByTime(125);
  expect(send.mock.calls).toEqual([[21], [21]]);
  vi.advanceTimersByTime(30000);
  expect(send).toHaveBeenCalledTimes(2);
  fog.request("A", 22);
  vi.advanceTimersByTime(125);
  expect(send.mock.calls).toEqual([[21], [21], [22]]);
  fog.snapshot("A", 22);
  vi.advanceTimersByTime(30000);
  expect(send).toHaveBeenCalledTimes(3);
});

it("a timed-out in-flight edit yields to its latest tail, never to a stale scene", () => {
  const send = vi.fn();
  const fog = createPlayerFogResync(send);
  fog.request("A", 1);
  vi.advanceTimersByTime(125);
  fog.request("A", 2);
  vi.advanceTimersByTime(5125);
  expect(send.mock.calls).toEqual([[1], [2]]);
  fog.scope("B");
  vi.advanceTimersByTime(30000);
  expect(send).toHaveBeenCalledTimes(2);
  fog.request("B", 3);
  vi.advanceTimersByTime(125);
  vi.advanceTimersByTime(5000);
  fog.reset();
  vi.advanceTimersByTime(30000);
  expect(send.mock.calls).toEqual([[1], [2], [3]]);
});
