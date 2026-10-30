// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, fireEvent, renderComponent } from "../test-support/render";
import { OutcomeFrame } from "./OutcomeFrame";

const success = {
  setKey: "ARKEN_CRITICAL_V1",
  frameKey: "critical-success",
} as const;
const failure = {
  setKey: "ARKEN_CRITICAL_V1",
  frameKey: "critical-failure",
} as const;

class ControlledIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  disconnected = false;
  readonly targets = new Set<Element>();
  lastTarget: Element | null = null;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {}

  observe(target: Element) {
    this.targets.add(target);
    this.lastTarget = target;
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.disconnected = true;
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
  emit(intersecting: boolean, ratio = intersecting ? 1 : 0) {
    const entries = [...this.targets].map(
      (target) =>
        ({
          target,
          isIntersecting: intersecting,
          intersectionRatio: ratio,
          time: performance.now(),
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRect: target.getBoundingClientRect(),
          rootBounds: null,
        }) as IntersectionObserverEntry,
    );
    this.callback(entries, this);
  }
  emitStale(intersecting: boolean) {
    if (!this.lastTarget) return;
    this.callback(
      [
        {
          target: this.lastTarget,
          isIntersecting: intersecting,
          intersectionRatio: intersecting ? 1 : 0,
          time: performance.now(),
          boundingClientRect: this.lastTarget.getBoundingClientRect(),
          intersectionRect: this.lastTarget.getBoundingClientRect(),
          rootBounds: null,
        } as IntersectionObserverEntry,
      ],
      this,
    );
  }
}

let observers: ControlledIntersectionObserver[] = [];
let mediaMatches = false;
let mediaListeners = new Set<(event: MediaQueryListEvent) => void>();
let now = 0;

function advance(ms: number) {
  act(() => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
}

function installMotionApis(legacyMediaListeners = false) {
  observers = [];
  mediaListeners = new Set();
  const media = {
    matches: mediaMatches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: legacyMediaListeners
      ? undefined
      : (_: string, listener: (event: MediaQueryListEvent) => void) =>
          mediaListeners.add(listener),
    removeEventListener: legacyMediaListeners
      ? undefined
      : (_: string, listener: (event: MediaQueryListEvent) => void) =>
          mediaListeners.delete(listener),
    addListener: (listener: (event: MediaQueryListEvent) => void) =>
      mediaListeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) =>
      mediaListeners.delete(listener),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class extends ControlledIntersectionObserver {
      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        super(callback, options);
        observers.push(this);
      }
    },
  );
  return {
    changeReduced(value: boolean) {
      mediaMatches = value;
      Object.defineProperty(media, "matches", { configurable: true, value });
      const event = { matches: value } as MediaQueryListEvent;
      act(() => {
        for (const listener of [...mediaListeners]) listener(event);
      });
    },
  };
}

function criticalProps(
  frame: typeof success | typeof failure = success,
  active = true,
) {
  return { frame, active };
}

async function intersect(visible = true, ratio?: number) {
  await act(async () => observers.at(-1)?.emit(visible, ratio));
}

function image(container: HTMLElement) {
  return container.querySelector<HTMLImageElement>(".outcome-frame img");
}

function captureImageCallbacks(node: HTMLImageElement) {
  const propsKey = Object.keys(node).find((key) =>
    key.startsWith("__reactProps$"),
  );
  if (!propsKey) throw new Error("React image event props were not attached");
  const props = (node as unknown as Record<string, unknown>)[propsKey];
  if (typeof props !== "object" || props === null)
    throw new Error("React image event props were not an object");
  const onLoad = Reflect.get(props, "onLoad");
  const onError = Reflect.get(props, "onError");
  if (typeof onLoad !== "function" || typeof onError !== "function")
    throw new Error("React image load/error callbacks were not callable");
  return { onLoad: onLoad as () => void, onError: onError as () => void };
}

