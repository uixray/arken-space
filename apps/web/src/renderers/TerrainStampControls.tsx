import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AssetDto, StampPackId } from "@arken/contracts";
import { api, formatApiError } from "../api";
import { stampImageUrl } from "./stamp-image-url";
import "./TerrainStampControls.css";

export type TerrainStampSettings = {
  packId: StampPackId;
  assetKey: string;
  size: number;
  rotation: number;
  layer: "PUBLIC" | "GM";
};

type StampImage = Pick<AssetDto, "id" | "name">;

export function TerrainStampControls({
  id,
  triggerRef,
  value,
  onChange,
  onClose,
  onDismissOutside,
  images = [],
  onUploadImage,
}: {
  id: string;
  triggerRef: { current: HTMLButtonElement | null };
  value: TerrainStampSettings;
  onChange: (value: TerrainStampSettings) => void;
  onClose: (restoreFocus?: boolean) => void;
  onDismissOutside: () => void;
  /** Campaign IMAGE assets the GM may use as their own stamps. */
  images?: StampImage[];
  onUploadImage?: (file: File) => Promise<StampImage>;
}) {
  const [catalog, setCatalog] = useState<
    Array<{ assetKey: string; title: string }>
  >([]);
  const [error, setError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadImage = async (file: File) => {
    if (!onUploadImage) return;
    setUploading(true);
    setUploadError(null);
    try {
      const asset = await onUploadImage(file);
      onChange({ ...value, packId: "campaign-image", assetKey: asset.id });
    } catch (cause) {
      setUploadError(formatApiError(cause));
    } finally {
      setUploading(false);
    }
  };
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
      const left =
        rightX + panelRect.width <= window.innerWidth - margin
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
    const observer =
      typeof ResizeObserver === "undefined"
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
      if (
        panelRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      )
        return;
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
    void api<{ stamps: Array<{ assetKey: string; title: string }> }>(
      "/api/terrain-stamps/catalog",
    )
      .then((result) => {
        if (!active) return;
        if (Array.isArray(result?.stamps)) setCatalog(result.stamps);
        else setError(true);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return createPortal(
    <section
      ref={panelRef}
      id={id}
      className="terrain-stamp-controls"
      role="dialog"
      aria-label="Штампы рельефа"
      aria-modal="false"
    >
      <div role="group" aria-label="Выбрать штамп">
        {catalog.map(({ assetKey, title }) => (
          <button
            key={assetKey}
            type="button"
            aria-pressed={
              value.packId === "builtin-terrain-v1" &&
              value.assetKey === assetKey
            }
            aria-label={title}
            onClick={() =>
              onChange({ ...value, packId: "builtin-terrain-v1", assetKey })
            }
          >
            <img alt="" src={stampImageUrl("builtin-terrain-v1", assetKey)} />
            {title}
          </button>
        ))}
      </div>
      {error && <span role="status">Не удалось загрузить каталог штампов</span>}
      <h3 className="terrain-stamp-controls__heading">Свои картинки</h3>
      {images.length > 0 && (
        <div
          role="group"
          aria-label="Свои штампы"
          className="terrain-stamp-controls__custom"
        >
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              aria-pressed={
                value.packId === "campaign-image" && value.assetKey === image.id
              }
              aria-label={image.name}
              title={image.name}
              onClick={() =>
                onChange({
                  ...value,
                  packId: "campaign-image",
                  assetKey: image.id,
                })
              }
            >
              <img alt="" src={stampImageUrl("campaign-image", image.id)} />
              <span className="terrain-stamp-controls__name">{image.name}</span>
            </button>
          ))}
        </div>
      )}
      {onUploadImage && (
        <label className="terrain-stamp-controls__upload">
          {uploading ? "Загрузка…" : "Загрузить картинку (PNG, WebP, JPEG)"}
          <input
            aria-label="Загрузить картинку для штампа"
            type="file"
            accept="image/png,image/webp,image/jpeg"
            disabled={uploading}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void uploadImage(file);
            }}
          />
        </label>
      )}
      {uploadError && <span role="alert">{uploadError}</span>}
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
    </section>,
    document.body,
  );
}
