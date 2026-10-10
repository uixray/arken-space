export const MAP_PING_LIFETIME_MS = 3500;
export const MAP_PING_REDUCED_FADE_MS = 500;

export type MapPingGeometry = {
  rings: Array<{ radius: number; strokeWidth: number; opacity: number }>;
  haloRadius: number;
  haloOpacity: number;
  coreRadius: number;
  coreStrokeWidth: number;
  coreOpacity: number;
  nameX: number;
  nameY: number;
  nameFontSize: number;
  reduced: boolean;
};

export function mapPingStartTime(
  createdAt: string | number,
  fallbackNow: number,
): number {
  const parsed =
    typeof createdAt === "number" ? createdAt : new Date(createdAt).getTime();
  return Number.isFinite(parsed) ? parsed : fallbackNow;
}

export function mapPingElapsed(
  createdAt: string | number,
  now: number,
): number {
  return Math.max(0, now - mapPingStartTime(createdAt, now));
}

export function evaluateMapPing(
  elapsedMs: number,
  scale: number,
  reduced: boolean,
): MapPingGeometry {
  const elapsed = Math.max(
    0,
    Math.min(MAP_PING_LIFETIME_MS, Number.isFinite(elapsedMs) ? elapsedMs : 0),
  );
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (reduced) {
    const opacity = Math.max(0, 1 - elapsed / MAP_PING_REDUCED_FADE_MS);
    return {
      rings: [
        {
          radius: 8 / safeScale,
          strokeWidth: 1.5 / safeScale,
          opacity: opacity * 0.7,
        },
      ],
      haloRadius: 5 / safeScale,
      haloOpacity: opacity * 0.25,
      coreRadius: 3.5 / safeScale,
      coreStrokeWidth: 1 / safeScale,
      coreOpacity: opacity,
      nameX: 22 / safeScale,
      nameY: -7 / safeScale,
      nameFontSize: 13 / safeScale,
      reduced: true,
    };
  }
  const fadeOut = Math.max(0, 1 - elapsed / MAP_PING_LIFETIME_MS);
  const cycle = 1100;
  const phases = [
    elapsed % cycle,
    (elapsed + 360) % cycle,
    (elapsed + 720) % cycle,
  ].map((v) => v / cycle);
  const widths = [2.5, 2, 1.5];
  const strengths = [0.85, 0.7, 0.55];
  return {
    rings: phases.map((phase, i) => ({
      radius: (6 + phase * 40) / safeScale,
      strokeWidth: widths[i]! / safeScale,
      opacity: Math.max(0, (1 - phase) * fadeOut * strengths[i]!),
    })),
    haloRadius: ((6 + Math.sin(elapsed / 160) * 1.5) * 1.6) / safeScale,
    haloOpacity: fadeOut * 0.95 * 0.4,
    coreRadius: (6 + Math.sin(elapsed / 160) * 1.5) / safeScale,
    coreStrokeWidth: 1.5 / safeScale,
    coreOpacity: fadeOut * 0.95,
    nameX: 22 / safeScale,
    nameY: -7 / safeScale,
    nameFontSize: 13 / safeScale,
    reduced: false,
  };
}

export type MapPingFrameLoop = { start: () => void; stop: () => void };

export function createMapPingAnimationDriver(options: {
  startTime: number;
  durationMs: number;
  now: () => number;
  apply: (elapsedMs: number) => void;
  loop: MapPingFrameLoop;
}) {
  let active = false;
  const tick = () => {
    if (!active) return false;
    const elapsed = Math.max(0, options.now() - options.startTime);
    options.apply(elapsed);
    if (elapsed >= options.durationMs) {
      active = false;
      options.loop.stop();
      return false;
    }
    return true;
  };
  return {
    start() {
      if (active) return;
      active = true;
      options.loop.start();
    },
    tick,
    stop() {
      if (!active) return;
      active = false;
      options.loop.stop();
    },
    get active() {
      return active;
    },
  };
}

export function subscribeReducedMotion(
  listener: (reduced: boolean) => void,
  matchMedia: typeof window.matchMedia,
) {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  const update = () => listener(query.matches);
  update();
  if (query.addEventListener) query.addEventListener("change", update);
  else query.addListener?.(update);
  return () => {
    if (query.removeEventListener) query.removeEventListener("change", update);
    else query.removeListener?.(update);
  };
}
