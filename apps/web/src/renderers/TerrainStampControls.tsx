import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import "./TerrainStampControls.css";

export type TerrainStampKey = "forest" | "mountains" | "clouds";
export type TerrainStampSettings = {
  assetKey: TerrainStampKey;
  size: number;
  rotation: number;
  layer: "PUBLIC" | "GM";
};

const titles: Record<TerrainStampKey, string> = {
  forest: "Лес",
  mountains: "Горы",
  clouds: "Облака",
};

export function TerrainStampControls({
  id,
  triggerRef,
  value,
  onChange,
  onClose,
  onDismissOutside,
}: {
  id: string;
  triggerRef: { current: HTMLButtonElement | null };
  value: TerrainStampSettings;
  onChange: (value: TerrainStampSettings) => void;
  onClose: (restoreFocus?: boolean) => void;
  onDismissOutside: () => void;
}) {
  const [catalog, setCatalog] = useState<TerrainStampKey[]>([]);
  const [error, setError] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const position = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const margin = 8;
      panel.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
      panel.style.maxHeight = `calc(100vh - ${margin * 2}px)`;
      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const rightX = triggerRect.right + margin;
      const leftX = triggerRect.left - panelRect.width - margin;
      const left = rightX + panelRect.width <= window.innerWidth - margin
        ? rightX
        : Math.max(margin, leftX);
      const top = Math.min(
        Math.max(margin, triggerRect.top),
        Math.max(margin, window.innerHeight - panelRect.height - margin),
      );
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(position);
    if (panelRef.current) observer?.observe(panelRef.current);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer?.disconnect();
    };
  }, [triggerRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onDismissOutside();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose, onDismissOutside, triggerRef]);
  useEffect(() => {
    let active = true;
    void api<{ stamps: Array<{ assetKey: TerrainStampKey }> }>(
      "/api/terrain-stamps/catalog",
    )
      .then((result) => {
        if (active) setCatalog(result.stamps.map((stamp) => stamp.assetKey));
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return createPortal((
    <section
      ref={panelRef}
      id={id}
      className="terrain-stamp-controls"
      role="dialog"
      aria-label="Штампы рельефа"
      aria-modal="false"
    >
      <div role="group" aria-label="Выбрать штамп">
        {catalog.map((assetKey) => (
          <button
            key={assetKey}
            type="button"
            aria-pressed={value.assetKey === assetKey}
            aria-label={titles[assetKey]}
            onClick={() => onChange({ ...value, assetKey })}
          >
            <img alt="" src={`/api/terrain-stamps/assets/${assetKey}`} />
            {titles[assetKey]}
          </button>
        ))}
      </div>
      {error && <span role="status">Не удалось загрузить каталог штампов</span>}
      <label>
        Размер{" "}
        <input
          aria-label="Размер штампа"
          type="range"
          min={16}
          max={1024}
          step={16}
          value={value.size}
          onChange={(e) => onChange({ ...value, size: Number(e.target.value) })}
        />
      </label>
      <label>
        Поворот{" "}
        <input
          aria-label="Поворот штампа"
          type="range"
          min={-180}
          max={180}
          step={15}
          value={value.rotation}
          onChange={(e) =>
            onChange({ ...value, rotation: Number(e.target.value) })
          }
        />
      </label>
      <label>
        Слой{" "}
        <select
          aria-label="Слой штампа"
          value={value.layer}
          onChange={(e) =>
            onChange({
              ...value,
              layer: e.target.value as TerrainStampSettings["layer"],
            })
          }
        >
          <option value="PUBLIC">Игрокам</option>
          <option value="GM">Только мастеру</option>
        </select>
      </label>
    </section>
  ), document.body);
}
