import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Text } from "react-konva";
import Konva from "konva";
import { cursorColorForMembership } from "./cursor-color";
import {
  createMapPingAnimationDriver,
  subscribeReducedMotion,
  evaluateMapPing,
  mapPingElapsed,
  mapPingIsActive,
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
  const groupRef = useRef<Konva.Group>(null);
  const ringRefs = useRef<Array<Konva.Circle | null>>([null, null, null]);
  const haloRef = useRef<Konva.Circle>(null);
  const coreRef = useRef<Konva.Circle>(null);
  const nameRef = useRef<Konva.Text>(null);

  const applyGeometry = useCallback((elapsed: number) => {
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
    ringRefs.current.slice(reduced ? 1 : 3).forEach((shape) => shape?.visible(false));
    haloRef.current?.radius(g.haloRadius);
    haloRef.current?.opacity(g.haloOpacity);
    coreRef.current?.radius(g.coreRadius);
    coreRef.current?.strokeWidth(g.coreStrokeWidth);
    coreRef.current?.opacity(g.coreOpacity);
    nameRef.current?.x(g.nameX);
    nameRef.current?.y(g.nameY);
    nameRef.current?.fontSize(g.nameFontSize);
    nameRef.current?.opacity(g.coreOpacity);
    groupRef.current?.visible(mapPingIsActive(ping.createdAt, Date.now()));
  }, [ping.createdAt, scale, reduced]);

  // Konva visibility and geometry are imperative so a rerender after expiry
  // cannot briefly restore a ping from stale mount-time props.
  useLayoutEffect(() => {
    applyGeometry(mapPingElapsed(ping.createdAt, Date.now()));
  });

  useEffect(() => {
    const startTime = mapPingStartTime(ping.createdAt, Date.now());
    const elapsed = Math.max(0, Date.now() - startTime);
    const remaining = MAP_PING_LIFETIME_MS - elapsed;
    if (remaining <= 0) return;
    const layer = ringRefs.current[0]?.getLayer();
    if (!layer) return;
    const animation = new Konva.Animation(() => {
      if (!driver.tick()) animation.stop();
    }, layer);
    const driver = createMapPingAnimationDriver({
      startTime,
      durationMs: reduced ? 500 : MAP_PING_LIFETIME_MS,
      now: Date.now,
      loop: { start: () => animation.start(), stop: () => animation.stop() },
      apply: applyGeometry,
    });
    driver.start();
    const expiryTimer = window.setTimeout(
      () => groupRef.current?.visible(false),
      remaining,
    );
    return () => {
      window.clearTimeout(expiryTimer);
      driver.stop();
    };
  }, [ping.createdAt, scale, reduced, applyGeometry]);

  const initial = evaluateMapPing(0, scale, reduced);
  return (
    <Group ref={groupRef} x={ping.x} y={ping.y} listening={false}>
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
