import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ sendClientEventNow: vi.fn(async () => true) }));
import { sendClientEventNow } from "./api";
import { installPerformanceReporting } from "./performance-reporting";
import { setPerformanceSession } from "./performance-session";

let visibility = "visible";
let visibilityListener: (() => void) | undefined;
let cleanup: (() => void) | undefined;
class MockObserver {
  static supportedEntryTypes = ["longtask", "event"];
  static instances: MockObserver[] = [];
  options?: PerformanceObserverInit;
  disconnected = false;
  constructor(
    readonly callback: (list: { getEntries(): PerformanceEntry[] }) => void,
  ) {
    MockObserver.instances.push(this);
  }
  observe(options: PerformanceObserverInit) {
    this.options = options;
  }
  disconnect() {
    this.disconnected = true;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.mocked(sendClientEventNow).mockReset().mockResolvedValue(true);
  MockObserver.instances = [];
  MockObserver.supportedEntryTypes = ["longtask", "event"];
  visibility = "visible";
  vi.stubGlobal("document", {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_: string, listener: () => void) => {
      visibilityListener = listener;
    },
    removeEventListener: () => {
      visibilityListener = undefined;
    },
  });
  vi.stubGlobal("PerformanceObserver", MockObserver);
  setPerformanceSession(undefined);
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  setPerformanceSession(undefined);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("gameplay performance heartbeat", () => {
  it("is silent before authentication, sends first heartbeat within a minute then every five minutes", async () => {
    cleanup = installPerformanceReporting({ now: Date.now });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendClientEventNow).not.toHaveBeenCalled();
    setPerformanceSession("campaign:member");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendClientEventNow).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendClientEventNow).mock.calls[0]?.[0]).toMatchObject({
      event: "client.performance.heartbeat",
      context: {
        windowMs: 60_000,
        longTasks: 0,
        longTaskObserver: "active",
        sequence: 1,
      },
    });
    await vi.advanceTimersByTimeAsync(240_000);
    expect(sendClientEventNow).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendClientEventNow).toHaveBeenCalledTimes(2);
  });
  it("resets hidden windows, disconnects on logout and changes anonymous ID for another membership", async () => {
    setPerformanceSession("first");
    cleanup = installPerformanceReporting({ now: Date.now });
    await vi.advanceTimersByTimeAsync(60_000);
    const firstId =
      vi.mocked(sendClientEventNow).mock.calls[0]?.[0].context?.sessionId;
    visibility = "hidden";
    visibilityListener?.();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(sendClientEventNow).toHaveBeenCalledTimes(1);
    expect(
      MockObserver.instances.every((observer) => observer.disconnected),
    ).toBe(true);
    visibility = "visible";
    visibilityListener?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(
      vi.mocked(sendClientEventNow).mock.calls.at(-1)?.[0].context?.windowMs,
    ).toBe(60_000);
    setPerformanceSession(undefined);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendClientEventNow).toHaveBeenCalledTimes(2);
    setPerformanceSession("second");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(
      vi.mocked(sendClientEventNow).mock.calls.at(-1)?.[0].context?.sessionId,
    ).not.toBe(firstId);
    expect(
      MockObserver.instances.every(
        (observer) => observer.options?.buffered === false,
      ),
    ).toBe(true);
  });
  it("still heartbeats with unsupported observers and reports failed sends", async () => {
    MockObserver.supportedEntryTypes = [];
    vi.mocked(sendClientEventNow).mockResolvedValueOnce(false);
    setPerformanceSession("first");
    cleanup = installPerformanceReporting({ now: Date.now });
    await vi.advanceTimersByTimeAsync(360_000);
    expect(vi.mocked(sendClientEventNow).mock.calls.at(-1)?.[0]).toMatchObject({
      context: {
        longTaskObserver: "unsupported",
        interactionObserver: "unsupported",
        sendFailures: 1,
        sequence: 2,
      },
    });
  });
  it("replaces the minute report with a heartbeat when due instead of doubling requests", async () => {
    setPerformanceSession("first");
    cleanup = installPerformanceReporting({ now: Date.now });
    const observer = MockObserver.instances.find(
      (item) => item.options?.type === "longtask",
    )!;
    observer.callback({
      getEntries: () => [{ duration: 400 } as PerformanceEntry],
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendClientEventNow).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendClientEventNow).mock.calls[0]?.[0]).toMatchObject({
      event: "client.performance.heartbeat",
      context: { blockingMs: 350 },
    });
  });
});
