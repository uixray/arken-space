import { useEffect, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
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
import { isRectFullyRevealed } from "./fog";
import { ArkenDialog } from "../ui/ArkenDialog";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  createInitialMapInteractionState,
  createValidatedMapObjectRef,
  mapInteractionReducer,
  type MapObjectRef,
} from "./map-interaction";
import { selectMapObjects } from "./map-objects";

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
        strokeWidth={1}
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
        strokeWidth={1}
        listening={false}
      />,
    );
  return <>{lines}</>;
}

function TokenImage({
  src,
  ...props
}: {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  draggable: boolean;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => void;
}) {
  const [image] = useImage(src, "anonymous");
  const [lastImage, setLastImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (image) setLastImage(image);
  }, [image]);
  return <Image image={image ?? lastImage ?? undefined} {...props} />;
}

export function Orthographic2DRenderer(props: SceneRendererProps) {
  const { canvasEditMode, onCanvasEditCancel } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [interaction, dispatchInteraction] = useReducer(
    mapInteractionReducer,
    undefined,
    createInitialMapInteractionState,
  );
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
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(
    null,
  );
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([]);
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
  const [hoveredTokenId, setHoveredTokenId] = useState<string | null>(null);
  const [dragPositions, setDragPositions] = useState<
    Record<string, { x: number; y: number; revision: number }>
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
  const [drawingPoints, setDrawingPoints] = useState<number[]>([]);
  const drawingPointsRef = useRef<number[]>([]);
  const [backgroundDraft, setBackgroundDraft] = useState(
    props.scene.backgroundFrame,
  );
  const [worldDraft, setWorldDraft] = useState({
    width: props.scene.width,
    height: props.scene.height,
  });
  const [lockAspect, setLockAspect] = useState(true);
  const [rulerStart, setRulerStart] = useState<{ x: number; y: number } | null>(
    null,
  );
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
    if (!canvasEditMode) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
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
  }, [props.fogReveals, worldDraft.width, worldDraft.height]);

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
    if (!stage || !pointer) return;
    const oldScale = scale;
    const nextScale = Math.min(
      3,
      Math.max(0.25, oldScale * (event.evt.deltaY > 0 ? 0.9 : 1.1)),
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
    const next = Math.min(
      3,
      Math.max(
        0.25,
        Math.min(
          viewport.width / props.scene.width,
          viewport.height / props.scene.height,
        ) * 0.92,
      ),
    );
    setScale(next);
    setPosition({
      x: (viewport.width - props.scene.width * next) / 2,
      y: (viewport.height - props.scene.height * next) / 2,
    });
  };

  const selectableObjects = selectMapObjects(props.tokens, props.drawings, {
    role: props.role,
    membershipId: props.membershipId,
    fogReveals: props.fogReveals,
    world: worldDraft,
    showGmLayer,
  });
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
    } else if (event.key === "ArrowLeft")
      setPosition((p) => ({ ...p, x: p.x + step }));
    else if (event.key === "ArrowRight")
      setPosition((p) => ({ ...p, x: p.x - step }));
    else if (event.key === "ArrowUp")
      setPosition((p) => ({ ...p, y: p.y + step }));
    else if (event.key === "ArrowDown")
      setPosition((p) => ({ ...p, y: p.y - step }));
    else if (event.key === "+" || event.key === "=") zoomAtCenter(scale * 1.1);
    else if (event.key === "-") zoomAtCenter(scale / 1.1);
    else if (event.key === "0" || event.key.toLowerCase() === "f") fitMap();
    else if (event.key.toLowerCase() === "o")
      dispatchInteraction({ type: "toggle-object-list" });
    else if (event.key === "Enter") openSelectedAction();
    else if (event.key === "Delete") requestSelectedDelete();
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
    const stillCurrent =
      selected &&
      candidates.some(
        (item) =>
          item.id === selected.objectId && item.revision === selected.revision,
      );
    if (selected && !stillCurrent) {
      dispatchInteraction({ type: "clear-selection" });
      setSelectedTokenIds([]);
      setSelectedDrawingIds([]);
      setSelectedDrawingId(null);
    }
  }, [
    interaction.selectedObject,
    props.tokens,
    props.drawings,
    props.fogReveals,
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
  }, [interaction.commands, onDrawingDelete, onTokenDelete]);

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

  const handleClick = () => {
    if (props.tool !== "PING") return;
    const point = pointerInWorld();
    if (point) props.onPing(point);
  };

  const handlePointerDown = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (event.evt.button === 1) {
      event.evt.preventDefault();
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer)
        panStartRef.current = {
          pointerX: pointer.x,
          pointerY: pointer.y,
          stageX: position.x,
          stageY: position.y,
        };
      return;
    }
    if (event.evt.button === 2 && event.target === stageRef.current) {
      const point = pointerInWorld();
      if (point)
        setMarquee({
          startX: point.x,
          startY: point.y,
          x: point.x,
          y: point.y,
          width: 0,
          height: 0,
        });
      return;
    }
    if (event.evt.button !== 0) return;
    if (event.target === stageRef.current && props.tool === "PAN") {
      setSelectedTokenIds([]);
      setSelectedDrawingIds([]);
      setSelectedDrawingId(null);
      setTokenMenu(null);
    }
    handleFogDown();
    const point = pointerInWorld();
    if (!point) return;
    const bounded = clampToWorld(point);
    if (props.tool === "DRAW") {
      const points = [bounded.x, bounded.y];
      drawingPointsRef.current = points;
      setDrawingPoints(points);
    }
    if (props.tool === "RULER") setRulerStart(point);
  };

  const handlePointerMove = () => {
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
    const point = pointerInWorld();
    if (!point) return;
    if (props.tool === "DRAW" && drawingPointsRef.current.length) {
      const bounded = clampToWorld(point);
      const next = [...drawingPointsRef.current, bounded.x, bounded.y];
      drawingPointsRef.current = next;
      setDrawingPoints(next);
    }
    if (props.tool === "RULER" && rulerStart)
      props.socket?.emit("ruler:update", {
        sceneId: props.scene.id,
        startX: rulerStart.x,
        startY: rulerStart.y,
        endX: point.x,
        endY: point.y,
      });
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
    // Clear synchronously before the async command so a trailing preview can
    // never survive the pointer-up frame.
    drawingPointsRef.current = [];
    flushSync(() => setDrawingPoints([]));
    await handleFogUp();
    if (props.tool === "DRAW" && completedDrawing.length >= 4)
      await props.onDrawingCreate({
        points: completedDrawing,
        color: "#f0c75e",
      });
    if (props.tool === "RULER")
      props.socket?.emit("ruler:clear", { sceneId: props.scene.id });
    setRulerStart(null);
  };

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
  const occupiedCells = props.tokens.reduce<Record<string, number>>(
    (cells, token) => {
      if (token.layer !== "MAP") {
        const position = dragPositions[token.id] ?? token;
        const key = gridCellKey(position.x, position.y);
        cells[key] = (cells[key] ?? 0) + 1;
      }
      return cells;
    },
    {},
  );
  const drawingRevealed = (points: number[], x: number, y: number) => {
    const xs = points.filter((_, index) => index % 2 === 0);
    const ys = points.filter((_, index) => index % 2 === 1);
    const minX = Math.min(...xs) + x;
    const minY = Math.min(...ys) + y;
    return isRectFullyRevealed(
      {
        x: minX,
        y: minY,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      },
      props.fogReveals,
    );
  };

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
          fill="#080807"
        />
        {props.fogReveals.map((fog) => (
          <Rect
            key={fog.id}
            x={fog.x}
            y={fog.y}
            width={fog.width}
            height={fog.height}
            fill="#000"
            globalCompositeOperation={
              fog.operation === "COVER" ? "source-over" : "destination-out"
            }
          />
        ))}
      </Group>
      {fogDraft && (
        <Rect
          {...fogDraft}
          fill="#d9c07e"
          opacity={0.35}
          stroke="#f2dfaa"
          strokeWidth={2 / scale}
        />
      )}
    </Layer>
  );
  return (
    <div
      className="map-viewport"
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label="Интерактивная карта сцены"
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - 0 F O Enter Delete Escape"
      onFocus={() => dispatchInteraction({ type: "focus" })}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          dispatchInteraction({ type: "blur" });
      }}
      onKeyDown={handleMapKeyDown}
      onDragOver={(event) => {
        if (
          event.dataTransfer.types.includes(
            "application/x-arken-token-definition",
          )
        )
          event.preventDefault();
      }}
      onDrop={(event) => {
        const definitionId = event.dataTransfer.getData(
          "application/x-arken-token-definition",
        );
        if (!definitionId || !props.onPlaceTokenDefinition) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        void props.onPlaceTokenDefinition(definitionId, {
          x: (event.clientX - rect.left - position.x) / scale,
          y: (event.clientY - rect.top - position.y) / scale,
        });
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
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onClick={handleClick}
      >
        <Layer
          listening={false}
          clipX={0}
          clipY={0}
          clipWidth={worldDraft.width}
          clipHeight={worldDraft.height}
        >
          <Rect
            width={worldDraft.width}
            height={worldDraft.height}
            fill="#282824"
          />
          {mapImage && (
            <Image
              image={mapImage}
              x={backgroundDraft.x}
              y={backgroundDraft.y}
              width={backgroundDraft.width}
              height={backgroundDraft.height}
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

        {props.role === "GM" && props.canvasEditMode && (
          <Layer>
            {props.canvasEditMode === "BACKGROUND" ? (
              <Group>
                <Rect
                  {...backgroundDraft}
                  stroke="#f0c75e"
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
                      fill="#f0c75e"
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
                  stroke="#7ee0ff"
                  strokeWidth={2 / scale}
                  dash={[8 / scale, 5 / scale]}
                />
                <Circle
                  x={worldDraft.width}
                  y={worldDraft.height}
                  radius={8 / scale}
                  fill="#7ee0ff"
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
            .map((token) => (
              <Group
                key={token.id}
                x={token.x}
                y={token.y}
                listening={props.role === "GM"}
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
                    stroke="#7ee0ff"
                    strokeWidth={2 / scale}
                    dash={[6 / scale, 3 / scale]}
                    listening={false}
                  />
                )}
                {assetUrl(token.assetId) ? (
                  <>
                    <TokenImage
                      src={assetUrl(token.assetId)!}
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
                  selectedTokenIds.length === 1 &&
                  selectedTokenIds[0] === token.id && (
                    <Circle
                      x={token.width}
                      y={token.height}
                      radius={7 / scale}
                      fill="#7ee0ff"
                      stroke="#102027"
                      strokeWidth={1 / scale}
                      draggable
                      onMouseDown={(event) => {
                        event.cancelBubble = true;
                      }}
                      onDragMove={(event) => {
                        const aspect = token.width / token.height;
                        const width = Math.max(16, event.target.x());
                        event.target.position({
                          x: width,
                          y: Math.max(16, width / aspect),
                        });
                      }}
                      onDragEnd={(event) => {
                        const width = Math.round(
                          Math.max(16, event.target.x()),
                        );
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
          {props.drawings.map((drawing) => (
            <Line
              key={drawing.id}
              points={drawing.points}
              x={drawing.x}
              y={drawing.y}
              stroke={drawing.color}
              strokeWidth={3 / scale}
              lineCap="round"
              lineJoin="round"
              listening={
                (props.role === "GM" ||
                  (Boolean(props.membershipId) &&
                    drawing.authorMembershipId === props.membershipId)) &&
                (props.role === "GM" ||
                  drawingRevealed(drawing.points, drawing.x, drawing.y))
              }
              draggable={
                (props.role === "GM" ||
                  (Boolean(props.membershipId) &&
                    drawing.authorMembershipId === props.membershipId)) &&
                (props.role === "GM" ||
                  drawingRevealed(drawing.points, drawing.x, drawing.y))
              }
              hitStrokeWidth={14 / scale}
              shadowColor={
                selectedDrawingIds.includes(drawing.id) ? "#7ee0ff" : undefined
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
                  void props.onBulkMove(
                    {
                      tokenIds: selectedTokenIds,
                      drawingIds: selectedDrawingIds,
                    },
                    {
                      x: event.target.x() - drawing.x,
                      y: event.target.y() - drawing.y,
                    },
                  );
                  return;
                }
                void props.onDrawingUpdate?.(drawing.id, drawing.revision, {
                  x: event.target.x(),
                  y: event.target.y(),
                });
              }}
            />
          ))}
          {drawingPoints.length >= 4 && (
            <Line
              points={drawingPoints}
              stroke="#f0c75e"
              strokeWidth={3 / scale}
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
              fill="#7ee0ff"
              opacity={0.12}
              stroke="#7ee0ff"
              strokeWidth={1 / scale}
              dash={[6 / scale, 4 / scale]}
            />
          </Layer>
        )}

        {renderFog()}

        <Layer {...playerClip}>
          {props.tokens
            .filter((token) => token.layer !== "MAP")
            .filter((token) => token.layer !== "GM" || showGmLayer)
            .filter((token) => token.visible || props.role === "GM")
            .filter(
              (token) =>
                props.role === "GM" ||
                (token.x + token.width > 0 &&
                  token.y + token.height > 0 &&
                  token.x < worldDraft.width &&
                  token.y < worldDraft.height),
            )
            .filter(
              (token) =>
                props.role === "GM" ||
                token.controllerMembershipIds.includes(props.membershipId) ||
                isRectFullyRevealed(token, props.fogReveals),
            )
            .sort((a, b) =>
              a.layer === "PLAYER" ? -1 : b.layer === "PLAYER" ? 1 : 0,
            )
            .map((token) => {
              const canMove =
                props.tool === "PAN" &&
                !token.locked &&
                (props.role === "GM" ||
                  token.controllerMembershipIds.includes(props.membershipId));
              const url = assetUrl(token.assetId);
              const dragPosition = dragPositions[token.id];
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
                const x = snap(event.target.x());
                const y = snap(event.target.y());
                const bulkSelection = {
                  tokenIds: selectedTokenIds,
                  drawingIds: selectedDrawingIds,
                };
                if (
                  selectedTokenIds.includes(token.id) &&
                  selectedTokenIds.length + selectedDrawingIds.length > 1 &&
                  props.onBulkMove
                ) {
                  event.target.position({ x, y });
                  void props.onBulkMove(bulkSelection, {
                    x: x - token.x,
                    y: y - token.y,
                  });
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
                    if (event.evt.button !== 0) return;
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
                      stroke="#7ee0ff"
                      strokeWidth={2 / scale}
                      dash={[6 / scale, 3 / scale]}
                      listening={false}
                    />
                  )}
                  {(occupiedCells[
                    gridCellKey(
                      dragPosition?.x ?? token.x,
                      dragPosition?.y ?? token.y,
                    )
                  ] ?? 0) > 1 && (
                    <Circle
                      x={token.width / 2}
                      y={token.height / 2}
                      radius={Math.max(token.width, token.height) / 2 + 5}
                      stroke="#ffcc66"
                      strokeWidth={3 / scale}
                      dash={[5 / scale, 4 / scale]}
                      listening={false}
                    />
                  )}
                  {url ? (
                    <>
                      <TokenImage src={url} {...common} />
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
                    <Group {...common}>
                      <Circle
                        x={token.width / 2}
                        y={token.height / 2}
                        radius={Math.min(token.width, token.height) / 2}
                        fill={token.baseColor}
                        stroke={token.frameColor ?? "#e2d4b4"}
                        strokeWidth={2}
                      />
                      <Text
                        text={token.name.slice(0, 2).toUpperCase()}
                        width={token.width}
                        height={token.height}
                        align="center"
                        verticalAlign="middle"
                        fill="#f0e7d4"
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
                      (occupiedCells[
                        gridCellKey(
                          dragPosition?.x ?? token.x,
                          dragPosition?.y ?? token.y,
                        )
                      ] ?? 0) > 1
                        ? ` +${
                            (occupiedCells[
                              gridCellKey(
                                dragPosition?.x ?? token.x,
                                dragPosition?.y ?? token.y,
                              )
                            ] ?? 0) - 1
                          }`
                        : ""
                    }`}
                    fill="#eee6d5"
                    fontSize={13}
                    listening={false}
                    visible={
                      hoveredTokenId === token.id ||
                      canMove ||
                      (occupiedCells[
                        gridCellKey(
                          dragPosition?.x ?? token.x,
                          dragPosition?.y ?? token.y,
                        )
                      ] ?? 0) > 1
                    }
                  />
                  {props.role === "GM" &&
                    selectedTokenIds.length === 1 &&
                    selectedTokenIds[0] === token.id && (
                      <Circle
                        x={token.width}
                        y={token.height}
                        radius={7 / scale}
                        fill="#7ee0ff"
                        stroke="#102027"
                        strokeWidth={1 / scale}
                        draggable
                        onMouseDown={(event) => {
                          event.cancelBubble = true;
                        }}
                        onDragMove={(event) => {
                          const aspect = token.width / token.height;
                          const width = Math.max(16, event.target.x());
                          event.target.position({
                            x: width,
                            y: Math.max(16, width / aspect),
                          });
                        }}
                        onDragEnd={(event) => {
                          const width = Math.round(
                            Math.max(16, event.target.x()),
                          );
                          const height = Math.round(
                            width / (token.width / token.height),
                          );
                          void props.onTokenResize?.(token.id, token.revision, {
                            width,
                            height,
                          });
                        }}
                      />
                    )}
                </Group>
              );
            })}
        </Layer>

        <Layer listening={false}>
          {props.rulers.map((ruler) => (
            <Group key={ruler.membershipId}>
              <Line
                points={[ruler.startX, ruler.startY, ruler.endX, ruler.endY]}
                stroke="#7ee0ff"
                strokeWidth={2 / scale}
              />
              <Text
                x={ruler.endX}
                y={ruler.endY}
                text={`${ruler.displayName}: ${ruler.distance.toFixed(1)}`}
                fill="#7ee0ff"
                fontSize={13 / scale}
              />
            </Group>
          ))}
          {props.pings.map((ping) => (
            <Group key={`${ping.membershipId}-${ping.createdAt}`}>
              <Circle
                x={ping.x}
                y={ping.y}
                radius={22 / scale}
                stroke="#f0c75e"
                strokeWidth={3 / scale}
              />
              <Text
                x={ping.x + 28 / scale}
                y={ping.y - 8 / scale}
                text={ping.displayName}
                fill="#f0c75e"
                fontSize={14 / scale}
              />
            </Group>
          ))}
        </Layer>
      </Stage>
      {tokenMenu && (
        <div
          className="token-context-menu"
          style={{ left: tokenMenu.x, top: tokenMenu.y }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <strong>{tokenMenu.token.name}</strong>
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
              value={tokenMenu.token.frameColor ?? "#e2d4b4"}
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
      <ArkenDialog
        open={interaction.objectListOpen}
        title="Объекты карты"
        footer={false}
        onClose={() => dispatchInteraction({ type: "close-object-list" })}
      >
        <ul className="map-object-list" aria-label="Доступные объекты карты">
          {selectableObjects.tokens.map((token) => (
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
                Токен: {token.name}
              </button>
            </li>
          ))}
          {selectableObjects.drawings.map((drawing, index) => (
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
                Рисунок {index + 1}
              </button>
            </li>
          ))}
          {selectableObjects.tokens.length +
            selectableObjects.drawings.length ===
            0 && <li>Доступных объектов нет.</li>}
        </ul>
      </ArkenDialog>
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
              type="checkbox"
              checked={showGmLayer}
              onChange={(event) => setShowGmLayer(event.target.checked)}
            />
            GM
          </label>
        )}
        {(() => {
          const drawing = props.drawings.find(
            (item) => item.id === selectedDrawingId,
          );
          if (
            !drawing ||
            (props.role !== "GM" &&
              (!props.membershipId ||
                drawing.authorMembershipId !== props.membershipId))
          )
            return null;
          return (
            <span>
              <button
                onClick={() =>
                  void props.onDrawingUpdate?.(drawing.id, drawing.revision, {
                    color: drawing.color === "#f0c75e" ? "#5ecbf0" : "#f0c75e",
                  })
                }
              >
                Цвет
              </button>
              <button
                onClick={() =>
                  void props.onDrawingCopy?.(drawing.id, drawing.revision)
                }
              >
                Копировать
              </button>
              <button
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
          );
        })()}
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
