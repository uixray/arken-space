import { useLayoutEffect, useRef, useState } from "react";
import type { CartographicLabelConfig } from "@arken/contracts";
import { CartographicLabel } from "./design-system/CartographicLabel";
import "./cartographic-label-placement.css";

/** Moves text only; the caller retains the location point/semantic button.
 * Offsets are clamped for display, never written back on viewport changes. */
export function PositionedCartographicLabel({
  text,
  config,
  layoutKey,
}: {
  text: string;
  config: CartographicLabelConfig;
  layoutKey: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    const boundary = element?.closest<HTMLElement>(
      "[data-cartographic-boundary]",
    );
    if (!element || !boundary) return;
    const measure = () => {
      const outer = boundary.getBoundingClientRect();
      if (!outer.width || !outer.height) return;
      // Measure the layout anchor without the previous visual offset.
      const transform = element.style.transform;
      element.style.transform = "none";
      const rect = element.getBoundingClientRect();
      element.style.transform = transform;
      const clamp = (value: number, min: number, max: number) =>
        max >= min ? Math.max(min, Math.min(max, value)) : min;
      const x = clamp(
        config.offsetX,
        outer.left - rect.left,
        outer.right - rect.right,
      );
      const y = clamp(
        config.offsetY,
        outer.top - rect.top,
        outer.bottom - rect.bottom,
      );
      setShift((old) => (old.x === x && old.y === y ? old : { x, y }));
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(boundary);
    observer?.observe(element);
    // Party-marker changes can move the caption anchor without resizing the
    // caption or canvas. Observe the owning button as well.
    const anchor = element.closest("button");
    if (anchor) observer?.observe(anchor);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [config.offsetX, config.offsetY, config.presentation, layoutKey, text]);
  return (
    <span
      ref={ref}
      className="positioned-cartographic-label"
      style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}
    >
      <CartographicLabel text={text} presentation={config.presentation} />
    </span>
  );
}