beforeEach(() => {
  vi.useFakeTimers();
  now = 0;
  vi.spyOn(window.performance, "now").mockImplementation(() => now);
  mediaMatches = false;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UIX-289 bundled critical-frame lifecycle", () => {
  it("mounts only the active intersecting source; zero ratio and inactive stay static", async () => {
    installMotionApis();
    const { container, rerender } = renderComponent(
      <OutcomeFrame {...criticalProps(success, false)} />,
    );
    expect(image(container)).toBeNull();
    rerender(<OutcomeFrame {...criticalProps(success, true)} />);
    expect(image(container)).toBeNull();
    await intersect(true, 0);
    expect(image(container)).toBeNull();
    await intersect();
    expect(image(container)?.getAttribute("src")).toBe(
      "/assets/frames/critical-success.png",
    );
    rerender(<OutcomeFrame {...criticalProps(success, false)} />);
    expect(image(container)).toBeNull();
  });

  it("fails closed for reduced motion and missing observer/media APIs", async () => {
    const apis = installMotionApis();
    apis.changeReduced(true);
    const reduced = renderComponent(<OutcomeFrame {...criticalProps()} />);
    await intersect();
    expect(image(reduced.container)).toBeNull();
    reduced.unmount();

    apis.changeReduced(false);
    vi.stubGlobal("IntersectionObserver", undefined);
    const unsupportedObserver = renderComponent(
      <OutcomeFrame {...criticalProps()} />,
    );
    expect(image(unsupportedObserver.container)).toBeNull();
    unsupportedObserver.unmount();

    vi.stubGlobal("IntersectionObserver", ControlledIntersectionObserver);
    vi.stubGlobal("matchMedia", undefined);
    const unsupportedMedia = renderComponent(
      <OutcomeFrame {...criticalProps()} />,
    );
    expect(image(unsupportedMedia.container)).toBeNull();
  });

  it("starts the 2200ms budget only after load and charges only eligible intervals", async () => {
    installMotionApis();
    const { container } = renderComponent(
      <OutcomeFrame {...criticalProps()} />,
    );
    await intersect();
    const pending = image(container)!;
    advance(900);
    await intersect(false);
    advance(3000);
    await intersect();
    const firstPlayback = image(container)!;
    fireEvent.load(firstPlayback);
    advance(700);
    await intersect(false);
    expect(image(container)).toBeNull();
    advance(4000);
    await intersect();
    const resumed = image(container)!;
    advance(5000);
    expect(image(container)).toBe(resumed);
    fireEvent.load(resumed);
    advance(1499);
    expect(image(container)).not.toBeNull();
    advance(1);
    expect(image(container)).toBeNull();
    expect(pending).not.toBe(resumed);
  });

  it("publishes exhaustion when pause cleanup reaches zero before timer delivery", async () => {
    installMotionApis();
    const { container } = renderComponent(
      <OutcomeFrame {...criticalProps()} />,
    );
    await intersect();
    fireEvent.load(image(container)!);
    expect(vi.getTimerCount()).toBe(1);

    // Move the monotonic clock without delivering its queued deadline callback.
    now = 2200;
    await intersect(false);
    expect(image(container)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    await intersect();
    expect(image(container)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not replenish on duplicate load, duplicate IO, or same-props rerender", async () => {
    installMotionApis();
    const { container, rerender } = renderComponent(
      <OutcomeFrame {...criticalProps()} />,
    );
    await intersect();
    const current = image(container)!;
    fireEvent.load(current);
    fireEvent.load(current);
    advance(1800);
    await intersect();
    rerender(<OutcomeFrame {...criticalProps()} />);
    advance(399);
    expect(image(container)).not.toBeNull();
    advance(1);
    expect(image(container)).toBeNull();
  });

  it("rearms an early fractional timeout and exhausts once without replenishing", async () => {
    installMotionApis();
    const scheduled: Array<{
      callback: () => void;
      id: number;
      delay: number;
    }> = [];
    const originalSetTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const id = originalSetTimeout(handler, timeout, ...args);
      if (typeof handler === "function" && (timeout ?? 0) > 0)
        scheduled.push({
          callback: handler as () => void,
          id: id as number,
          delay: timeout ?? 0,
        });
      return id;
    }) as typeof window.setTimeout);
    const { container } = renderComponent(
      <OutcomeFrame {...criticalProps()} />,
    );
    await intersect();
    const first = image(container)!;
    fireEvent.load(first);
    advance(1000.25);
    await intersect(false);
    await intersect();
    const resumed = image(container)!;
    fireEvent.load(resumed);
    const armed = scheduled.at(-1)!;
    expect(armed.delay).toBeCloseTo(1199.75, 5);
    advance(1199.5);
    expect(image(container)).not.toBeNull();
    act(() => {
      window.clearTimeout(armed.id);
      armed.callback();
    });
    expect(image(container)).not.toBeNull();
    const rearmed = scheduled.at(-1)!;
    expect(rearmed).not.toBe(armed);
    expect(rearmed.delay).toBeCloseTo(0.25, 5);
    advance(0.25);
    expect(image(container)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans observers, media listeners and playback on StrictMode replay and final unmount", async () => {
    installMotionApis();
    const { container, unmount } = renderComponent(
      <StrictMode>
        <OutcomeFrame {...criticalProps()} />
      </StrictMode>,
    );
    await intersect();
    fireEvent.load(image(container)!);
    expect(mediaListeners.size).toBe(1);
    unmount();
    expect(observers.every((observer) => observer.disconnected)).toBe(true);
    expect(mediaListeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(container.querySelector(".outcome-frame")).toBeNull();

    const pending = renderComponent(
      <StrictMode>
        <OutcomeFrame {...criticalProps()} />
      </StrictMode>,
    );
    await intersect();
    expect(image(pending.container)).not.toBeNull();
    pending.unmount();
    expect(observers.every((observer) => observer.disconnected)).toBe(true);
    expect(mediaListeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses and removes legacy media-query listeners when modern events are unavailable", () => {
    installMotionApis(true);
    const { unmount } = renderComponent(<OutcomeFrame {...criticalProps()} />);
    expect(mediaListeners.size).toBe(1);
    unmount();
    expect(mediaListeners.size).toBe(0);
  });

  it("ignores a cancelled image timer and late old-node events after resume", async () => {
    installMotionApis();
    const callbacks: Array<() => void> = [];
    const originalSetTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const timer = originalSetTimeout(handler, timeout, ...args);
      if (typeof handler === "function" && (timeout ?? 0) >= 1000)
        callbacks.push(handler as () => void);
      return timer;
    }) as typeof window.setTimeout);
    const { container } = renderComponent(
      <OutcomeFrame {...criticalProps()} />,
    );
    await intersect();
    const oldImage = image(container)!;
    const oldCallbacks = captureImageCallbacks(oldImage);
    fireEvent.load(oldImage);
    advance(400);
    await intersect(false);
    expect(image(container)).toBeNull();
    await intersect();
    const current = image(container)!;
    fireEvent.load(current);
    expect(callbacks).toHaveLength(2);
    act(() => callbacks[0]!());
    act(() => {
      oldCallbacks.onError();
      oldCallbacks.onLoad();
    });
    expect(image(container)).toBe(current);
    advance(1799);
    expect(image(container)).toBe(current);
    advance(1);
    expect(image(container)).toBeNull();
  });

  it("suspends on reduced motion, pagehide, and hidden document; re-entry spends only remaining time", async () => {
    const apis = installMotionApis();
    const { container } = renderComponent(
      <OutcomeFrame {...criticalProps()} />,
    );
    await intersect();
    fireEvent.load(image(container)!);
    advance(500);
    apis.changeReduced(true);
    expect(image(container)).toBeNull();
    advance(2500);
    apis.changeReduced(false);
    await intersect();
    fireEvent.load(image(container)!);
    advance(400);
    fireEvent(window, new Event("pagehide"));
    expect(image(container)).toBeNull();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    advance(2500);
    fireEvent(window, new Event("pageshow"));
    expect(image(container)).toBeNull();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    fireEvent(document, new Event("visibilitychange"));
    await intersect();
    fireEvent.load(image(container)!);
    advance(1299);
    expect(image(container)).not.toBeNull();
    advance(1);
    expect(image(container)).toBeNull();
  });

  it("latches source failure for the same identity and lets a replacement source start fresh", async () => {
    installMotionApis();
    const { container, rerender } = renderComponent(
      <OutcomeFrame {...criticalProps(success)} />,
    );
    await intersect();
    fireEvent.error(image(container)!);
    expect(image(container)).toBeNull();
    await intersect(false);
    await intersect();
    expect(image(container)).toBeNull();

    rerender(<OutcomeFrame {...criticalProps(failure)} />);
    await act(async () => observers.at(-1)?.emit(true));
    expect(image(container)?.getAttribute("src")).toBe(
      "/assets/frames/critical-failure.png",
    );
  });

  it("ignores a retained observer callback after source replacement", async () => {
    installMotionApis();
    const { container, rerender } = renderComponent(
      <OutcomeFrame {...criticalProps(success)} />,
    );
    await intersect();
    const oldImage = image(container)!;
    const oldCallbacks = captureImageCallbacks(oldImage);
    fireEvent.load(oldImage);
    const oldObserver = observers[0]!;
    rerender(<OutcomeFrame {...criticalProps(failure)} />);
    act(() => {
      oldCallbacks.onError();
      oldCallbacks.onLoad();
    });
    await act(async () => oldObserver.emitStale(true));
    expect(image(container)).toBeNull();
    await intersect();
    expect(image(container)?.getAttribute("src")).toBe(
      "/assets/frames/critical-failure.png",
    );
  });

  it("preserves critical priority and readable fallback when the frame key is invalid", async () => {
    installMotionApis();
    const { container } = renderComponent(
      <OutcomeFrame
        frame={
          {
            setKey: "ARKEN_CRITICAL_V1",
            frameKey: "../../unpublished",
          } as unknown as typeof success
        }
        styleFrame={{
          assetId: "11111111-2222-4333-8444-555555555555",
          source: "PLAYER",
        }}
        active
      />,
    );
    await intersect();
    expect(image(container)).toBeNull();
    expect(container.querySelector(".outcome-frame--style")).toBeNull();
    expect(container.innerHTML).not.toContain("/assets/frames/");
  });
});
