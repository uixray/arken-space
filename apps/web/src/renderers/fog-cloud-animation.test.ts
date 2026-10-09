// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { afterEach, vi } from "vitest";
import {
  createFogCloudAnimation,
  FOG_FRAME_INTERVAL_MS,
  FOG_MAX_FPS,
  FOG_TILE_SIZE,
  shouldAnimateFog,
} from "./fog-cloud-animation";

const canvasContext = {
  createImageData: (width: number, height: number) => ({
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  }),
  putImageData: vi.fn(),
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  fillStyle: "",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("decorative fog cloud animation policy", () => {
  it("caps the texture and update rate", () => {
    expect(FOG_TILE_SIZE).toBeLessThanOrEqual(128);
    expect(FOG_MAX_FPS).toBeLessThanOrEqual(12);
    expect(FOG_FRAME_INTERVAL_MS).toBeGreaterThanOrEqual(1000 / 12);
  });

  it("keeps a static texture for reduced motion and conservative low-power signals", () => {
    expect(shouldAnimateFog({ reducedMotion: true })).toBe(false);
    expect(shouldAnimateFog({ reducedMotion: false, saveData: true })).toBe(false);
    expect(shouldAnimateFog({ reducedMotion: false, deviceMemory: 4 })).toBe(false);
    expect(shouldAnimateFog({ reducedMotion: false, hardwareConcurrency: 4 })).toBe(false);
    expect(shouldAnimateFog({ reducedMotion: false, deviceMemory: 8, hardwareConcurrency: 8 })).toBe(true);
  });

  it("returns no decorative tile when Canvas2D is unavailable, leaving the renderer's solid fallback", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(createFogCloudAnimation(vi.fn())).toBeNull();
  });

  it("pauses while hidden, resumes when visible, and disposes its timer and listeners", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value: 8 });
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 8 });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      canvasContext as unknown as CanvasRenderingContext2D,
    );
    const frame = vi.fn();
    const animation = createFogCloudAnimation(frame);
    expect(animation).not.toBeNull();
    expect(animation?.animated).toBe(true);

    vi.advanceTimersByTime(FOG_FRAME_INTERVAL_MS);
    expect(frame).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(FOG_FRAME_INTERVAL_MS * 2);
    expect(frame).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(FOG_FRAME_INTERVAL_MS);
    expect(frame).toHaveBeenCalledTimes(2);

    animation?.dispose();
    vi.advanceTimersByTime(FOG_FRAME_INTERVAL_MS * 2);
    expect(frame).toHaveBeenCalledTimes(2);
    expect(animation?.canvas.width).toBe(0);
  });
});
