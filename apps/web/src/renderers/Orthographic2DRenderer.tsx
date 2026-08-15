import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Arrow,
  Circle,
  Group,
  Image,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from "react-konva";
import useImage from "use-image";
import Konva from "konva";
import type { SceneRendererProps } from "./SceneRenderer";
import { rulerPolylineDistance } from "@arken/contracts";
import { shouldIgnoreGlobalShortcut } from "../input-diagnostics";
import { fogHiddenTokenIds, isRectFullyRevealed } from "./fog";
import { fitRect } from "./camera-fit";
import { useLatestRef } from "../use-latest-ref";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  appendRulerWaypoint,
  canMoveMapToken,
  clearSettledTokenResizeDraft,
  createInitialMapInteractionState,
  createValidatedMapObjectRef,
  mapInteractionReducer,
  moveRulerDraft,
  resolveMapToolShortcut,
  resolveMapWheelGesture,
  rulerDraftPoints,
  shouldBeginMapPan,
  startRulerDraft,
  type MapObjectRef,
  type RulerDraft,
} from "./map-interaction";
import {
  canSelectToken,
  resolveTokenStacks,
  selectMapObjects,
} from "./map-objects";
import {
  MapMoveQueue,
  mapMoveSelectionKey,
  type MapMoveTarget,
} from "./map-move-queue";
import { CANVAS_VISUAL_TOKENS as visual } from "./canvas-visual-tokens";
import { persistDrawingDraft, releaseDrawingDraft } from "./drawing-draft";
import { isDirectTokenDrag } from "./token-drag-event";
import { mapWorldPointFromDrop } from "../token-placement";
import { getTokenImageMask } from "./token-image-mask";
import {
  createTokenImageState,
  resolveTokenImageState,
  type TokenImageAvailability,
} from "./token-image-state";
import { resolveResizeHandleDataAttributes } from "./resize-handle";
import {
  CursorMoveBatcher,
  isTrackableCursorPointerType,
  CURSOR_INACTIVITY_MS,
} from "./cursor-broadcast";
import { cursorColorForMembership } from "./cursor-color";

function shouldCancelCanvasEdit(
  event: Pick<KeyboardEvent, "key" | "isComposing" | "target">,
) {
  return event.key === "Escape" && !shouldIgnoreGlobalShortcut(event);
}

const DRAWING_COLOR_PRESETS = [
  { value: "#ffffff", name: "Белый" },
  { value: "#111111", name: "Чёрный" },
  { value: "#ef4444", name: "Красный" },
  { value: "#f97316", name: "Оранжевый" },
  { value: "#facc15", name: "Жёлтый" },
  { value: "#22c55e", name: "Зелёный" },
  { value: "#06b6d4", name: "Бирюзовый" },
  { value: "#3b82f6", name: "Синий" },
  { value: "#a855f7", name: "Фиолетовый" },
] as const;

const DRAWING_STROKE_WIDTH_PRESETS = [1, 3, 5, 8, 12, 16, 24] as const;

function Grid({
  width,
  height,
  size,
  offsetX,
  offsetY,
  color,
  opacity,
}: {
  width: number;
  height: number;
  size: number;
  offsetX: number;
  offsetY: number;
  color: string;
  opacity: number;
}) {
  const lines = [];
  for (let x = offsetX % size; x <= width; x += size)
    lines.push(
      <Line
        key={`x-${x}`}
        points={[x, 0, x, height]}
        stroke={color}
        opacity={opacity}
        strokeWidth={visual.stroke.grid}
        listening={false}
      />,
    );
  for (let y = offsetY % size; y <= height; y += size)
    lines.push(
      <Line
        key={`y-${y}`}
        points={[0, y, width, y]}
        stroke={color}
        opacity={opacity}
        strokeWidth={visual.stroke.grid}
        listening={false}
      />,
    );
  return <>{lines}</>;
}

function TokenImage({
  src,
  tokenId,
  onAvailabilityChange,
  onUnmount,
  ...props
}: {
  src: string;
  tokenId: string;
  onAvailabilityChange?: (
    tokenId: string,
    availability: TokenImageAvailability,
  ) => void;
  onUnmount?: (tokenId: string) => void;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  draggable: boolean;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => void;
}) {
  const [image, loadStatus] = useImage(src, "anonymous");
  const [imageState, setImageState] = useState(() =>
    createTokenImageState<HTMLImageElement>(src),
  );
  useEffect(() => {
    setImageState((previous) => {
      const next = resolveTokenImageState(previous, {
        src,
        image: image ?? null,
        loadStatus,
      });
      return next.requestedSrc === previous.requestedSrc &&
        next.displayedImage === previous.displayedImage &&
        next.availability === previous.availability
        ? previous
        : next;
    });
  }, [image, loadStatus, src]);
  useEffect(
    () => onAvailabilityChange?.(tokenId, imageState.availability),
    [imageState.availability, onAvailabilityChange, tokenId],
  );
  useEffect(() => () => onUnmount?.(tokenId), [onUnmount, tokenId]);
  return <Image image={imageState.displayedImage ?? undefined} {...props} />;
}

