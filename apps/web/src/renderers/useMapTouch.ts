import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
type Point = { x: number; y: number };
type Token = { id: string; revision: number; x: number; y: number };
type ToolGesture = {
  move: (point: Point) => void;
  finish: () => void;
  cancel: () => void;
};
type Gesture = {
  scope: string;
  start: Point;
  position: Point;
  scale: number;
  token: Token | null;
  tool: ToolGesture | null;
  moved: boolean;
  multi: boolean;
  distance: number;
  center: Point;
};
type Config = {
  startTool?: (point: Point) => ToolGesture | null;
  scope: string;
  enabled: boolean;
  camera: { position: Point; scale: number };
  cameraChange: (position: Point, scale: number) => void;
  hit: (point: Point) => Token | null;
  movable: (token: Token) => boolean;
  select: (token: Token) => void;
  preview: (token: Token, delta: Point | null) => void;
  commit: (token: Token, delta: Point) => void;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** Touch owns canvas pointers before Konva's mouse/drag compatibility handlers.
 * Only pointer-up commits; multi-touch and all interruption paths discard. */
export function useMapTouch(config: Config) {
  const latest = useRef(config);
  latest.current = config;
  const points = useRef(new Map<number, Point>());
  const owner = useRef<HTMLElement | null>(null);
  const visibilityObserver = useRef<MutationObserver | null>(null);
  const ownerVisible = useCallback(
    () => Boolean(
      owner.current?.isConnected &&
      !owner.current.closest("[hidden], [inert]") &&
      !document.hidden,
    ),
    [],
  );
  const gesture = useRef<Gesture | null>(null);
  const cancel = useCallback(() => {
    visibilityObserver.current?.disconnect();
    visibilityObserver.current = null;
    const g = gesture.current;
    gesture.current = null;
    g?.tool?.cancel();
    if (g?.token) latest.current.preview(g.token, null);
    // Keep physical contacts until their terminal events. A new finger cannot
    // resurrect a cancelled draft while another finger is still on the map.
  }, []);
  const forgetPointer = useCallback((pointerId: number) => {
    points.current.delete(pointerId);
    if (points.current.size) return;
    gesture.current = null;
    visibilityObserver.current?.disconnect();
    visibilityObserver.current = null;
    owner.current = null;
  }, []);
  useEffect(() => {
    cancel();
  }, [config.scope, config.enabled, cancel]);
  useEffect(() => {
    const interrupt = () => cancel();
    const visibility = () => {
      if (document.hidden) cancel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    const outsideDown = (event: PointerEvent) => {
      if (gesture.current && (
        event.pointerType !== "touch" ||
        !(event.target instanceof HTMLCanvasElement) ||
        !owner.current?.contains(event.target)
      )) cancel();
    };
    const terminal = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !points.current.has(event.pointerId))
        return;
      // Captured, valid releases inside the map are committed by React's up
      // handler. Outside/cancelled releases only drain the quarantined contacts.
      if (
        event.type === "pointercancel" || !gesture.current || !ownerVisible() ||
        !latest.current.enabled || gesture.current.scope !== latest.current.scope ||
        !(event.target instanceof Node) || !owner.current?.contains(event.target)
      ) {
        cancel();
        forgetPointer(event.pointerId);
      }
    };
    window.addEventListener("blur", interrupt);
    window.addEventListener("orientationchange", interrupt);
    window.addEventListener("resize", interrupt);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", outsideDown, true);
    window.addEventListener("pointerup", terminal, true);
    window.addEventListener("pointercancel", terminal, true);
    return () => {
      cancel();
      window.removeEventListener("blur", interrupt);
      window.removeEventListener("orientationchange", interrupt);
      window.removeEventListener("resize", interrupt);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", outsideDown, true);
      window.removeEventListener("pointerup", terminal, true);
      window.removeEventListener("pointercancel", terminal, true);
      for (const id of points.current.keys()) {
        try {
          if (owner.current?.hasPointerCapture(id))
            owner.current.releasePointerCapture(id);
        } catch { /* The browser may already have ended this pointer. */ }
      }
      points.current.clear();
      owner.current = null;
    };
  }, [cancel, forgetPointer, ownerVisible]);
  const local = (event: ReactPointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const consume = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const rebasePinch = (g: Gesture) => {
    const [a, b] = [...points.current.values()];
    if (!a || !b) return;
    const c = latest.current.camera;
    Object.assign(g, {
      token: null,
      multi: true,
      position: c.position,
      scale: c.scale,
      distance: Math.max(1, distance(a, b)),
      center: midpoint(a, b),
    });
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== "touch" ||
      !(event.target instanceof HTMLCanvasElement)
    )
      return false;
    consume(event);
    if (
      !latest.current.enabled ||
      document.hidden ||
      event.currentTarget.closest("[hidden], [inert]")
    )
      return true;
    const hasCapturedContact = [...points.current.keys()].some(
      (id) => owner.current?.hasPointerCapture(id),
    );
    if (!gesture.current && event.isPrimary && !hasCapturedContact) {
      // A fresh primary touch can recover contacts whose terminal event was
      // lost while the browser was suspended. Non-primary fingers never rearm.
      points.current.clear();
      owner.current = null;
    }
    if (gesture.current?.scope !== latest.current.scope) cancel();
    event.currentTarget.focus({ preventScroll: true });
    const point = local(event);
    if (!points.current.size) owner.current = event.currentTarget;
    points.current.set(event.pointerId, point);
    try { event.currentTarget.setPointerCapture(event.pointerId); }
    catch {
      cancel();
      return true;
    }
    if (points.current.size === 1) {
      visibilityObserver.current?.disconnect();
      visibilityObserver.current = new MutationObserver(() => {
        if (!ownerVisible()) cancel();
      });
      for (
        let node: HTMLElement | null = owner.current;
        node;
        node = node.parentElement
      ) {
        visibilityObserver.current.observe(node, {
          attributes: true,
          attributeFilter: ["hidden", "inert"],
        });
      }
      const c = latest.current.camera;
      const tool = event.isPrimary ? latest.current.startTool?.(point) ?? null : null;
      gesture.current = {
        scope: latest.current.scope,
        start: point,
        position: c.position,
        scale: c.scale,
        // A drawing/ruler/fog tool owns the whole gesture, even over a token.
        // Otherwise its pointer-up could both finish the tool and move/select
        // the underlying token.
        token: event.isPrimary && !tool ? latest.current.hit(point) : null,
        tool,
        moved: false,
        // Another contact may be on a toolbar or outside this renderer. Such
        // a partial sequence can navigate with two map fingers, never commit.
        multi: !event.isPrimary,
        distance: 0,
        center: point,
      };
    } else {
      const g = gesture.current;
      if (!g) return true;
      g.tool?.cancel();
      g.tool = null;
      if (g.token) latest.current.preview(g.token, null);
      rebasePinch(g);
    }
    return true;
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    if (
      !points.current.has(event.pointerId) &&
      !(event.target instanceof HTMLCanvasElement) &&
      event.target !== event.currentTarget
    )
      return;
    consume(event);
    if (!points.current.has(event.pointerId)) return;
    if (
      !ownerVisible() ||
      !latest.current.enabled ||
      gesture.current?.scope !== latest.current.scope
    ) {
      cancel();
      return;
    }
    const point = local(event);
    points.current.set(event.pointerId, point);
    const g = gesture.current;
    if (!g) return;
    if (g.multi) {
      if (points.current.size < 2) return;
      const [a, b] = [...points.current.values()];
      if (!a || !b) return;
      const center = midpoint(a, b);
      const scale = Math.min(
        3,
        Math.max(0.25, (g.scale * distance(a, b)) / g.distance),
      );
      latest.current.cameraChange(
        {
          x: center.x - ((g.center.x - g.position.x) / g.scale) * scale,
          y: center.y - ((g.center.y - g.position.y) / g.scale) * scale,
        },
        scale,
      );
      return;
    }
    if (g.tool) {
      g.tool.move(point);
      return;
    }
    if (distance(point, g.start) < 8 && !g.moved) return;
    g.moved = true;
    const delta = { x: point.x - g.start.x, y: point.y - g.start.y };
    if (g.token && latest.current.movable(g.token)) {
      latest.current.preview(g.token, {
        x: delta.x / g.scale,
        y: delta.y / g.scale,
      });
    } else if (g.token) {
      latest.current.preview(g.token, null);
    } else {
      latest.current.cameraChange(
        { x: g.position.x + delta.x, y: g.position.y + delta.y },
        g.scale,
      );
    }
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    if (
      !points.current.has(event.pointerId) &&
      !(event.target instanceof HTMLCanvasElement) &&
      event.target !== event.currentTarget
    )
      return;
    consume(event);
    if (!points.current.has(event.pointerId)) return;
    if (
      !ownerVisible() ||
      !latest.current.enabled ||
      gesture.current?.scope !== latest.current.scope
    ) {
      cancel();
      forgetPointer(event.pointerId);
      return;
    }
    const g = gesture.current;
    const point = local(event);
    forgetPointer(event.pointerId);
    if (g?.multi && points.current.size >= 2) rebasePinch(g);
    if (g && !g.multi && g.tool) {
      g.tool.move(point);
      g.tool.finish();
      g.tool = null;
    }
    if (g && !g.multi && g.token) {
      latest.current.preview(g.token, null);
      if (!g.moved && distance(point, g.start) < 8) latest.current.select(g.token);
      else if (latest.current.movable(g.token))
        latest.current.commit(g.token, {
          x: (point.x - g.start.x) / g.scale,
          y: (point.y - g.start.y) / g.scale,
        });
    }
    // A remaining finger after pinch cannot become a new token gesture.
  };
  const pointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || !points.current.has(event.pointerId))
      return;
    consume(event);
    cancel();
    forgetPointer(event.pointerId);
  };
  const lostCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    // pointerup implicitly releases capture. Its ID has already been removed;
    // losing that capture must not discard the remaining pinch contacts.
    if (event.pointerType === "touch" && points.current.has(event.pointerId))
      cancel();
  };
  return { down, move, up, cancel, pointerCancel, lostCapture };
}
