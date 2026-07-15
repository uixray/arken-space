import { useEffect, useRef, useState } from "react";
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
import type Konva from "konva";
import { api } from "../api";
import type { SceneRendererProps } from "./SceneRenderer";
import { isRectFullyRevealed } from "./fog";

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
  return <Image image={image} {...props} />;
}

export function Orthographic2DRenderer(props: SceneRendererProps) {
  const { canvasEditMode, onCanvasEditCancel } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
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
  const [hoveredTokenId, setHoveredTokenId] = useState<string | null>(null);
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

  const pointerInWorld = () => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - position.x) / scale,
      y: (pointer.y - position.y) / scale,
    };
  };

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

  const handleFogDown = () => {
    if ((props.tool !== "FOG" && props.tool !== "COVER") || props.role !== "GM")
      return;
    const point = pointerInWorld();
    if (point) setFogStart(point);
  };

  const handleFogMove = () => {
    if (!fogStart || (props.tool !== "FOG" && props.tool !== "COVER")) return;
    const point = pointerInWorld();
    if (!point) return;
    setFogDraft({
      x: Math.min(fogStart.x, point.x),
      y: Math.min(fogStart.y, point.y),
      width: Math.abs(point.x - fogStart.x),
      height: Math.abs(point.y - fogStart.y),
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

  const handlePointerDown = () => {
    handleFogDown();
    const point = pointerInWorld();
    if (!point) return;
    if (props.tool === "DRAW") setDrawingPoints([point.x, point.y]);
    if (props.tool === "RULER") setRulerStart(point);
  };

  const handlePointerMove = () => {
    handleFogMove();
    const point = pointerInWorld();
    if (!point) return;
    if (props.tool === "DRAW" && drawingPoints.length)
      setDrawingPoints((current) => [...current, point.x, point.y]);
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
    await handleFogUp();
    if (props.tool === "DRAW" && drawingPoints.length >= 4)
      await props.onDrawingCreate({ points: drawingPoints, color: "#f0c75e" });
    if (props.tool === "RULER")
      props.socket?.emit("ruler:clear", { sceneId: props.scene.id });
    setDrawingPoints([]);
    setRulerStart(null);
  };

  const assetUrl = (assetId: string | null) =>
    props.assets.find((asset) => asset.id === assetId)?.url;
  const snap = (value: number) =>
    props.scene.grid.enabled
      ? Math.round(value / props.scene.grid.size) * props.scene.grid.size
      : value;
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
      opacity={props.role === "GM" ? (props.gmFogOpacity ?? 0.35) : 1}
    >
      <Rect
        width={worldDraft.width}
        height={worldDraft.height}
        fill="#080807"
        opacity={1}
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
      <Stage
        ref={stageRef}
        width={viewport.width}
        height={viewport.height}
        x={position.x}
        y={position.y}
        scaleX={scale}
        scaleY={scale}
        draggable={props.tool === "PAN"}
        onDragEnd={(event) => {
          if (event.target === stageRef.current)
            setPosition({ x: event.target.x(), y: event.target.y() });
        }}
        onWheel={handleWheel}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onClick={handleClick}
      >
        <Layer listening={false}>
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
          {props.scene.grid.enabled && (
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

        <Layer>
          {props.tokens
            .filter((token) => token.layer === "MAP")
            .map((token) => (
              <Group
                key={token.id}
                x={token.x}
                y={token.y}
                listening={props.role === "GM"}
                onContextMenu={(event) => {
                  event.evt.preventDefault();
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
                {assetUrl(token.assetId) ? (
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
                ) : (
                  <Circle
                    radius={Math.min(token.width, token.height) / 2}
                    x={token.width / 2}
                    y={token.height / 2}
                    fill="#b5623e"
                  />
                )}
                <Text text={token.name} y={token.height + 4} fill="#eee6d5" />
              </Group>
            ))}
        </Layer>

        <Layer>
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
                props.role === "GM" ||
                drawingRevealed(drawing.points, drawing.x, drawing.y)
              }
              draggable={
                (props.role === "GM" ||
                  drawing.authorMembershipId === props.membershipId) &&
                (props.role === "GM" ||
                  drawingRevealed(drawing.points, drawing.x, drawing.y))
              }
              onClick={() => setSelectedDrawingId(drawing.id)}
              onDragEnd={(event) =>
                void api(`/api/drawings/${drawing.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    actionId: crypto.randomUUID(),
                    revision: drawing.revision,
                    x: event.target.x(),
                    y: event.target.y(),
                  }),
                })
              }
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

        {renderFog()}

        <Layer>
          {props.tokens
            .filter((token) => token.layer !== "MAP")
            .filter((token) => token.layer !== "GM" || showGmLayer)
            .filter((token) => token.visible || props.role === "GM")
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
              const onDragMove = (event: Konva.KonvaEventObject<DragEvent>) =>
                props.socket?.emit("token:moving", {
                  actionId: crypto.randomUUID(),
                  tokenId: token.id,
                  x: event.target.x(),
                  y: event.target.y(),
                  z: token.z,
                  levelId: token.levelId,
                  revision: token.revision,
                });
              const onDragEnd = (event: Konva.KonvaEventObject<DragEvent>) => {
                const x = snap(event.target.x());
                const y = snap(event.target.y());
                event.target.position({ x, y });
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
                    if (!ack.ok)
                      props.socket?.emit("game:resync", ack.sequence);
                  },
                );
              };
              return (
                <Group
                  key={token.id}
                  x={token.x}
                  y={token.y}
                  draggable={canMove}
                  onDragMove={onDragMove}
                  onDragEnd={onDragEnd}
                  onMouseEnter={() => setHoveredTokenId(token.id)}
                  onMouseLeave={() => setHoveredTokenId(null)}
                  onContextMenu={(event) => {
                    event.evt.preventDefault();
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
                  {url ? (
                    <TokenImage src={url} {...common} />
                  ) : (
                    <Group {...common}>
                      <Circle
                        x={token.width / 2}
                        y={token.height / 2}
                        radius={Math.min(token.width, token.height) / 2}
                        fill="#b5623e"
                        stroke="#e2d4b4"
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
                    text={token.name}
                    fill="#eee6d5"
                    fontSize={13}
                    listening={false}
                    visible={hoveredTokenId === token.id || canMove}
                  />
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
                  void api(`/api/tokens/${tokenMenu.token.id}/layer`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      revision: tokenMenu.token.revision,
                      layer,
                    }),
                  });
                setTokenMenu(null);
              }}
            >
              {tokenMenu.token.layer === layer ? "✓ " : ""}
              {label}
            </button>
          ))}
          <button onClick={() => setTokenMenu(null)}>Отмена</button>
        </div>
      )}
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
              drawing.authorMembershipId !== props.membershipId)
          )
            return null;
          return (
            <span>
              <button
                onClick={() =>
                  void api(`/api/drawings/${drawing.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      revision: drawing.revision,
                      color:
                        drawing.color === "#f0c75e" ? "#5ecbf0" : "#f0c75e",
                    }),
                  })
                }
              >
                Цвет
              </button>
              <button
                onClick={() =>
                  void api(`/api/drawings/${drawing.id}/copy`, {
                    method: "POST",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      revision: drawing.revision,
                    }),
                  })
                }
              >
                Копировать
              </button>
              <button
                onClick={() => {
                  setSelectedDrawingId(null);
                  void api(`/api/drawings/${drawing.id}`, {
                    method: "DELETE",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      revision: drawing.revision,
                    }),
                  });
                }}
              >
                Удалить
              </button>
            </span>
          );
        })()}
      </div>
    </div>
  );
}
