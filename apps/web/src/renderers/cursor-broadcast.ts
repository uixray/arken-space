// UIX-392: pure logic for client-side cursor presence, extracted out of
// Orthographic2DRenderer.tsx so the batching/gating decisions are unit
// testable without a DOM, a real requestAnimationFrame, or Konva.

/**
 * Touch input is explicitly deferred for this feature (see AC: "Touch input
 * has an appropriate equivalent or is explicitly deferred"). Wiring
 * pointer-type-agnostic tracking would spam cursor broadcasts on every
 * touch-drag/pan gesture on mobile, which is not a cursor in any useful
 * sense there. Only genuine mouse pointer events are ever sent.
 */
export function isTrackableCursorPointerType(pointerType: string): boolean {
  return pointerType === "mouse";
}

/**
 * UIX-403: the one place that decides whether a position leaves this machine.
 *
 * The privacy the ticket asks for is not "do not draw it" but "do not send
 * it": a position that is broadcast and merely hidden is one devtools tab away
 * from telling players where the GM is looking. That makes this condition a
 * safety property rather than a rendering detail, and it belongs next to the
 * other broadcast decisions where it can be tested without Konva, a DOM, or a
 * real socket — the renderer had it inline, where nothing could reach it.
 *
 * A missing socket counts as "do not send" rather than an error: the app runs
 * fine offline, and cursor presence is the first thing that should go quiet.
 */
export function shouldBroadcastCursor(input: {
  sendEnabled: boolean;
  hasSocket: boolean;
  /** `undefined` when the move did not come from a real pointer event. */
  pointerType: string | undefined;
}): boolean {
  if (!input.sendEnabled || !input.hasSocket) return false;
  if (input.pointerType === undefined) return false;
  return isTrackableCursorPointerType(input.pointerType);
}

/** A few seconds of no pointer movement is treated as "gone". */
export const CURSOR_INACTIVITY_MS = 4000;

export function isCursorStale(lastMoveAt: number, now: number): boolean {
  return now - lastMoveAt > CURSOR_INACTIVITY_MS;
}

/** No animated smoothing/transition when the user prefers reduced motion. */
export function cursorTransitionDurationMs(
  prefersReducedMotion: boolean,
): number {
  return prefersReducedMotion ? 0 : 120;
}

export interface FrameScheduler {
  schedule: (callback: () => void) => number;
  cancel: (handle: number) => void;
}

/**
 * Batches rapid `queue()` calls down to at most one flush per animation
 * frame, keeping only the latest payload — the rAF-batching the ticket's AC
 * requires instead of emitting on every raw pointermove. The scheduler is
 * injected so tests can drive it synchronously instead of depending on a
 * real `requestAnimationFrame`.
 */
export class CursorMoveBatcher<T> {
  private pending: T | null = null;
  private handle: number | null = null;

  constructor(
    private readonly scheduler: FrameScheduler,
    private readonly onFlush: (payload: T) => void,
  ) {}

  queue(payload: T): void {
    this.pending = payload;
    if (this.handle !== null) return;
    this.handle = this.scheduler.schedule(() => {
      this.handle = null;
      const flushed = this.pending;
      this.pending = null;
      if (flushed !== null) this.onFlush(flushed);
    });
  }

  /** Drops any queued-but-unflushed payload and cancels the pending frame. */
  cancel(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    this.pending = null;
  }
}