export function Orthographic2DRenderer(props: SceneRendererProps) {
  const { canvasEditMode, onCanvasEditCancel, onBulkMove, onToolSelect } =
    props;
  const containerRef = useRef<HTMLDivElement>(null);
  const objectListRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [interaction, dispatchInteraction] = useReducer(
    mapInteractionReducer,
    undefined,
    createInitialMapInteractionState,
  );
  const moveQueue = useMemo(
    () =>
      new MapMoveQueue(async () => {
        throw new Error("MOVE_UNAVAILABLE");
      }),
    [],
  );
  useEffect(() => {
    moveQueue.setExecutor(async ({ targets, delta }) => {
      if (!onBulkMove) throw new Error("MOVE_UNAVAILABLE");
      return onBulkMove(targets, delta);
    });
  }, [moveQueue, onBulkMove]);
  const fogMaskRef = useRef<Konva.Group>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [showGmLayer, setShowGmLayer] = useState(true);
  const [tokenMenu, setTokenMenu] = useState<{
    token: SceneRendererProps["tokens"][number];
    x: number;
    y: number;
  } | null>(null);
  const tokenMenuRef = useRef<HTMLDivElement>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(
    null,
  );
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([]);
  // UIX-431: наружу уходит сам факт изменения выделения. Через ref, чтобы
  // эффект не перезапускался от каждой новой функции в пропсах.
  const onSelectionChangeRef = useLatestRef(props.onSelectionChange);
  useEffect(() => {
    onSelectionChangeRef.current?.(selectedTokenIds);
  }, [selectedTokenIds, onSelectionChangeRef]);
  const [selectedDrawingIds, setSelectedDrawingIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<{
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const panStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    stageX: number;
    stageY: number;
  } | null>(null);
  // UIX-392: ephemeral cursor presence. The batcher collapses rapid
  // pointermove-driven queue() calls to at most one `cursor:move` emit per
  // animation frame; the inactivity timer emits an explicit `cursor:gone`
  // after a few seconds of no movement as a graceful (client-driven)
  // expiry, separate from the server's disconnect-based backstop.
  const cursorBatcherRef = useRef<CursorMoveBatcher<{
    x: number;
    y: number;
  }> | null>(null);
  const cursorInactivityTimerRef = useRef<number | null>(null);
  const [hoveredTokenId, setHoveredTokenId] = useState<string | null>(null);
  const [tokenImageStates, setTokenImageStates] = useState<
    Record<string, TokenImageAvailability>
  >({});
  const setTokenImageAvailability = useCallback(
    (tokenId: string, availability: TokenImageAvailability) => {
      setTokenImageStates((current) =>
        current[tokenId] === availability
          ? current
          : { ...current, [tokenId]: availability },
      );
    },
    [],
  );
  const removeTokenImageAvailability = useCallback((tokenId: string) => {
    setTokenImageStates((current) => {
      if (!(tokenId in current)) return current;
      const next = { ...current };
      delete next[tokenId];
      return next;
    });
  }, []);
  const tokenImageStateAttribute = Object.entries(tokenImageStates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tokenId, availability]) => `${tokenId}:${availability}`)
    .join(",");
  useEffect(() => {
    const assetIds = new Set(props.assets.map((asset) => asset.id));
    const mountedCandidates = new Set(
      props.tokens
        .filter((token) => token.assetId && assetIds.has(token.assetId))
        .map((token) => token.id),
    );
    setTokenImageStates((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([tokenId]) =>
          mountedCandidates.has(tokenId),
        ),
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }, [props.assets, props.tokens]);
  const [dragPositions, setDragPositions] = useState<
    Record<string, { x: number; y: number; revision: number }>
  >({});
  const [resizeDrafts, setResizeDrafts] = useState<
    Record<string, { width: number; height: number; revision: number }>
  >({});
  const [fogStart, setFogStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [fogDraft, setFogDraft] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  // UIX-311: SCENE_REGION camera-focus rectangle drag, same draft-rect
  // pattern as fogStart/fogDraft above.
  const [regionStart, setRegionStart] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [regionDraft, setRegionDraft] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  // UIX-313: FOG_BRUSH/COVER_BRUSH continuous round-brush stroke -- local
  // draft points sampled on pointer move, committed as one BRUSH geometry
  // POST on pointer-up (same local-draft-then-commit pattern as fogDraft).
  const brushPointsRef = useRef<{ x: number; y: number }[]>([]);
  const brushActiveRef = useRef(false);
  const [brushPoints, setBrushPoints] = useState<{ x: number; y: number }[]>(
    [],
  );
  // UIX-313: FOG_POLYGON/COVER_POLYGON click-to-add-vertex draft. Cleared
  // (without committing) on Escape, right-click, or a tool switch away from
  // a polygon tool; completed on Enter/double-click once it has >=3 points.
  const [polygonPoints, setPolygonPoints] = useState<
    { x: number; y: number }[]
  >([]);
  const [polygonPreview, setPolygonPreview] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const cancelPolygonDraft = () => {
    setPolygonPoints([]);
    setPolygonPreview(null);
  };
  useEffect(() => {
    if (props.tool !== "FOG_POLYGON" && props.tool !== "COVER_POLYGON")
      cancelPolygonDraft();
  }, [props.tool]);
  const [drawingPoints, setDrawingPoints] = useState<number[]>([]);
  const drawingPointsRef = useRef<number[]>([]);
  const drawingActiveRef = useRef(false);
  const [pendingDrawings, setPendingDrawings] = useState<
    { tempId: string; points: number[]; color: string; strokeWidth: number }[]
  >([]);
  const finishDrawingRef = useRef<() => void>(() => undefined);
  const trackDrawingRef = useRef<(event: MouseEvent) => void>(() => undefined);
  const brushUpRef = useRef<() => void>(() => undefined);
  const [drawingColor, setDrawingColor] = useState<string>(visual.color.edit);
  const [drawingStrokeWidth, setDrawingStrokeWidth] = useState<number>(3);
  const drawingColorUpdateTimeoutRef = useRef<number | null>(null);
  const drawingWidthUpdateTimeoutRef = useRef<number | null>(null);
  const [backgroundDraft, setBackgroundDraft] = useState(
    props.scene.backgroundFrame,
  );
  const [worldDraft, setWorldDraft] = useState({
    width: props.scene.width,
    height: props.scene.height,
  });
  const [lockAspect, setLockAspect] = useState(true);
  // UIX-381: multi-segment ruler drag. `rulerDraftRef` mirrors `rulerDraft`
  // state so event handlers and the window-level Ctrl listener always read
  // the current draft synchronously (same ref-mirrors-state pattern as
  // `drawingPointsRef`/`drawingPoints` above), while `rulerDraft` state
  // drives the actual redraw.
  const [rulerDraft, setRulerDraft] = useState<RulerDraft | null>(null);
  const rulerDraftRef = useRef<RulerDraft | null>(null);
  const setRulerDraftState = (next: RulerDraft | null) => {
    rulerDraftRef.current = next;
    setRulerDraft(next);
  };
  const finishRulerRef = useRef<() => void>(() => undefined);
  // Escape and any tool switch both flow through `props.tool` changing (see
  // `handleMapKeyDown`'s unconditional `onToolSelect("PAN")` on Escape), so a
  // single tool-change effect is enough to cover both cleanup paths and keep
  // the fix for "Escape leaves a stale line" working for multi-segment drafts.
  useEffect(() => {
    if (props.tool === "RULER" || !rulerDraftRef.current) return;
    props.socket?.emit("ruler:clear", { sceneId: props.scene.id });
    setRulerDraftState(null);
  }, [props.tool, props.socket, props.scene.id]);
  useEffect(() => {
    if (props.tool !== "RULER") return;
    // UIX-381: commit the current live point as a waypoint on Ctrl keydown
    // (not Ctrl+click -- the pointer button stays held down for the whole
    // multi-segment drag, so there is no separate click to hook, and
    // keydown is what's actually usable mid-drag). Only the bare `Control`
    // keydown is handled (never combined with other keys), key-repeat is
    // ignored so holding Ctrl doesn't spam waypoints, and editable targets
    // are excluded via the same guard as the Escape handler -- so this never
    // shadows a real Ctrl+<key> browser/OS shortcut, and preventDefault on
    // the lone modifier keydown stops it from opening a context menu.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Control" || event.repeat) return;
      if (shouldIgnoreGlobalShortcut(event)) return;
      const current = rulerDraftRef.current;
      if (!current) return;
      const next = appendRulerWaypoint(current);
      if (next === current) return;
      setRulerDraftState(next);
      props.socket?.emit("ruler:update", {
        sceneId: props.scene.id,
        points: rulerDraftPoints(next),
      });
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.tool, props.socket, props.scene.id]);
  const [mapImage] = useImage(
    props.assets.find((asset) => asset.id === props.scene.mapAssetId)?.url ??
      "",
    "anonymous",
  );
  useEffect(() => {
    const previous = Konva.dragButtons;
    Konva.dragButtons = [0];
    return () => {
      Konva.dragButtons = previous;
    };
  }, []);
  useEffect(() => {
    if (!tokenMenu) return;
    const close = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      setTokenMenu(null);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [tokenMenu]);
  useEffect(() => {
    if (!interaction.objectListOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const list = objectListRef.current;
      if (list && !list.contains(event.target as Node))
        dispatchInteraction({ type: "close-object-list" });
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [interaction.objectListOpen]);
  // UIX-392: (re)create the rAF batcher whenever the socket or active scene
  // changes, so a stale closure never emits into the wrong scene/socket.
  useEffect(() => {
    const socket = props.socket;
    const sceneId = props.scene.id;
    const shared = props.cursorShared;
    cursorBatcherRef.current = new CursorMoveBatcher<{ x: number; y: number }>(
      {
        schedule: (callback) => requestAnimationFrame(callback),
        cancel: (handle) => cancelAnimationFrame(handle),
      },
      (point) => {
        socket?.emit("cursor:move", {
          sceneId,
          x: point.x,
          y: point.y,
          shared,
        });
      },
    );
    return () => {
      cursorBatcherRef.current?.cancel();
      cursorBatcherRef.current = null;
    };
    // `cursorShared` belongs here for the same reason as the socket and the
    // scene: the callback closes over it, and a stale closure would keep
    // relaying to the audience the GM just switched away from. Rebuilding the
    // batcher on a button press costs one cancelled frame.
  }, [props.socket, props.scene.id, props.cursorShared]);
  // Explicit "gone" signals: scene switch/unmount (this effect's own
  // cleanup) and window blur. An idle timeout (scheduled per pointer move,
  // see handlePointerMove) covers plain inactivity. The server's disconnect
  // handler is the last-resort backstop for a connection that drops instead
  // of tearing down cleanly.
  useEffect(() => {
    const socket = props.socket;
    const handleBlur = () => socket?.emit("cursor:gone");
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("blur", handleBlur);
      if (cursorInactivityTimerRef.current !== null)
        window.clearTimeout(cursorInactivityTimerRef.current);
      socket?.emit("cursor:gone");
    };
  }, [props.socket, props.scene.id]);
  useEffect(() => {
    setBackgroundDraft(props.scene.backgroundFrame);
    setWorldDraft({ width: props.scene.width, height: props.scene.height });
  }, [
    props.scene.id,
    props.scene.revision,
    props.scene.backgroundFrame,
    props.scene.width,
    props.scene.height,
  ]);
  useEffect(() => {
    setDragPositions((current) => {
      let changed = false;
      const next = { ...current };
      for (const token of props.tokens) {
        const pending = next[token.id];
        if (
          pending &&
          (token.revision > pending.revision ||
            (token.x === pending.x && token.y === pending.y))
        ) {
          delete next[token.id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [props.tokens]);
  useEffect(() => {
    setResizeDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const token of props.tokens) {
        const pending = next[token.id];
        if (
          pending &&
          (token.revision > pending.revision ||
            (token.width === pending.width && token.height === pending.height))
        ) {
          delete next[token.id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [props.tokens]);
  useEffect(() => {
    if (!canvasEditMode) return;
    const cancel = (event: KeyboardEvent) => {
      if (!shouldCancelCanvasEdit(event)) return;
      setBackgroundDraft(props.scene.backgroundFrame);
      setWorldDraft({ width: props.scene.width, height: props.scene.height });
      onCanvasEditCancel?.();
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [canvasEditMode, props.scene, onCanvasEditCancel]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setViewport({
          width: Math.max(320, entry.contentRect.width),
          height: Math.max(320, entry.contentRect.height),
        });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const orderedFogReveals = useMemo(
    () =>
      [...props.fogReveals].sort(
        (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
      ),
    [props.fogReveals],
  );

  /*
   * UIX-395: fog visibility is the single most expensive thing this renderer
   * computes. `isRectFullyRevealed` decomposes the probe rect into a grid cut
   * along every intersecting operation's edges and samples each cell, and for
   * BRUSH strokes each sample walks the stroke path -- so it is superlinear in
   * the number of fog operations on the scene. Both call sites used to run it
   * inline in the render body (once per token, twice per drawing), which meant
   * any unrelated re-render -- a chat message, a dice roll, any realtime event
   * at all -- re-evaluated the whole scene's fog. On a busy scene that blocked
   * the main thread long enough to trip the socket's ping timeout, which is
   * what made the GM client feel like it was constantly stalling.
   *
   * Both sets below depend only on the data the answer actually derives from,
   * so ordinary realtime traffic no longer triggers a recompute.
   */
  const hiddenTokenIds = useMemo(
    () =>
      fogHiddenTokenIds(props.tokens, orderedFogReveals, {
        role: props.role,
        membershipId: props.membershipId,
      }),
    [props.role, props.tokens, props.membershipId, orderedFogReveals],
  );

  const revealedDrawingIds = useMemo(() => {
    const revealed = new Set<string>();
    if (props.role === "GM") return revealed;
    for (const drawing of props.drawings) {
      const xs = drawing.points.filter((_, index) => index % 2 === 0);
      const ys = drawing.points.filter((_, index) => index % 2 === 1);
      if (xs.length === 0 || ys.length === 0) continue;
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      if (
        isRectFullyRevealed(
          {
            x: minX + drawing.x,
            y: minY + drawing.y,
            width: Math.max(...xs) - minX,
            height: Math.max(...ys) - minY,
          },
          orderedFogReveals,
        )
      )
        revealed.add(drawing.id);
    }
    return revealed;
  }, [props.role, props.drawings, orderedFogReveals]);

  useEffect(() => {
    const mask = fogMaskRef.current;
    if (!mask) return;
    mask.clearCache();
    mask.cache({
      x: 0,
      y: 0,
      width: worldDraft.width,
      height: worldDraft.height,
      pixelRatio: 1,
    });
    mask.getLayer()?.batchDraw();
  }, [orderedFogReveals, worldDraft.width, worldDraft.height]);

  const pointerInWorld = () => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - position.x) / scale,
      y: (pointer.y - position.y) / scale,
    };
  };
  const clampToWorld = (point: { x: number; y: number }) => ({
    x: Math.min(worldDraft.width, Math.max(0, point.x)),
    y: Math.min(worldDraft.height, Math.max(0, point.y)),
  });
  const playerClip =
    props.role === "PLAYER"
      ? {
          clipX: 0,
          clipY: 0,
          clipWidth: worldDraft.width,
          clipHeight: worldDraft.height,
        }
      : {};

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage) return;
    // A two-finger touchpad gesture scrolls the canvas. Browsers expose a
    // touchpad pinch as ctrl/meta + wheel, so keep that gesture for zooming.
    const gesture = resolveMapWheelGesture(event.evt);
    if (gesture.type === "pan") {
      setPosition((current) => ({
        x: current.x + gesture.delta.x,
        y: current.y + gesture.delta.y,
      }));
      return;
    }
    if (!pointer) return;
    const oldScale = scale;
    const nextScale = Math.min(
      3,
      Math.max(0.25, oldScale * (gesture.direction === "out" ? 0.9 : 1.1)),
    );
    const mousePoint = {
      x: (pointer.x - position.x) / oldScale,
      y: (pointer.y - position.y) / oldScale,
    };
    setScale(nextScale);
    setPosition({
      x: pointer.x - mousePoint.x * nextScale,
      y: pointer.y - mousePoint.y * nextScale,
    });
  };
  const zoomAtCenter = (nextScale: number) => {
    const bounded = Math.min(3, Math.max(0.25, nextScale));
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    const world = {
      x: (center.x - position.x) / scale,
      y: (center.y - position.y) / scale,
    };
    setScale(bounded);
    setPosition({
      x: center.x - world.x * bounded,
      y: center.y - world.y * bounded,
    });
  };
  const fitMap = () => {
    const fitted = fitRect(
      { x: 0, y: 0, width: props.scene.width, height: props.scene.height },
      viewport,
    );
    setScale(fitted.scale);
    setPosition(fitted.position);
  };

  // UIX-311: while a SCENE_REGION encounter is ACTIVE on this scene, every
  // client (GM and players) fits its own camera to the persisted
  // world-coordinate focusRegion -- fitRect runs locally per viewport, no
  // pixel position is ever stored or broadcast. When the encounter ends
  // (status flips to ENDED, or its snapshot entry disappears), "prior
  // focus/scale" is simplest read as "re-fit to the whole scene," so we
  // just call fitMap() again.
  const activeSceneRegionEncounter = props.encounters?.find(
    (encounter) =>
      encounter.status === "ACTIVE" &&
      encounter.mode === "SCENE_REGION" &&
      encounter.sourceSceneId === props.scene.id,
  );
  const activeRegionEncounterId = activeSceneRegionEncounter?.id ?? null;
  const activeFocusRegion = activeSceneRegionEncounter?.focusRegion ?? null;
  const wasFittedToRegionRef = useRef(false);
  useEffect(() => {
    if (activeFocusRegion) {
      const fitted = fitRect(activeFocusRegion, viewport);
      setScale(fitted.scale);
      setPosition(fitted.position);
      wasFittedToRegionRef.current = true;
      return;
    }
    if (wasFittedToRegionRef.current) {
      wasFittedToRegionRef.current = false;
      fitMap();
    }
    // fitMap/setScale/setPosition are stable per render and only invoked
    // from inside the effect; only the encounter identity/region and the
    // viewport size should re-trigger the fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeRegionEncounterId,
    activeFocusRegion?.x,
    activeFocusRegion?.y,
    activeFocusRegion?.width,
    activeFocusRegion?.height,
    viewport.width,
    viewport.height,
  ]);

  const displayRulers = useMemo(() => {
    const result = [...props.rulers];
    if (rulerDraft) {
      const points = rulerDraftPoints(rulerDraft);
      const gridSize = props.scene.grid.enabled ? props.scene.grid.size : 1;
      const localRuler = {
        sceneId: props.scene.id,
        membershipId: props.membershipId,
        displayName: "Вы",
        points,
        distance: rulerPolylineDistance(points, gridSize),
      };
      const index = result.findIndex(
        (r) => r.membershipId === props.membershipId,
      );
      if (index >= 0) {
        result[index] = localRuler;
      } else {
        result.push(localRuler);
      }
    }
    return result;
  }, [
    props.rulers,
    rulerDraft,
    props.scene.grid,
    props.scene.id,
    props.membershipId,
  ]);

  const selectableObjects = selectMapObjects(props.tokens, props.drawings, {
    role: props.role,
    membershipId: props.membershipId,
    fogReveals: orderedFogReveals,
    world: worldDraft,
    showGmLayer,
  });
  const movableTargets = useMemo<MapMoveTarget[]>(
    () => [
      ...selectableObjects.tokens
        .filter(
          (token) =>
            selectedTokenIds.includes(token.id) &&
            !token.locked &&
            (props.role === "GM" ||
              token.controllerMembershipIds.includes(props.membershipId)),
        )
        .map((token) => ({
          targetType: "TOKEN" as const,
          targetId: token.id,
          revision: token.revision,
        })),
      ...selectableObjects.drawings
        .filter((drawing) => selectedDrawingIds.includes(drawing.id))
        .map((drawing) => ({
          targetType: "DRAWING" as const,
          targetId: drawing.id,
          revision: drawing.revision,
        })),
    ],
    [
      selectableObjects.tokens,
      selectableObjects.drawings,
      selectedTokenIds,
      selectedDrawingIds,
      props.role,
      props.membershipId,
    ],
  );
  const moveScope = mapMoveSelectionKey(props.scene.id, movableTargets);
  useEffect(() => {
    moveQueue.reset(moveScope, movableTargets);
  }, [moveQueue, moveScope, movableTargets]);
  const enqueueMove = (delta: { x: number; y: number }) =>
    moveQueue.enqueue(movableTargets, delta);
  const selectObject = (ref: MapObjectRef) => {
    dispatchInteraction({ type: "select", ref });
    setSelectedTokenIds(ref.kind === "token" ? [ref.objectId] : []);
    setSelectedDrawingIds(ref.kind === "drawing" ? [ref.objectId] : []);
    setSelectedDrawingId(ref.kind === "drawing" ? ref.objectId : null);
  };
  const resolveCurrentRef = (ref: MapObjectRef | null) => {
    if (!ref) return null;
    const candidates =
      ref.kind === "token"
        ? selectableObjects.tokens
        : selectableObjects.drawings;
    const current = candidates.find(
      (item) => item.id === ref.objectId && item.revision === ref.revision,
    );
    return current ? createValidatedMapObjectRef(ref) : null;
  };
  const requestDelete = (ref: MapObjectRef) => {
    const current = resolveCurrentRef(ref);
    if (current) dispatchInteraction({ type: "request-delete", ref: current });
    else dispatchInteraction({ type: "clear-selection" });
  };
  const requestSelectedDelete = () => {
    if (interaction.selectedObject) requestDelete(interaction.selectedObject);
  };
  useLayoutEffect(() => {
    if (!tokenMenu) return;
    const container = containerRef.current;
    const menu = tokenMenuRef.current;
    if (!container || !menu) return;
    const padding = 8;
    const maxLeft = Math.max(
      padding,
      container.clientWidth - menu.offsetWidth - padding,
    );
    const maxTop = Math.max(
      padding,
      container.clientHeight - menu.offsetHeight - padding,
    );
    const left = Math.min(Math.max(padding, tokenMenu.x), maxLeft);
    const top = Math.min(Math.max(padding, tokenMenu.y), maxTop);
    if (left !== tokenMenu.x || top !== tokenMenu.y) {
      setTokenMenu((current) =>
        current ? { ...current, x: left, y: top } : current,
      );
    }
  }, [tokenMenu]);

  const openSelectedAction = () => {
    const selected = interaction.selectedObject;
    if (!selected || selected.kind !== "token") return;
    if (!resolveCurrentRef(selected)) {
      dispatchInteraction({ type: "clear-selection" });
      return;
    }
    const token = selectableObjects.tokens.find(
      (item) =>
        item.id === selected.objectId && item.revision === selected.revision,
    );
    if (token)
      setTokenMenu({ token, x: viewport.width / 2, y: viewport.height / 2 });
  };
  const handleMapKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const step = 48;
    if (event.key === "Escape") {
      dispatchInteraction({ type: "escape" });
      setSelectedTokenIds([]);
      setSelectedDrawingIds([]);
      setSelectedDrawingId(null);
      dispatchInteraction({ type: "clear-selection" });
      setTokenMenu(null);
      cancelPolygonDraft();
      if (
        drawingActiveRef.current ||
        drawingPointsRef.current.length > 0 ||
        drawingPoints.length > 0
      ) {
        // Cancel the in-progress stroke instead of leaving it dangling: the
        // matching pointerup will still fire later with props.tool already
        // switched away from DRAW, so shouldFinalizeDrawing there would be
        // false and neither persist nor reset the draft. Mirror the
        // reset-only branch from handlePointerUp here.
        drawingActiveRef.current = false;
        drawingPointsRef.current = [];
        setDrawingPoints([]);
      }
      onToolSelect("PAN");
    } else if (event.key.startsWith("Arrow")) {
      if (movableTargets.length) {
        const moveStep =
          (props.scene.grid.enabled ? props.scene.grid.size : 8) *
          (event.shiftKey ? 5 : 1);
        enqueueMove({
          x:
            event.key === "ArrowLeft"
              ? -moveStep
              : event.key === "ArrowRight"
                ? moveStep
                : 0,
          y:
            event.key === "ArrowUp"
              ? -moveStep
              : event.key === "ArrowDown"
                ? moveStep
                : 0,
        });
      } else if (event.key === "ArrowLeft")
        setPosition((p) => ({ ...p, x: p.x + step }));
      else if (event.key === "ArrowRight")
        setPosition((p) => ({ ...p, x: p.x - step }));
      else if (event.key === "ArrowUp")
        setPosition((p) => ({ ...p, y: p.y + step }));
      else setPosition((p) => ({ ...p, y: p.y - step }));
    } else if (event.key === "+" || event.key === "=")
      zoomAtCenter(scale * 1.1);
    else if (event.key === "-") zoomAtCenter(scale / 1.1);
    else if (event.key === "0" || event.key.toLowerCase() === "f") fitMap();
    else if (resolveMapToolShortcut(event.key, event.shiftKey, props.role))
      dispatchInteraction({
        type: "select-tool",
        tool: resolveMapToolShortcut(event.key, event.shiftKey, props.role)!,
      });
    else if (event.key.toLowerCase() === "o")
      dispatchInteraction({ type: "toggle-object-list" });
    else if (event.key === "Enter") {
      if (isPolygonTool && polygonPoints.length >= 3)
        void handlePolygonComplete();
      else openSelectedAction();
    } else if (event.key === "Delete") requestSelectedDelete();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  useEffect(() => {
    const selected = interaction.selectedObject;
    const candidates =
      selected?.kind === "token"
        ? selectableObjects.tokens
        : selectableObjects.drawings;
    const current =
      selected && candidates.find((item) => item.id === selected.objectId);
    if (selected && !current) {
      dispatchInteraction({ type: "clear-selection" });
      setSelectedTokenIds([]);
      setSelectedDrawingIds([]);
      setSelectedDrawingId(null);
    } else if (selected && current && current.revision !== selected.revision) {
      dispatchInteraction({
        type: "select",
        ref: createValidatedMapObjectRef({
          kind: selected.kind,
          objectId: selected.objectId,
          revision: current.revision,
        })!,
      });
    }
  }, [
    interaction.selectedObject,
    props.tokens,
    props.drawings,
    orderedFogReveals,
    props.role,
    props.membershipId,
    showGmLayer,
    worldDraft,
    selectableObjects.tokens,
    selectableObjects.drawings,
  ]);

  const { onDrawingDelete, onTokenDelete } = props;
  useEffect(() => {
    const command = interaction.commands[0];
    if (!command) return;
    if (command.type === "select-tool") onToolSelect(command.tool);
    if (command.type === "delete-object") {
      if (command.ref.kind === "token")
        void onTokenDelete?.(command.ref.objectId, command.ref.revision);
      else void onDrawingDelete?.(command.ref.objectId, command.ref.revision);
      setSelectedTokenIds((ids) =>
        ids.filter((id) => id !== command.ref.objectId),
      );
      setSelectedDrawingIds((ids) =>
        ids.filter((id) => id !== command.ref.objectId),
      );
      setSelectedDrawingId((id) => (id === command.ref.objectId ? null : id));
    }
    dispatchInteraction({ type: "consume-command", id: command.id });
  }, [interaction.commands, onDrawingDelete, onTokenDelete, onToolSelect]);

  const handleFogDown = () => {
    if ((props.tool !== "FOG" && props.tool !== "COVER") || props.role !== "GM")
      return;
    const point = pointerInWorld();
    if (point) setFogStart(clampToWorld(point));
  };

  const handleFogMove = () => {
    if (!fogStart || (props.tool !== "FOG" && props.tool !== "COVER")) return;
    const point = pointerInWorld();
    if (!point) return;
    const bounded = clampToWorld(point);
    setFogDraft({
      x: Math.min(fogStart.x, bounded.x),
      y: Math.min(fogStart.y, bounded.y),
      width: Math.abs(bounded.x - fogStart.x),
      height: Math.abs(bounded.y - fogStart.y),
    });
  };

  const handleFogUp = async () => {
    if (fogDraft && fogDraft.width >= 8 && fogDraft.height >= 8)
      await props.onFogCreate(fogDraft);
    setFogStart(null);
    setFogDraft(null);
  };

  const isBrushTool =
    props.tool === "FOG_BRUSH" || props.tool === "COVER_BRUSH";

  const handleBrushDown = () => {
    if (!isBrushTool || props.role !== "GM") return;
    const point = pointerInWorld();
    if (!point) return;
    const bounded = clampToWorld(point);
    brushActiveRef.current = true;
    brushPointsRef.current = [bounded];
    setBrushPoints([bounded]);
  };

  const handleBrushMove = () => {
    if (!brushActiveRef.current || !isBrushTool) return;
    const point = pointerInWorld();
    if (!point) return;
    const bounded = clampToWorld(point);
    const previous = brushPointsRef.current;
    const last = previous[previous.length - 1];
    if (last && last.x === bounded.x && last.y === bounded.y) return;
    const next = [...previous, bounded];
    brushPointsRef.current = next;
    setBrushPoints(next);
  };

  const handleBrushUp = async () => {
    if (!brushActiveRef.current) return;
    brushActiveRef.current = false;
    const points = brushPointsRef.current;
    brushPointsRef.current = [];
    setBrushPoints([]);
    if (!points.length) return;
    await props.onFogCreate({
      geometry: {
        type: "BRUSH",
        points,
        radius: props.fogBrushRadius ?? 40,
      },
    });
  };

  const isPolygonTool =
    props.tool === "FOG_POLYGON" || props.tool === "COVER_POLYGON";

  const handlePolygonClick = () => {
    if (!isPolygonTool || props.role !== "GM") return;
    const point = pointerInWorld();
    if (!point) return;
    const bounded = clampToWorld(point);
    setPolygonPoints((current) => {
      const last = current[current.length - 1];
      // A double-click's second mousedown lands on the same point as the
      // first -- skip it instead of adding a degenerate zero-length edge
      // right before handlePolygonComplete runs.
      if (last && last.x === bounded.x && last.y === bounded.y) return current;
      return [...current, bounded];
    });
  };

  const handlePolygonMove = () => {
    if (!isPolygonTool || polygonPoints.length === 0) return;
    const point = pointerInWorld();
    if (point) setPolygonPreview(clampToWorld(point));
  };

  const handlePolygonComplete = async () => {
    if (!isPolygonTool || polygonPoints.length < 3) return;
    const points = polygonPoints;
    cancelPolygonDraft();
    await props.onFogCreate({ geometry: { type: "POLYGON", points } });
  };

  const handleRegionDown = () => {
    if (props.tool !== "SCENE_REGION" || props.role !== "GM") return;
    const point = pointerInWorld();
    if (point) setRegionStart(clampToWorld(point));
  };

  const handleRegionMove = () => {
    if (!regionStart || props.tool !== "SCENE_REGION") return;
    const point = pointerInWorld();
    if (!point) return;
    const bounded = clampToWorld(point);
    setRegionDraft({
      x: Math.min(regionStart.x, bounded.x),
      y: Math.min(regionStart.y, bounded.y),
      width: Math.abs(bounded.x - regionStart.x),
      height: Math.abs(bounded.y - regionStart.y),
    });
  };

  const handleRegionUp = () => {
    if (regionDraft && regionDraft.width >= 8 && regionDraft.height >= 8)
      props.onEncounterRegionSelect?.(regionDraft);
    setRegionStart(null);
    setRegionDraft(null);
  };

  const handleClick = () => {
    if (props.tool !== "PING") return;
    const point = pointerInWorld();
    if (point) props.onPing(point);
  };

  const beginPan = (
    event: Konva.KonvaEventObject<MouseEvent | PointerEvent>,
  ) => {
    event.evt.preventDefault();
    event.cancelBubble = true;
    const pointer = stageRef.current?.getPointerPosition();
    if (pointer)
      panStartRef.current = {
        pointerX: pointer.x,
        pointerY: pointer.y,
        stageX: position.x,
        stageY: position.y,
      };
  };

  const handlePointerDown = (
    event: Konva.KonvaEventObject<MouseEvent | PointerEvent>,
  ) => {
    const targetIsCanvas =
      event.target === stageRef.current ||
      event.target.name() === "map-interaction-hit-plane";
    if (isPolygonTool && event.evt.button === 2) {
      // Right-click cancels the in-progress polygon draft instead of
      // starting a camera pan.
      event.evt.preventDefault();
      cancelPolygonDraft();
      return;
    }
    if (shouldBeginMapPan(event.evt.button, props.tool, targetIsCanvas)) {
      beginPan(event);
      if (event.evt.button === 0) {
        setSelectedTokenIds([]);
        setSelectedDrawingIds([]);
        setSelectedDrawingId(null);
        setTokenMenu(null);
      }
      return;
    }
    if (event.evt.button !== 0) return;
    if (targetIsCanvas && props.tool === "PAN") {
      setSelectedTokenIds([]);
      setSelectedDrawingIds([]);
      setSelectedDrawingId(null);
      dispatchInteraction({ type: "clear-selection" });
      setTokenMenu(null);
    }
    handleFogDown();
    handleRegionDown();
    handleBrushDown();
    handlePolygonClick();
    const point = pointerInWorld();
    if (!point) return;
    const bounded = clampToWorld(point);
    if (props.tool === "DRAW") {
      const points = [bounded.x, bounded.y];
      drawingActiveRef.current = true;
      drawingPointsRef.current = points;
      setDrawingPoints(points);
    }
    if (props.tool === "RULER") {
      setRulerDraftState(startRulerDraft(point));
    }
  };

  const handlePointerMove = (
    event?: Konva.KonvaEventObject<MouseEvent | PointerEvent>,
  ) => {
    // UIX-392: touch input is explicitly deferred for cursor presence (see
    // `isTrackableCursorPointerType` doc comment) — only genuine mouse
    // pointer events feed the batcher, so touch-drag/pan gestures on mobile
    // never spam `cursor:move`. `event` is undefined when this function is
    // invoked internally (e.g. drag-tracking outside the Stage), which is
    // intentionally treated as untrackable rather than guessed at.
    const pointerType =
      event && "pointerType" in event.evt
        ? (event.evt as PointerEvent).pointerType
        : undefined;
    if (
      props.cursorSendEnabled &&
      props.socket &&
      pointerType !== undefined &&
      isTrackableCursorPointerType(pointerType)
    ) {
      const worldPoint = pointerInWorld();
      if (worldPoint) {
        cursorBatcherRef.current?.queue(worldPoint);
        if (cursorInactivityTimerRef.current !== null)
          window.clearTimeout(cursorInactivityTimerRef.current);
        cursorInactivityTimerRef.current = window.setTimeout(() => {
          props.socket?.emit("cursor:gone");
        }, CURSOR_INACTIVITY_MS);
      }
    }
    if (panStartRef.current) {
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer)
        setPosition({
          x:
            panStartRef.current.stageX +
            pointer.x -
            panStartRef.current.pointerX,
          y:
            panStartRef.current.stageY +
            pointer.y -
            panStartRef.current.pointerY,
        });
      return;
    }
    if (marquee) {
      const point = pointerInWorld();
      if (point)
        setMarquee((current) =>
          current
            ? {
                ...current,
                x: Math.min(current.startX, point.x),
                y: Math.min(current.startY, point.y),
                width: Math.abs(point.x - current.startX),
                height: Math.abs(point.y - current.startY),
              }
            : null,
        );
      return;
    }
    handleFogMove();
    handleRegionMove();
    handleBrushMove();
    handlePolygonMove();
    const point = pointerInWorld();
    if (!point) return;
    if (
      props.tool === "DRAW" &&
      drawingActiveRef.current &&
      drawingPointsRef.current.length
    ) {
      const bounded = clampToWorld(point);
      const previous = drawingPointsRef.current;
      const lastX = previous[previous.length - 2];
      const lastY = previous[previous.length - 1];
      if (bounded.x !== lastX || bounded.y !== lastY) {
        const next = [...previous, bounded.x, bounded.y];
        drawingPointsRef.current = next;
        setDrawingPoints(next);
      }
    }
    if (props.tool === "RULER" && rulerDraftRef.current) {
      const next = moveRulerDraft(rulerDraftRef.current, point);
      setRulerDraftState(next);
      props.socket?.emit("ruler:update", {
        sceneId: props.scene.id,
        points: rulerDraftPoints(next),
      });
    }
  };

  const handlePointerUp = async () => {
    panStartRef.current = null;
    if (marquee) {
      const intersects = (rect: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) =>
        rect.x < marquee.x + marquee.width &&
        rect.x + rect.width > marquee.x &&
        rect.y < marquee.y + marquee.height &&
        rect.y + rect.height > marquee.y;
      setSelectedTokenIds(
        props.tokens
          .filter(
            (token) =>
              token.layer !== "MAP" &&
              !token.locked &&
              (props.role === "GM" ||
                token.controllerMembershipIds.includes(props.membershipId)),
          )
          .filter((token) => intersects(token))
          .map((token) => token.id),
      );
      setSelectedDrawingIds(
        props.drawings
          .filter(
            (drawing) =>
              props.role === "GM" ||
              drawing.authorMembershipId === props.membershipId,
          )
          .filter((drawing) => {
            const xs = drawing.points.filter((_, index) => index % 2 === 0);
            const ys = drawing.points.filter((_, index) => index % 2 === 1);
            return intersects({
              x: drawing.x + Math.min(...xs),
              y: drawing.y + Math.min(...ys),
              width: Math.max(...xs) - Math.min(...xs),
              height: Math.max(...ys) - Math.min(...ys),
            });
          })
          .map((drawing) => drawing.id),
      );
      dispatchInteraction({ type: "clear-selection" });
      setSelectedDrawingId(null);
      setMarquee(null);
      return;
    }
    const completedDrawing = drawingPointsRef.current;
    const shouldFinalizeDrawing =
      props.tool === "DRAW" && drawingActiveRef.current;
    drawingActiveRef.current = false;
    await handleFogUp();
    handleRegionUp();
    await handleBrushUp();
    if (shouldFinalizeDrawing && completedDrawing.length >= 4) {
      const releasedDrawing = releaseDrawingDraft(drawingPointsRef, [], () =>
        setDrawingPoints([]),
      );
      const tempId = crypto.randomUUID();
      setPendingDrawings((current) => [
        ...current,
        {
          tempId,
          points: releasedDrawing,
          color: drawingColor,
          strokeWidth: drawingStrokeWidth,
        },
      ]);
      void persistDrawingDraft(
        {
          points: releasedDrawing,
          color: drawingColor,
          strokeWidth: drawingStrokeWidth,
        },
        props.onDrawingCreate,
        () =>
          setPendingDrawings((current) =>
            current.filter((pending) => pending.tempId !== tempId),
          ),
      ).catch(() => {
        // onDrawingCreate owns user-facing error reporting; consume the
        // detached background task rejection to avoid an unhandled promise.
      });
    } else if (shouldFinalizeDrawing) {
      drawingPointsRef.current = [];
      setDrawingPoints([]);
    }
    if (props.tool === "RULER") {
      props.socket?.emit("ruler:clear", { sceneId: props.scene.id });
      setRulerDraftState(null);
    }
  };

  useEffect(() => {
    finishDrawingRef.current = () => void handlePointerUp();
    trackDrawingRef.current = (event) => {
      if (!drawingActiveRef.current) return;
      stageRef.current?.setPointersPositions(event);
      handlePointerMove();
    };
    brushUpRef.current = () => void handleBrushUp();
    // UIX-381: pointer cancel (e.g. a touch drag interrupted by the OS, or
    // losing pointer capture) must clear the multi-segment draft the same
    // way an ordinary release does -- see finishOutsideStage below, which
    // covers the case where the up/cancel event never reaches the Stage.
    finishRulerRef.current = () => {
      if (!rulerDraftRef.current) return;
      props.socket?.emit("ruler:clear", { sceneId: props.scene.id });
      setRulerDraftState(null);
    };
  });

  useEffect(() => {
    const trackOutsideStage = (event: MouseEvent) =>
      trackDrawingRef.current(event);
    const finishOutsideStage = () => {
      // Pointer capture is not guaranteed for mouse right/middle drags. Always
      // terminate a pending pan when release/cancel happens outside the Stage,
      // otherwise the next hover move would resume the stale gesture.
      panStartRef.current = null;
      if (drawingActiveRef.current) finishDrawingRef.current();
      if (brushActiveRef.current) brushUpRef.current();
      finishRulerRef.current();
    };
    window.addEventListener("mousemove", trackOutsideStage, true);
    window.addEventListener("mouseup", finishOutsideStage, true);
    window.addEventListener("pointerup", finishOutsideStage, true);
    window.addEventListener("pointercancel", finishOutsideStage, true);
    window.addEventListener("blur", finishOutsideStage);
    return () => {
      window.removeEventListener("mousemove", trackOutsideStage, true);
      window.removeEventListener("mouseup", finishOutsideStage, true);
      window.removeEventListener("pointerup", finishOutsideStage, true);
      window.removeEventListener("pointercancel", finishOutsideStage, true);
      window.removeEventListener("blur", finishOutsideStage);
    };
  }, []);

  const assetUrl = (assetId: string | null) =>
    props.assets.find((asset) => asset.id === assetId)?.url;
  const snap = (value: number) =>
    props.scene.grid.enabled
      ? Math.round(value / props.scene.grid.size) * props.scene.grid.size
      : value;
  const gridCellKey = (x: number, y: number) => {
    const size = props.scene.grid.enabled ? props.scene.grid.size : 64;
    return `${Math.floor((x - props.scene.grid.offsetX) / size)}:${Math.floor((y - props.scene.grid.offsetY) / size)}`;
  };
  const tokenStacks = resolveTokenStacks(
    props.tokens.map((token) => ({
      ...token,
      x: dragPositions[token.id]?.x ?? token.x,
      y: dragPositions[token.id]?.y ?? token.y,
    })),
    gridCellKey,
  );
  const objectListTokenStacks = resolveTokenStacks(
    selectableObjects.tokens.map((token) => ({
      ...token,
      x: dragPositions[token.id]?.x ?? token.x,
      y: dragPositions[token.id]?.y ?? token.y,
    })),
    gridCellKey,
  );
  const renderFog = () => (
    <Layer
      listening={false}
      visible={props.role === "PLAYER" || props.gmFogVisible !== false}
      clipX={0}
      clipY={0}
      clipWidth={worldDraft.width}
      clipHeight={worldDraft.height}
    >
      <Group
        ref={fogMaskRef}
        opacity={props.role === "GM" ? (props.gmFogOpacity ?? 0.35) : 1}
      >
        <Rect
          width={worldDraft.width}
          height={worldDraft.height}
          fill={visual.color.fog}
        />
        {orderedFogReveals.map((fog) => {
          const compositeOperation =
            fog.operation === "COVER" ? "source-over" : "destination-out";
          const geometry = fog.geometry;
          // Rows created before UIX-313 (or any legacy RECT-only insert)
          // have no `geometry`; fall back to the bbox fields, same as the
          // pre-UIX-313 rendering.
          if (!geometry || geometry.type === "RECT") {
            const rect =
              geometry?.type === "RECT"
                ? geometry
                : { x: fog.x, y: fog.y, width: fog.width, height: fog.height };
            return (
              <Rect
                key={fog.id}
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                fill={visual.color.fogCover}
                globalCompositeOperation={compositeOperation}
              />
            );
          }
          if (geometry.type === "CIRCLE")
            return (
              <Circle
                key={fog.id}
                x={geometry.center.x}
                y={geometry.center.y}
                radius={geometry.radius}
                fill={visual.color.fogCover}
                globalCompositeOperation={compositeOperation}
              />
            );
          if (geometry.type === "POLYGON")
            return (
              <Line
                key={fog.id}
                points={geometry.points.flatMap((point) => [point.x, point.y])}
                closed
                fill={visual.color.fogCover}
                globalCompositeOperation={compositeOperation}
              />
            );
          // BRUSH: a single-point stroke has no length for Konva's Line to
          // render, so draw the equivalent circle; otherwise draw a
          // round-capped/joined stroke following the sampled points.
          if (geometry.points.length === 1)
            return (
              <Circle
                key={fog.id}
                x={geometry.points[0]!.x}
                y={geometry.points[0]!.y}
                radius={geometry.radius}
                fill={visual.color.fogCover}
                globalCompositeOperation={compositeOperation}
              />
            );
          return (
            <Line
              key={fog.id}
              points={geometry.points.flatMap((point) => [point.x, point.y])}
              stroke={visual.color.fogCover}
              strokeWidth={geometry.radius * 2}
              lineCap="round"
              lineJoin="round"
              globalCompositeOperation={compositeOperation}
            />
          );
        })}
      </Group>
      {fogDraft && (
        <Rect
          {...fogDraft}
          fill={visual.color.fogDraft}
          opacity={visual.opacity.fogDraft}
          stroke={visual.color.editHighlight}
          strokeWidth={2 / scale}
        />
      )}
      {brushPoints.length === 1 && (
        <Circle
          x={brushPoints[0]!.x}
          y={brushPoints[0]!.y}
          radius={props.fogBrushRadius ?? 40}
          fill={visual.color.fogDraft}
          opacity={visual.opacity.fogDraft}
          stroke={visual.color.editHighlight}
          strokeWidth={2 / scale}
        />
      )}
      {brushPoints.length > 1 && (
        <Line
          points={brushPoints.flatMap((point) => [point.x, point.y])}
          stroke={visual.color.fogDraft}
          opacity={visual.opacity.fogDraft}
          strokeWidth={(props.fogBrushRadius ?? 40) * 2}
          lineCap="round"
          lineJoin="round"
        />
      )}
      {isPolygonTool && polygonPoints.length > 0 && (
        <>
          <Line
            points={[
              ...polygonPoints.flatMap((point) => [point.x, point.y]),
              ...(polygonPreview ? [polygonPreview.x, polygonPreview.y] : []),
            ]}
            closed={polygonPoints.length >= 2 && Boolean(polygonPreview)}
            stroke={visual.color.editHighlight}
            strokeWidth={2 / scale}
            fill={polygonPoints.length >= 2 ? visual.color.fogDraft : undefined}
            opacity={visual.opacity.fogDraft}
          />
          {polygonPoints.map((point, index) => (
            <Circle
              key={index}
              x={point.x}
              y={point.y}
              radius={4 / scale}
              fill={visual.color.editHighlight}
            />
          ))}
        </>
      )}
    </Layer>
  );
  const selectedResizeToken =
    props.role === "GM" && props.tool === "PAN" && selectedTokenIds.length === 1
      ? (selectableObjects.tokens.find(
          (token) => token.id === selectedTokenIds[0],
        ) ?? null)
      : null;
  const resizeHandleData = resolveResizeHandleDataAttributes({
    enabled: selectedResizeToken !== null,
    token: selectedResizeToken,
    resizeDraft: selectedResizeToken
      ? resizeDrafts[selectedResizeToken.id]
      : undefined,
    dragPosition: selectedResizeToken
      ? dragPositions[selectedResizeToken.id]
      : undefined,
    stagePosition: position,
    scale,
  });
  // UIX-426: the same list the single token layer used to render. Split out
  // so it can be drawn in two passes with the fog layer between them.
  const tokensOnStage = props.tokens
    .filter((token) => token.layer !== "MAP")
    .filter(
      (token) => token.layer !== "GM" || (props.role === "GM" && showGmLayer),
    )
    .filter((token) => token.visible || props.role === "GM")
    .filter(
      (token) =>
        props.role === "GM" ||
        (token.x + token.width > 0 &&
          token.y + token.height > 0 &&
          token.x < worldDraft.width &&
          token.y < worldDraft.height),
    )
    .filter((token) => !hiddenTokenIds.has(token.id))
    .sort((a, b) => (a.layer === "PLAYER" ? -1 : b.layer === "PLAYER" ? 1 : 0));

  /** A player always sees their own token, even deep in unexplored fog. */
  const ownsToken = (token: (typeof tokensOnStage)[number]) =>
    token.controllerMembershipIds.includes(props.membershipId);

  const renderTokenNode = (sourceToken: (typeof tokensOnStage)[number]) => {
    const token = resizeDrafts[sourceToken.id]
      ? { ...sourceToken, ...resizeDrafts[sourceToken.id] }
      : sourceToken;
    const canMove = canMoveMapToken({
      tool: props.tool,
      role: props.role,
      locked: token.locked,
      membershipId: props.membershipId,
      controllerMembershipIds: token.controllerMembershipIds,
    });
    const url = assetUrl(token.assetId);
    const dragPosition = dragPositions[token.id];
    const tokenStack =
      tokenStacks[
        gridCellKey(dragPosition?.x ?? token.x, dragPosition?.y ?? token.y)
      ];
    const isStackRepresentative =
      tokenStack?.representativeId === token.id && tokenStack.count > 1;
    const imageMask = getTokenImageMask(token.width, token.height);
    const common = {
      x: 0,
      y: 0,
      width: token.width,
      height: token.height,
      rotation: token.rotation,
      draggable: false,
      opacity: token.layer === "GM" ? 0.45 : token.visible ? 1 : 0.45,
      onDragMove: () => undefined,
      onDragEnd: () => undefined,
    };
    const onDragMove = (event: Konva.KonvaEventObject<DragEvent>) => {
      if (!isDirectTokenDrag(event.target, event.currentTarget)) return;
      setDragPositions((current) => ({
        ...current,
        [token.id]: {
          x: event.target.x(),
          y: event.target.y(),
          revision: token.revision,
        },
      }));
      props.socket?.emit("token:moving", {
        actionId: crypto.randomUUID(),
        tokenId: token.id,
        x: event.target.x(),
        y: event.target.y(),
        z: token.z,
        levelId: token.levelId,
        revision: token.revision,
      });
    };
    const onDragEnd = (event: Konva.KonvaEventObject<DragEvent>) => {
      if (!isDirectTokenDrag(event.target, event.currentTarget)) return;
      const x = snap(event.target.x());
      const y = snap(event.target.y());
      if (
        selectedTokenIds.includes(token.id) &&
        selectedTokenIds.length + selectedDrawingIds.length > 1 &&
        props.onBulkMove
      ) {
        event.target.position({ x, y });
        enqueueMove({ x: x - token.x, y: y - token.y });
        return;
      }
      event.target.position({ x, y });
      setDragPositions((current) => ({
        ...current,
        [token.id]: { x, y, revision: token.revision },
      }));
      props.socket?.emit(
        "token:moved",
        {
          actionId: crypto.randomUUID(),
          tokenId: token.id,
          x,
          y,
          z: token.z,
          levelId: token.levelId,
          revision: token.revision,
        },
        (ack) => {
          if (!ack.ok) {
            setDragPositions((current) => {
              const next = { ...current };
              delete next[token.id];
              return next;
            });
            props.socket?.emit("game:resync", ack.sequence);
          }
        },
      );
    };
    return (
      <Group
        key={token.id}
        x={dragPosition?.x ?? token.x}
        y={dragPosition?.y ?? token.y}
        draggable={canMove}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onMouseEnter={() => setHoveredTokenId(token.id)}
        onMouseLeave={() => setHoveredTokenId(null)}
        onClick={(event) => {
          if (
            event.evt.button !== 0 ||
            !canSelectToken(token, {
              role: props.role,
              membershipId: props.membershipId,
              fogReveals: orderedFogReveals,
              world: worldDraft,
              showGmLayer,
            })
          )
            return;
          selectObject({
            kind: "token",
            objectId: token.id,
            revision: token.revision,
          });
        }}
        onContextMenu={(event) => {
          event.evt.preventDefault();
          event.cancelBubble = true;
          // Right drag pans only from empty canvas; on a token it
          // consistently opens the contextual actions.
          if (props.role !== "GM") return;
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          setTokenMenu({
            token,
            x: event.evt.clientX - rect.left,
            y: event.evt.clientY - rect.top,
          });
        }}
      >
        {selectedTokenIds.includes(token.id) && (
          <Rect
            x={-4 / scale}
            y={-4 / scale}
            width={token.width + 8 / scale}
            height={token.height + 8 / scale}
            stroke={visual.color.selection}
            strokeWidth={2 / scale}
            dash={[6 / scale, 3 / scale]}
            listening={false}
          />
        )}
        {isStackRepresentative && (
          <Circle
            x={token.width / 2}
            y={token.height / 2}
            radius={Math.max(token.width, token.height) / 2 + 5}
            stroke={visual.color.attention}
            strokeWidth={3 / scale}
            dash={[5 / scale, 4 / scale]}
            listening={false}
          />
        )}
        {url ? (
          <>
            <Group
              clipFunc={(context) => {
                context.arc(
                  imageMask.centerX,
                  imageMask.centerY,
                  imageMask.radius,
                  0,
                  Math.PI * 2,
                  false,
                );
              }}
            >
              <TokenImage
                src={url}
                tokenId={token.id}
                onAvailabilityChange={setTokenImageAvailability}
                onUnmount={removeTokenImageAvailability}
                {...common}
              />
            </Group>
            <Circle
              x={imageMask.centerX}
              y={imageMask.centerY}
              radius={imageMask.radius}
              stroke={token.frameColor ?? visual.color.tokenFrameDefault}
              strokeWidth={(token.frameColor ? 3 : 2) / scale}
              listening={false}
            />
          </>
        ) : (
          <Group {...common}>
            <Circle
              x={token.width / 2}
              y={token.height / 2}
              radius={Math.min(token.width, token.height) / 2}
              fill={token.baseColor}
              stroke={token.frameColor ?? visual.color.tokenFrameDefault}
              strokeWidth={2}
            />
            <Text
              text={token.name.slice(0, 2).toUpperCase()}
              width={token.width}
              height={token.height}
              align="center"
              verticalAlign="middle"
              fill={visual.color.tokenLabel}
              fontSize={Math.max(12, token.width / 3)}
            />
          </Group>
        )}
        <Text
          x={-16}
          y={token.height + 5}
          width={token.width + 32}
          align="center"
          text={`${token.name}${
            isStackRepresentative ? ` +${tokenStack!.count - 1}` : ""
          }`}
          fill={visual.color.tokenName}
          fontSize={13}
          listening={false}
          visible={
            hoveredTokenId === token.id || canMove || isStackRepresentative
          }
        />
        {props.role === "GM" &&
          props.tool === "PAN" &&
          selectedTokenIds.length === 1 &&
          selectedTokenIds[0] === token.id && (
            <Circle
              x={token.width}
              y={token.height}
              radius={7 / scale}
              fill={visual.color.selection}
              stroke={visual.color.selectionOutline}
              strokeWidth={1 / scale}
              draggable
              onMouseDown={(event) => {
                event.cancelBubble = true;
              }}
              onDragMove={(event) => {
                event.cancelBubble = true;
                const aspect = token.width / token.height;
                const width = Math.max(16, event.target.x());
                const height = Math.max(16, width / aspect);
                setResizeDrafts((current) => ({
                  ...current,
                  [token.id]: {
                    width,
                    height,
                    revision: token.revision,
                  },
                }));
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true;
                const width = Math.round(Math.max(16, event.target.x()));
                const height = Math.round(width / (token.width / token.height));

                const expected = {
                  width,
                  height,
                  revision: token.revision,
                };
                const request = props.onTokenResize?.(
                  token.id,
                  token.revision,
                  { width, height },
                );
                if (!request) {
                  setResizeDrafts((current) =>
                    clearSettledTokenResizeDraft(current, token.id, expected),
                  );
                  return;
                }
                void request
                  .then(() =>
                    setResizeDrafts((current) =>
                      clearSettledTokenResizeDraft(current, token.id, expected),
                    ),
                  )
                  .catch(() =>
                    setResizeDrafts((current) =>
                      clearSettledTokenResizeDraft(current, token.id, expected),
                    ),
                  );
              }}
            />
          )}
      </Group>
    );
  };

  return (
    <div
      className="map-viewport"
      data-token-image-states={tokenImageStateAttribute}
      {...(resizeHandleData ?? {})}
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label="Интерактивная карта сцены"
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - 0 F O V D R P G Shift+G B Shift+B L Shift+L Enter Delete Escape"
      onPointerDownCapture={(event) => {
        if (
          props.tool !== "DRAW" ||
          drawingActiveRef.current ||
          !(event.target instanceof HTMLCanvasElement)
        )
          return;
        stageRef.current?.setPointersPositions(event.nativeEvent);
        const point = pointerInWorld();
        if (!point) return;
        const bounded = clampToWorld(point);
        const points = [bounded.x, bounded.y];
        drawingActiveRef.current = true;
        drawingPointsRef.current = points;
        setDrawingPoints(points);
      }}
      onFocus={() => dispatchInteraction({ type: "focus" })}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          dispatchInteraction({ type: "blur" });
      }}
      onKeyDown={handleMapKeyDown}
      onDragOver={(event) => {
        if (
          props.tool === "PAN" &&
          event.dataTransfer.types.includes(
            "application/x-arken-token-definition",
          )
        )
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (props.tool !== "PAN") return;
        const definitionId = event.dataTransfer.getData(
          "application/x-arken-token-definition",
        );
        if (!definitionId || !props.onPlaceTokenDefinition) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        void props.onPlaceTokenDefinition(
          definitionId,
          mapWorldPointFromDrop({
            clientX: event.clientX,
            clientY: event.clientY,
            containerRect: rect,
            pan: position,
            scale,
          }),
        );
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="map-object-list-trigger"
        onClick={() => dispatchInteraction({ type: "open-object-list" })}
      >
        Объекты карты
      </button>
      {interaction.objectListOpen && (
        <div
          ref={objectListRef}
          className="map-object-list-popover"
          role="region"
          aria-label={"Объекты карты"}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ul className="map-object-list">
            {selectableObjects.tokens.map((token) => {
              const dragPosition = dragPositions[token.id];
              const stack =
                objectListTokenStacks[
                  gridCellKey(
                    dragPosition?.x ?? token.x,
                    dragPosition?.y ?? token.y,
                  )
                ];
              const label =
                props.role === "GM" &&
                stack?.representativeId === token.id &&
                stack.count > 1
                  ? `${token.name} · стопка ${stack.count}`
                  : token.name;
              return (
                <li key={`token:${token.id}:${token.revision}`}>
                  <button
                    type="button"
                    aria-pressed={
                      interaction.selectedObject?.kind === "token" &&
                      interaction.selectedObject.objectId === token.id
                    }
                    onClick={() =>
                      selectObject({
                        kind: "token",
                        objectId: token.id,
                        revision: token.revision,
                      })
                    }
                  >
                    {label}
                  </button>
                  <button
                    className="map-object-list__action"
                    type="button"
                    aria-label={`Дублировать: ${token.name}`}
                    title={"Дублировать"}
                    onClick={() =>
                      void props.onPlaceTokenDefinition?.(token.definitionId, {
                        x:
                          token.x +
                          (props.scene.grid.enabled
                            ? props.scene.grid.size
                            : 32),
                        y:
                          token.y +
                          (props.scene.grid.enabled
                            ? props.scene.grid.size
                            : 32),
                      })
                    }
                  >
                    {"\u2398"}
                  </button>
                  <button
                    className="map-object-list__action"
                    type="button"
                    aria-label={`Удалить: ${token.name}`}
                    title={"Удалить"}
                    onClick={() =>
                      requestDelete({
                        kind: "token",
                        objectId: token.id,
                        revision: token.revision,
                      })
                    }
                  >
                    {"\u00d7"}
                  </button>
                </li>
              );
            })}
            {selectableObjects.drawings.map((drawing, index) => {
              const canCopy =
                props.role === "GM" ||
                drawing.authorMembershipId === props.membershipId;
              const label = `Рисунок ${index + 1}`;
              return (
                <li key={`drawing:${drawing.id}:${drawing.revision}`}>
                  <button
                    type="button"
                    aria-pressed={
                      interaction.selectedObject?.kind === "drawing" &&
                      interaction.selectedObject.objectId === drawing.id
                    }
                    onClick={() =>
                      selectObject({
                        kind: "drawing",
                        objectId: drawing.id,
                        revision: drawing.revision,
                      })
                    }
                  >
                    {label}
                  </button>
                  <button
                    className="map-object-list__action"
                    type="button"
                    disabled={!canCopy}
                    aria-label={`Дублировать: ${label}`}
                    title={"Дублировать"}
                    onClick={() =>
                      void props.onDrawingCopy?.(drawing.id, drawing.revision)
                    }
                  >
                    {"\u2398"}
                  </button>
                  <button
                    className="map-object-list__action"
                    type="button"
                    disabled={!canCopy}
                    aria-label={`Удалить: ${label}`}
                    title={"Удалить"}
                    onClick={() =>
                      requestDelete({
                        kind: "drawing",
                        objectId: drawing.id,
                        revision: drawing.revision,
                      })
                    }
                  >
                    {"\u00d7"}
                  </button>
                </li>
              );
            })}
            {selectableObjects.tokens.length +
              selectableObjects.drawings.length ===
              0 && <li>{"На карте пока нет объектов."}</li>}
          </ul>
        </div>
      )}
      <Stage
        ref={stageRef}
        width={viewport.width}
        height={viewport.height}
        x={position.x}
        y={position.y}
        scaleX={scale}
        scaleY={scale}
        draggable={false}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
        onDblClick={() => void handlePolygonComplete()}
      >
        <Layer
          clipX={0}
          clipY={0}
          clipWidth={worldDraft.width}
          clipHeight={worldDraft.height}
        >
          <Rect
            width={worldDraft.width}
            height={worldDraft.height}
            fill="rgba(0, 0, 0, 0.001)"
            name="map-interaction-hit-plane"
          />
          <Rect
            width={worldDraft.width}
            height={worldDraft.height}
            fill={visual.color.mapBackdrop}
            listening={false}
          />
          {mapImage && (
            <Image
              image={mapImage}
              x={backgroundDraft.x}
              y={backgroundDraft.y}
              width={backgroundDraft.width}
              height={backgroundDraft.height}
              listening={false}
            />
          )}
          {props.scene.grid.enabled &&
            (props.role !== "GM" || props.gmGridVisible !== false) && (
              <Grid
                width={worldDraft.width}
                height={worldDraft.height}
                {...props.scene.grid}
              />
            )}
        </Layer>

        {props.role === "GM" &&
          props.tool === "PAN" &&
          props.canvasEditMode && (
            <Layer>
              {props.canvasEditMode === "BACKGROUND" ? (
                <Group>
                  <Rect
                    {...backgroundDraft}
                    stroke={visual.color.edit}
                    strokeWidth={2 / scale}
                    dash={[8 / scale, 5 / scale]}
                    draggable
                    onDragMove={(event) =>
                      setBackgroundDraft((current) => ({
                        ...current,
                        x: event.target.x(),
                        y: event.target.y(),
                      }))
                    }
                    onDragEnd={() =>
                      void props.onCanvasPatch?.({
                        backgroundFrame: backgroundDraft,
                      })
                    }
                  />
                  {(["nw", "ne", "sw", "se"] as const).map((corner) => {
                    const left = corner.endsWith("w");
                    const top = corner.startsWith("n");
                    return (
                      <Circle
                        key={corner}
                        x={
                          left
                            ? backgroundDraft.x
                            : backgroundDraft.x + backgroundDraft.width
                        }
                        y={
                          top
                            ? backgroundDraft.y
                            : backgroundDraft.y + backgroundDraft.height
                        }
                        radius={7 / scale}
                        fill={visual.color.edit}
                        draggable
                        onDragMove={(event) => {
                          const oppositeX = left
                            ? backgroundDraft.x + backgroundDraft.width
                            : backgroundDraft.x;
                          const oppositeY = top
                            ? backgroundDraft.y + backgroundDraft.height
                            : backgroundDraft.y;
                          let width = Math.max(
                            16,
                            Math.abs(event.target.x() - oppositeX),
                          );
                          let height = Math.max(
                            16,
                            Math.abs(event.target.y() - oppositeY),
                          );
                          if (lockAspect) {
                            const ratio =
                              props.scene.backgroundFrame.width /
                              props.scene.backgroundFrame.height;
                            if (width / height > ratio) height = width / ratio;
                            else width = height * ratio;
                          }
                          setBackgroundDraft({
                            x: left ? oppositeX - width : oppositeX,
                            y: top ? oppositeY - height : oppositeY,
                            width,
                            height,
                          });
                        }}
                        onDragEnd={() =>
                          void props.onCanvasPatch?.({
                            backgroundFrame: backgroundDraft,
                          })
                        }
                      />
                    );
                  })}
                </Group>
              ) : (
                <Group>
                  <Rect
                    x={0}
                    y={0}
                    width={worldDraft.width}
                    height={worldDraft.height}
                    stroke={visual.color.selection}
                    strokeWidth={2 / scale}
                    dash={[8 / scale, 5 / scale]}
                  />
                  <Circle
                    x={worldDraft.width}
                    y={worldDraft.height}
                    radius={8 / scale}
                    fill={visual.color.selection}
                    draggable
                    onDragMove={(event) =>
                      setWorldDraft({
                        width: Math.max(320, Math.round(event.target.x())),
                        height: Math.max(320, Math.round(event.target.y())),
                      })
                    }
                    onDragEnd={() =>
                      void props.onCanvasPatch?.({ world: worldDraft })
                    }
                  />
                </Group>
              )}
            </Layer>
          )}

        <Layer {...playerClip}>
          {props.tokens
            .filter((token) => token.layer === "MAP")
            .filter((token) => props.role === "GM" || token.visible)
            .map((token) => (
              <Group
                key={token.id}
                x={token.x}
                y={token.y}
                listening={props.role === "GM" && props.tool === "PAN"}
                onClick={() => {
                  selectObject({
                    kind: "token",
                    objectId: token.id,
                    revision: token.revision,
                  });
                }}
                onContextMenu={(event) => {
                  event.evt.preventDefault();
                  event.cancelBubble = true;
                  if (props.role !== "GM") return;
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  selectObject({
                    kind: "token",
                    objectId: token.id,
                    revision: token.revision,
                  });
                  setTokenMenu({
                    token,
                    x: event.evt.clientX - rect.left,
                    y: event.evt.clientY - rect.top,
                  });
                }}
              >
                {selectedTokenIds.includes(token.id) && (
                  <Rect
                    x={-4 / scale}
                    y={-4 / scale}
                    width={token.width + 8 / scale}
                    height={token.height + 8 / scale}
                    stroke={visual.color.selection}
                    strokeWidth={2 / scale}
                    dash={[6 / scale, 3 / scale]}
                    listening={false}
                  />
                )}
                {assetUrl(token.assetId) ? (
                  <>
                    <TokenImage
                      src={assetUrl(token.assetId)!}
                      tokenId={token.id}
                      onAvailabilityChange={setTokenImageAvailability}
                      onUnmount={removeTokenImageAvailability}
                      x={0}
                      y={0}
                      width={token.width}
                      height={token.height}
                      rotation={token.rotation}
                      draggable={false}
                      onDragMove={() => undefined}
                      onDragEnd={() => undefined}
                    />
                    {token.frameColor && (
                      <Rect
                        width={token.width}
                        height={token.height}
                        stroke={token.frameColor}
                        strokeWidth={3 / scale}
                        listening={false}
                      />
                    )}
                  </>
                ) : (
                  <Circle
                    radius={Math.min(token.width, token.height) / 2}
                    x={token.width / 2}
                    y={token.height / 2}
                    fill={token.baseColor}
                    stroke={token.frameColor ?? undefined}
                    strokeWidth={token.frameColor ? 3 / scale : 0}
                  />
                )}
                {props.role === "GM" &&
                  props.tool === "PAN" &&
                  selectedTokenIds.length === 1 &&
                  selectedTokenIds[0] === token.id && (
                    <Circle
                      x={token.width}
                      y={token.height}
                      radius={7 / scale}
                      fill={visual.color.selection}
                      stroke={visual.color.selectionOutline}
                      strokeWidth={1 / scale}
                      draggable
                      onMouseDown={(event) => {
                        event.cancelBubble = true;
                      }}
                      onDragMove={(event) => {
                        const aspect = token.width / token.height;
                        const width = Math.max(16, event.target.x());
                        const height = Math.max(16, width / aspect);
                        event.target.position({ x: width, y: height });
                        event.target
                          .getParent()
                          ?.getChildren()
                          .filter((child) => child !== event.target)
                          .forEach((child) =>
                            child.scale({
                              x: width / token.width,
                              y: height / token.height,
                            }),
                          );
                      }}
                      onDragEnd={(event) => {
                        const width = Math.round(
                          Math.max(16, event.target.x()),
                        );
                        event.target
                          .getParent()
                          ?.getChildren()
                          .filter((child) => child !== event.target)
                          .forEach((child) => child.scale({ x: 1, y: 1 }));
                        event.target.position({
                          x: token.width,
                          y: token.height,
                        });
                        void props.onTokenResize?.(token.id, token.revision, {
                          width,
                          height: Math.round(
                            width / (token.width / token.height),
                          ),
                        });
                      }}
                    />
                  )}
              </Group>
            ))}
        </Layer>

        <Layer {...playerClip}>
          {props.drawings.map((drawing) => {
            const currentStrokeWidth = drawing.strokeWidth ?? 3;
            return (
              <Line
                key={drawing.id}
                points={drawing.points}
                x={drawing.x}
                y={drawing.y}
                stroke={drawing.color}
                strokeWidth={currentStrokeWidth / scale}
                lineCap="round"
                lineJoin="round"
                listening={
                  (props.role === "GM" ||
                    (Boolean(props.membershipId) &&
                      drawing.authorMembershipId === props.membershipId)) &&
                  (props.role === "GM" || revealedDrawingIds.has(drawing.id))
                }
                draggable={
                  props.tool === "PAN" &&
                  (props.role === "GM" ||
                    (Boolean(props.membershipId) &&
                      drawing.authorMembershipId === props.membershipId)) &&
                  (props.role === "GM" || revealedDrawingIds.has(drawing.id))
                }
                hitStrokeWidth={Math.max(14, currentStrokeWidth) / scale}
                shadowColor={
                  selectedDrawingIds.includes(drawing.id)
                    ? visual.color.selection
                    : undefined
                }
                shadowBlur={
                  selectedDrawingIds.includes(drawing.id) ? 10 / scale : 0
                }
                onClick={() => {
                  selectObject({
                    kind: "drawing",
                    objectId: drawing.id,
                    revision: drawing.revision,
                  });
                }}
                onDragEnd={(event) => {
                  if (
                    selectedDrawingIds.includes(drawing.id) &&
                    selectedTokenIds.length + selectedDrawingIds.length > 1 &&
                    props.onBulkMove
                  ) {
                    enqueueMove({
                      x: event.target.x() - drawing.x,
                      y: event.target.y() - drawing.y,
                    });
                    return;
                  }
                  void props.onDrawingUpdate?.(drawing.id, drawing.revision, {
                    x: event.target.x(),
                    y: event.target.y(),
                  });
                }}
              />
            );
          })}
          {pendingDrawings
            .filter(
              (pending) =>
                !props.drawings.some(
                  (drawing) =>
                    drawing.points.length === pending.points.length &&
                    drawing.points.every(
                      (value, index) => value === pending.points[index],
                    ),
                ),
            )
            .map((pending) => (
              <Line
                key={pending.tempId}
                points={pending.points}
                stroke={pending.color}
                strokeWidth={pending.strokeWidth / scale}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            ))}
          {drawingPoints.length >= 4 && (
            <Line
              points={drawingPoints}
              stroke={drawingColor}
              strokeWidth={drawingStrokeWidth / scale}
              lineCap="round"
              lineJoin="round"
            />
          )}
        </Layer>

        {marquee && (
          <Layer listening={false}>
            <Rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.width}
              height={marquee.height}
              fill={visual.color.selection}
              opacity={visual.opacity.marqueeFill}
              stroke={visual.color.selection}
              strokeWidth={1 / scale}
              dash={[6 / scale, 4 / scale]}
            />
          </Layer>
        )}

        {regionDraft && (
          <Layer listening={false}>
            <Rect
              x={regionDraft.x}
              y={regionDraft.y}
              width={regionDraft.width}
              height={regionDraft.height}
              fill={visual.color.encounterRegionDraft}
              opacity={visual.opacity.fogDraft}
              stroke={visual.color.encounterRegionDraft}
              strokeWidth={2 / scale}
              dash={[6 / scale, 4 / scale]}
            />
          </Layer>
        )}

        {props.role === "GM" && renderFog()}

        {props.role === "GM" ? (
          <Layer {...playerClip}>{tokensOnStage.map(renderTokenNode)}</Layer>
        ) : (
          <>
            {/* UIX-426: fog must occlude what it covers, so everyone else's
                tokens are drawn under it and only the emerged part shows. */}
            <Layer {...playerClip}>
              {tokensOnStage
                .filter((token) => !ownsToken(token))
                .map(renderTokenNode)}
            </Layer>
            {renderFog()}
            <Layer {...playerClip}>
              {tokensOnStage.filter(ownsToken).map(renderTokenNode)}
            </Layer>
          </>
        )}

        <Layer listening={false}>
          {displayRulers.map((ruler) => {
            // UIX-381: `points` is the committed waypoints plus (while a
            // local drag is live) the in-progress segment following the
            // pointer. A lone point (drag just started, no movement yet) has
            // nothing to draw a segment with, so it renders as just the
            // start marker.
            const points = ruler.points;
            if (points.length < 2) {
              const only = points[0];
              return only ? (
                <Circle
                  key={ruler.membershipId}
                  x={only.x}
                  y={only.y}
                  radius={4 / scale}
                  fill={visual.color.selection}
                />
              ) : null;
            }
            const gridEnabled = props.scene.grid.enabled;
            const unitSuffix = gridEnabled ? " кл." : " px (без сетки)";
            const labelText = `${ruler.displayName}: ${ruler.distance.toFixed(1)}${unitSuffix}`;
            const estimatedWidth = Math.max(50, labelText.length * 8 + 12);
            const first = points[0]!;
            const last = points[points.length - 1]!;
            const beforeLast = points[points.length - 2]!;
            return (
              <Group key={ruler.membershipId}>
                {points.length > 2 && (
                  <Line
                    points={points
                      .slice(0, -1)
                      .flatMap((point) => [point.x, point.y])}
                    stroke={visual.color.selection}
                    strokeWidth={2.5 / scale}
                    dash={[6 / scale, 4 / scale]}
                    lineJoin="round"
                  />
                )}
                <Arrow
                  points={[beforeLast.x, beforeLast.y, last.x, last.y]}
                  stroke={visual.color.selection}
                  fill={visual.color.selection}
                  strokeWidth={2.5 / scale}
                  dash={[6 / scale, 4 / scale]}
                  pointerLength={10 / scale}
                  pointerWidth={10 / scale}
                />
                <Circle
                  x={first.x}
                  y={first.y}
                  radius={4 / scale}
                  fill={visual.color.selection}
                />
                {points.slice(1, -1).map((waypoint, index) => (
                  <Circle
                    key={index}
                    x={waypoint.x}
                    y={waypoint.y}
                    radius={3 / scale}
                    fill={visual.color.selection}
                  />
                ))}
                <Group x={last.x + 8 / scale} y={last.y - 14 / scale}>
                  <Rect
                    x={-4 / scale}
                    y={-2 / scale}
                    width={estimatedWidth / scale}
                    height={20 / scale}
                    fill="#0f172a"
                    opacity={0.85}
                    cornerRadius={4 / scale}
                  />
                  <Text
                    text={labelText}
                    fill="#f8fafc"
                    fontSize={13 / scale}
                    fontStyle="bold"
                  />
                </Group>
              </Group>
            );
          })}
          {props.pings.map((ping) => (
            <Group key={`${ping.membershipId}-${ping.createdAt}`}>
              <Circle
                x={ping.x}
                y={ping.y}
                radius={22 / scale}
                stroke={visual.color.edit}
                strokeWidth={3 / scale}
              />
              <Text
                x={ping.x + 28 / scale}
                y={ping.y - 8 / scale}
                text={ping.displayName}
                fill={visual.color.edit}
                fontSize={14 / scale}
              />
            </Group>
          ))}
          {props.cursors.map((cursor) => {
            const color = cursorColorForMembership(cursor.membershipId);
            const labelWidth = Math.max(40, cursor.displayName.length * 7 + 12);
            return (
              <Group key={cursor.membershipId}>
                <Circle
                  x={cursor.x}
                  y={cursor.y}
                  radius={6 / scale}
                  fill={color}
                  stroke="#0f172a"
                  strokeWidth={1.5 / scale}
                />
                <Group x={cursor.x + 10 / scale} y={cursor.y - 10 / scale}>
                  <Rect
                    x={-4 / scale}
                    y={-2 / scale}
                    width={labelWidth / scale}
                    height={18 / scale}
                    fill="#0f172a"
                    opacity={0.85}
                    cornerRadius={4 / scale}
                  />
                  <Text
                    text={cursor.displayName}
                    fill={color}
                    fontSize={12 / scale}
                    fontStyle="bold"
                  />
                </Group>
              </Group>
            );
          })}
        </Layer>
      </Stage>
      {tokenMenu && (
        <div
          ref={tokenMenuRef}
          className="token-context-menu"
          style={{ left: tokenMenu.x, top: tokenMenu.y }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <strong>{tokenMenu.token.name}</strong>
          {tokenMenu.token.characterId && props.onOpenCharacter && (
            <button
              role="menuitem"
              onClick={() => {
                props.onOpenCharacter?.(tokenMenu.token.characterId!);
                setTokenMenu(null);
              }}
            >
              Открыть карточку
            </button>
          )}
          {(
            [
              ["MAP", "Слой карты"],
              ["PLAYER", "Игровой слой"],
              ["GM", "Слой мастера"],
            ] as const
          ).map(([layer, label]) => (
            <button
              role="menuitemradio"
              aria-checked={tokenMenu.token.layer === layer}
              key={layer}
              onClick={() => {
                if (tokenMenu.token.layer !== layer)
                  void props.onTokenLayerChange?.(
                    tokenMenu.token.id,
                    tokenMenu.token.revision,
                    layer,
                  );
                setTokenMenu(null);
              }}
            >
              {tokenMenu.token.layer === layer ? "✓ " : ""}
              {label}
            </button>
          ))}
          <label>
            Цвет
            <input
              type="color"
              value={tokenMenu.token.baseColor}
              onChange={(event) => {
                setTokenMenu(null);
                void props.onTokenAppearanceChange?.(
                  tokenMenu.token.id,
                  tokenMenu.token.revision,
                  {
                    baseColor: event.target.value,
                    frameColor: tokenMenu.token.frameColor,
                  },
                );
              }}
            />
          </label>
          <label>
            Рамка
            <input
              type="color"
              value={
                tokenMenu.token.frameColor ?? visual.color.tokenFrameDefault
              }
              onChange={(event) => {
                setTokenMenu(null);
                void props.onTokenAppearanceChange?.(
                  tokenMenu.token.id,
                  tokenMenu.token.revision,
                  {
                    baseColor: tokenMenu.token.baseColor,
                    frameColor: event.target.value,
                  },
                );
              }}
            />
            <button
              type="button"
              onClick={() => {
                setTokenMenu(null);
                void props.onTokenAppearanceChange?.(
                  tokenMenu.token.id,
                  tokenMenu.token.revision,
                  { baseColor: tokenMenu.token.baseColor, frameColor: null },
                );
              }}
            >
              Без рамки
            </button>
          </label>
          <button
            role="menuitem"
            onClick={() => {
              requestDelete({
                kind: "token",
                objectId: tokenMenu.token.id,
                revision: tokenMenu.token.revision,
              });
              setTokenMenu(null);
            }}
          >
            Удалить с карты
          </button>
          <button onClick={() => setTokenMenu(null)}>Отмена</button>
        </div>
      )}
      <ConfirmDialog
        open={interaction.deleteRequestedFor !== null}
        title="Удалить объект с карты?"
        message="Это действие нельзя отменить."
        onClose={() => dispatchInteraction({ type: "cancel-delete" })}
        onConfirm={() => dispatchInteraction({ type: "confirm-delete" })}
      />
      {props.canvasEditMode === "BACKGROUND" && (
        <label className="aspect-lock">
          <input
            type="checkbox"
            checked={lockAspect}
            onChange={(event) => setLockAspect(event.target.checked)}
          />
          Сохранять пропорции
        </label>
      )}
      {(() => {
        const drawing = props.drawings.find(
          (item) => item.id === selectedDrawingId,
        );
        const canEditDrawing =
          drawing &&
          (props.role === "GM" ||
            (!!props.membershipId &&
              drawing.authorMembershipId === props.membershipId));
        if (!canEditDrawing && props.tool !== "DRAW") return null;

        const activeColor = canEditDrawing ? drawing.color : drawingColor;
        const activeWidth = canEditDrawing
          ? (drawing.strokeWidth ?? 3)
          : drawingStrokeWidth;

        const updateColor = (color: string) => {
          setDrawingColor(color);
          if (canEditDrawing) {
            if (drawingColorUpdateTimeoutRef.current !== null) {
              window.clearTimeout(drawingColorUpdateTimeoutRef.current);
            }
            // Debounced: a native color/range input fires onChange on every
            // pointer tick, and each call would otherwise PATCH with the same
            // stale `drawing.revision` faster than the prior request's ack
            // can update it, producing a storm of 409 DRAWING_CONFLICT.
            drawingColorUpdateTimeoutRef.current = window.setTimeout(() => {
              void props.onDrawingUpdate?.(drawing.id, drawing.revision, {
                color,
              });
            }, 200);
          }
        };

        const updateWidth = (strokeWidth: number) => {
          const clamped = Math.max(1, Math.min(100, strokeWidth));
          setDrawingStrokeWidth(clamped);
          if (canEditDrawing) {
            if (drawingWidthUpdateTimeoutRef.current !== null) {
              window.clearTimeout(drawingWidthUpdateTimeoutRef.current);
            }
            drawingWidthUpdateTimeoutRef.current = window.setTimeout(() => {
              void props.onDrawingUpdate?.(drawing.id, drawing.revision, {
                strokeWidth: clamped,
              });
            }, 200);
          }
        };

        return (
          <aside
            className="drawing-color-panel"
            aria-label="Панель параметров рисунка"
          >
            <span className="drawing-color-controls">
              <span className="drawing-control-group">
                <label className="drawing-control-label">Цвет</label>
                <span
                  className="drawing-color-presets"
                  role="group"
                  aria-label="Готовые цвета"
                >
                  {DRAWING_COLOR_PRESETS.map(({ value, name }) => (
                    <button
                      key={value}
                      type="button"
                      className="drawing-color-swatch"
                      aria-label={`${name}: ${value}`}
                      aria-pressed={activeColor === value}
                      style={{ backgroundColor: value }}
                      onClick={() => updateColor(value)}
                    />
                  ))}
                </span>
                <label className="drawing-color-picker">
                  <span>Цвет</span>
                  <input
                    type="color"
                    aria-label="Цвет рисунка"
                    value={activeColor}
                    onChange={(event) => updateColor(event.target.value)}
                  />
                </label>
              </span>

              <span className="drawing-control-group">
                <label className="drawing-control-label">
                  Толщина: <strong>{activeWidth}px</strong>
                </label>
                <span
                  className="drawing-width-presets"
                  role="group"
                  aria-label="Быстрый выбор толщины"
                >
                  {DRAWING_STROKE_WIDTH_PRESETS.map((width) => (
                    <button
                      key={width}
                      type="button"
                      className="drawing-width-preset-btn"
                      aria-label={`Толщина ${width}px`}
                      aria-pressed={activeWidth === width}
                      onClick={() => updateWidth(width)}
                    >
                      <span
                        className="drawing-width-preview"
                        style={{ height: Math.min(width, 14) }}
                      />
                      <span className="drawing-width-label">{width}</span>
                    </button>
                  ))}
                </span>
                <label className="drawing-stroke-width-picker">
                  <input
                    type="range"
                    min="1"
                    max="50"
                    step="1"
                    aria-label="Толщина линии"
                    value={activeWidth}
                    onChange={(event) =>
                      updateWidth(Number(event.target.value))
                    }
                  />
                </label>
              </span>

              {canEditDrawing && (
                <span className="drawing-panel-actions">
                  <button
                    type="button"
                    onClick={() =>
                      void props.onDrawingCopy?.(drawing.id, drawing.revision)
                    }
                  >
                    Копировать
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      requestDelete({
                        kind: "drawing",
                        objectId: drawing.id,
                        revision: drawing.revision,
                      });
                    }}
                  >
                    Удалить
                  </button>
                </span>
              )}
            </span>
          </aside>
        );
      })()}
      <div className="map-scale">
        <button
          aria-label="Увеличить масштаб"
          onClick={() => zoomAtCenter(scale + 0.1)}
        >
          +
        </button>
        <input
          aria-label="Масштаб карты"
          type="range"
          min="0.25"
          max="3"
          step="0.05"
          value={scale}
          onChange={(event) => zoomAtCenter(Number(event.target.value))}
        />
        <button
          aria-label="Уменьшить масштаб"
          onClick={() => zoomAtCenter(scale - 0.1)}
        >
          −
        </button>
        {Math.round(scale * 100)}%<button onClick={fitMap}>Вписать</button>
        {props.role === "GM" && (
          <label>
            <input
              aria-label="Показывать скрытый слой мастера"
              title="Показывать скрытый слой мастера"
              type="checkbox"
              checked={showGmLayer}
              onChange={(event) => setShowGmLayer(event.target.checked)}
            />
            GM
          </label>
        )}
        {selectedTokenIds.length + selectedDrawingIds.length > 1 && (
          <button
            onClick={() => {
              void props.onBulkDelete?.({
                tokenIds: selectedTokenIds,
                drawingIds: selectedDrawingIds,
              });
              setSelectedTokenIds([]);
              setSelectedDrawingIds([]);
              setSelectedDrawingId(null);
            }}
          >
            Удалить выбранное
          </button>
        )}
      </div>
    </div>
  );
}
