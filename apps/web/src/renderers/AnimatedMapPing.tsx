import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Text } from "react-konva";
import Konva from "konva";
import { cursorColorForMembership } from "./cursor-color";
import {
  createMapPingAnimationDriver,
  subscribeReducedMotion,
  evaluateMapPing,
  mapPingElapsed,
  mapPingStartTime,
  MAP_PING_LIFETIME_MS,
} from "./map-ping-motion";

export type AnimatedMapPingData = {
  membershipId: string;
  displayName: string;
  x: number;
  y: number;
  createdAt: string | number;
};

function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    return subscribeReducedMotion(setReduced, window.matchMedia.bind(window));
  }, []);
  return reduced;
}

export function AnimatedMapPing({
  ping,
  scale,
}: {
  ping: AnimatedMapPingData;
  scale: number;
}) {
  const color = useMemo(
    () => cursorColorForMembership(ping.membershipId),
    [ping.membershipId],
  );
  const reduced = useReducedMotionPreference();
  const ringRefs = useRef<Array<Konva.Circle | null>>([null, null, null]);
  const haloRef = useRef<Konva.Circle>(null);
  const coreRef = useRef<Konva.Circle>(null);
  const nameRef = useRef<Konva.Text>(null);

  useEffect(() => {
    const startTime = mapPingStartTime(ping.createdAt, Date.now());
    if (Date.now() - startTime >= MAP_PING_LIFETIME_MS) return;
    const layer = ringRefs.current[0]?.getLayer();
    if (!layer) return;
    let driver: ReturnType<typeof createMapPingAnimationDriver>;
    const animation = new Konva.Animation(() => {
      if (!driver.tick()) animation.stop();
    }, layer);
    driver = createMapPingAnimationDriver({
      startTime,
      durationMs: reduced ? 500 : MAP_PING_LIFETIME_MS,
      now: Date.now,
      loop: { start: () => animation.start(), stop: () => animation.stop() },
      apply: (elapsed) => {
        const g = evaluateMapPing(elapsed, scale, reduced);
        const rings = reduced ? [ringRefs.current[0]] : ringRefs.current;
        rings.forEach((shape, index) => {
          if (!shape) return;
          const spec = g.rings[reduced ? 0 : index]!;
          shape.radius(spec.radius);
          shape.strokeWidth(spec.strokeWidth);
          shape.opacity(spec.opacity);
          shape.visible(spec.opacity > 0);
        });
        ringRefs.current
          .slice(reduced ? 1 : 3)
          .forEach((shape) => shape?.visible(false));
        haloRef.current?.radius(g.haloRadius);
        haloRef.current?.opacity(g.haloOpacity);
        coreRef.current?.radius(g.coreRadius);
        coreRef.current?.strokeWidth(g.coreStrokeWidth);
        coreRef.current?.opacity(g.coreOpacity);
        nameRef.current?.x(g.nameX);
        nameRef.current?.y(g.nameY);
        nameRef.current?.fontSize(g.nameFontSize);
        nameRef.current?.opacity(g.coreOpacity);
      },
    });
    driver.start();
    return () => driver.stop();
  }, [ping.createdAt, scale, reduced]);

  const initialElapsed = mapPingElapsed(ping.createdAt, Date.now());
  const initial = evaluateMapPing(initialElapsed, scale, reduced);
  return (
    <Group
      x={ping.x}
      y={ping.y}
      visible={initialElapsed < MAP_PING_LIFETIME_MS}
      listening={false}
    >
      {Array.from({ length: 3 }, (_, index) => {
        const ring = initial.rings[reduced ? 0 : index]!;
        return (
          <Circle
            key={index}
            ref={(node) => {
              ringRefs.current[index] = node;
            }}
            radius={ring.radius}
            stroke={color}
            strokeWidth={ring.strokeWidth}
            opacity={ring.opacity}
            visible={!reduced || index === 0}
            listening={false}
          />
        );
      })}
      <Circle
        ref={haloRef}
        radius={initial.haloRadius}
        fill={color}
        opacity={initial.haloOpacity}
        listening={false}
      />
      <Circle
        ref={coreRef}
        radius={initial.coreRadius}
        fill={color}
        stroke="#78350f"
        strokeWidth={initial.coreStrokeWidth}
        opacity={initial.coreOpacity}
        listening={false}
      />
      <Text
        ref={nameRef}
        x={initial.nameX}
        y={initial.nameY}
        text={ping.displayName}
        fill={color}
        fontSize={initial.nameFontSize}
        fontStyle="bold"
        opacity={initial.coreOpacity}
        listening={false}
      />
    </Group>
  );
}
