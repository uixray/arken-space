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
import type { SceneRendererProps } from "./SceneRenderer";
import { fogOpacity, isRectFullyRevealed } from "./fog";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [fogStart, setFogStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [fogDraft, setFogDraft] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [mapImage] = useImage(
    props.assets.find((asset) => asset.id === props.scene.mapAssetId)?.url ??
      "",
    "anonymous",
  );

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

  const handleFogDown = () => {
    if (props.tool !== "FOG" || props.role !== "GM") return;
    const point = pointerInWorld();
    if (point) setFogStart(point);
  };

  const handleFogMove = () => {
    if (!fogStart || props.tool !== "FOG") return;
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

  const assetUrl = (assetId: string | null) =>
    props.assets.find((asset) => asset.id === assetId)?.url;
  const snap = (value: number) =>
    props.scene.grid.enabled
      ? Math.round(value / props.scene.grid.size) * props.scene.grid.size
      : value;

  const renderFog = () => (
    <Layer listening={false}>
      <Rect
        width={props.scene.width}
        height={props.scene.height}
        fill="#080807"
        opacity={fogOpacity(props.role)}
      />
      {props.fogReveals.map((fog) => (
        <Rect
          key={fog.id}
          x={fog.x}
          y={fog.y}
          width={fog.width}
          height={fog.height}
          fill="#000"
          globalCompositeOperation="destination-out"
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
    <div className="map-viewport" ref={containerRef}>
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
        onMouseDown={handleFogDown}
        onMouseMove={handleFogMove}
        onMouseUp={handleFogUp}
        onClick={handleClick}
      >
        <Layer listening={false}>
          <Rect
            width={props.scene.width}
            height={props.scene.height}
            fill="#282824"
          />
          {mapImage && (
            <Image
              image={mapImage}
              width={props.scene.width}
              height={props.scene.height}
            />
          )}
          {props.scene.grid.enabled && (
            <Grid
              width={props.scene.width}
              height={props.scene.height}
              {...props.scene.grid}
            />
          )}
        </Layer>

        {props.role === "PLAYER" && renderFog()}

        <Layer>
          {props.pings.map((ping) => (
            <Group
              key={`${ping.membershipId}-${ping.createdAt}`}
              listening={false}
            >
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
          {props.tokens
            .filter((token) => token.visible || props.role === "GM")
            .filter(
              (token) =>
                props.role === "GM" ||
                token.controllerMembershipIds.includes(props.membershipId) ||
                isRectFullyRevealed(token, props.fogReveals),
            )
            .map((token) => {
              const canMove =
                props.tool === "PAN" &&
                !token.locked &&
                (props.role === "GM" ||
                  token.controllerMembershipIds.includes(props.membershipId));
              const url = assetUrl(token.assetId);
              const common = {
                x: token.x,
                y: token.y,
                width: token.width,
                height: token.height,
                rotation: token.rotation,
                draggable: canMove,
                opacity: token.visible ? 1 : 0.45,
                onDragMove: (event: Konva.KonvaEventObject<DragEvent>) =>
                  props.socket?.emit("token:moving", {
                    actionId: crypto.randomUUID(),
                    tokenId: token.id,
                    x: event.target.x(),
                    y: event.target.y(),
                    z: token.z,
                    levelId: token.levelId,
                    revision: token.revision,
                  }),
                onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => {
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
                },
              };
              return (
                <Group key={token.id}>
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
                    x={token.x - 16}
                    y={token.y + token.height + 5}
                    width={token.width + 32}
                    align="center"
                    text={token.name}
                    fill="#eee6d5"
                    fontSize={13}
                    listening={false}
                  />
                </Group>
              );
            })}
        </Layer>

        {props.role === "GM" && renderFog()}
      </Stage>
      <div className="map-scale">{Math.round(scale * 100)}%</div>
    </div>
  );
}
