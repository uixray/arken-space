/**
 * Small, self-contained Canvas2D cloud tile for decorative fog only.
 *
 * The tile is generated without sampling the map and is always fully opaque.
 * It is capped at 128x128 and 12 updates/second. Devices explicitly signaling
 * reduced data, <=4 logical CPUs, or <=4 GiB memory use the deterministic
 * still tile; this is a conservative static policy, not energy detection.
 */
export const FOG_TILE_SIZE = 128;
export const FOG_MAX_FPS = 12;
export const FOG_FRAME_INTERVAL_MS = Math.ceil(1000 / FOG_MAX_FPS);

export type FogMotionPolicyInput = {
  reducedMotion: boolean;
  saveData?: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
};

export function shouldAnimateFog(input: FogMotionPolicyInput): boolean {
  return !input.reducedMotion &&
    !input.saveData &&
    !(input.deviceMemory !== undefined && input.deviceMemory <= 4) &&
    !(input.hardwareConcurrency !== undefined && input.hardwareConcurrency <= 4);
}

function createCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function paintCloudTile(context: CanvasRenderingContext2D, size: number) {
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      // Periodic fields keep the texture seamless when Konva repeats it.
      const broad = Math.sin(u + Math.cos(v * 2) * 1.2) * 0.5 + 0.5;
      const rolling = Math.cos(v + Math.sin(u * 2) * 0.8) * 0.5 + 0.5;
      const wisps = Math.sin(u * 3 + v * 2) * Math.cos(v * 3 - u) * 0.5 + 0.5;
      const cloud = Math.max(0, Math.min(1, broad * 0.5 + rolling * 0.35 + wisps * 0.15));
      const shade = Math.round(8 + cloud * 17);
      const offset = (y * size + x) * 4;
      image.data[offset] = shade;
      image.data[offset + 1] = shade + 2;
      image.data[offset + 2] = shade + 5;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

export type FogCloudAnimation = {
  canvas: HTMLCanvasElement;
  animated: boolean;
  dispose: () => void;
};

/** Create the repeated tile and own its visibility/media-query lifecycle. */
export function createFogCloudAnimation(
  onFrame: (offset: { x: number; y: number }) => void,
  onFailure: () => void = () => undefined,
): FogCloudAnimation | null {
  const canvas = createCanvas(FOG_TILE_SIZE);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return null;
  paintCloudTile(context, FOG_TILE_SIZE);

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean };
  }).connection;
  const device = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };
  const deviceCanAnimate = shouldAnimateFog({
    reducedMotion: false,
    saveData: connection?.saveData,
    deviceMemory: device.deviceMemory,
    hardwareConcurrency: device.hardwareConcurrency,
  });

  let timer: number | null = null;
  let frame = 0;
  let disposed = false;
  const stop = () => {
    if (timer === null) return;
    window.clearInterval(timer);
    timer = null;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stop();
    document.removeEventListener("visibilitychange", sync);
    motionQuery.removeEventListener?.("change", sync);
    canvas.width = 0;
    canvas.height = 0;
  };
  const fail = () => {
    dispose();
    onFailure();
  };
  const tick = () => {
    try {
      frame += 1;
      // Move only the decorative pattern transform. The static opaque tile
      // and all mask geometry/cache remain untouched between frames.
      onFrame({
        x: (frame * 0.65) % FOG_TILE_SIZE,
        y: (frame * 0.22) % FOG_TILE_SIZE,
      });
    } catch {
      fail();
    }
  };
  const sync = () => {
    stop();
    if (
      deviceCanAnimate &&
      shouldAnimateFog({
        reducedMotion: motionQuery.matches,
        saveData: connection?.saveData,
        deviceMemory: device.deviceMemory,
        hardwareConcurrency: device.hardwareConcurrency,
      }) &&
      !document.hidden
    )
      timer = window.setInterval(tick, FOG_FRAME_INTERVAL_MS);
  };
  document.addEventListener("visibilitychange", sync);
  motionQuery.addEventListener?.("change", sync);
  sync();

  return {
    canvas,
    animated: deviceCanAnimate && !motionQuery.matches,
    dispose,
  };
}
