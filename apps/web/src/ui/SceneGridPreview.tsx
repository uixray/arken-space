import { useId } from "react";
import type { AssetDto } from "@arken/contracts";
import type { SceneDraft } from "./SceneManagerDialog";
import "./SceneGridPreview.css";

function safeMapUrl(url: string | undefined) {
  if (
    !url ||
    Array.from(url).some((char) => char.charCodeAt(0) <= 32 || char === "\\")
  )
    return undefined;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

/** Read-only draft projection. It never supplies grid state to gameplay. */
export function SceneGridPreview({
  draft,
  map,
  invalidReason,
}: {
  draft: SceneDraft;
  map?: AssetDto;
  invalidReason?: string;
}) {
  const id = useId();
  const patternId = `scene-grid-${id}`;
  const titleId = `scene-preview-title-${id}`;
  const mapUrl = safeMapUrl(map?.url);

  return (
    <figure className="scene-grid-preview" aria-labelledby={titleId}>
      <strong id={titleId}>Предпросмотр сцены</strong>
      {invalidReason ? (
        <p className="scene-grid-preview__invalid" role="status">
          Предпросмотр недоступен: {invalidReason}
        </p>
      ) : (
        <svg
          className="scene-grid-preview__image"
          role="img"
          aria-label="Карта и сетка — черновик сцены"
          viewBox={`0 0 ${draft.width} ${draft.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern
              id={patternId}
              patternUnits="userSpaceOnUse"
              x={draft.gridOffsetX % draft.gridSize}
              y={draft.gridOffsetY % draft.gridSize}
              width={draft.gridSize}
              height={draft.gridSize}
            >
              <path
                d={`M ${draft.gridSize} 0 H 0 V ${draft.gridSize}`}
                fill="none"
                stroke={draft.gridColor}
                strokeWidth={1}
              />
            </pattern>
          </defs>
          <svg width={draft.width} height={draft.height} overflow="hidden">
            <rect
              className="scene-grid-preview__world"
              width={draft.width}
              height={draft.height}
            />
            {mapUrl && (
              <image
                href={mapUrl}
                x={draft.frameX}
                y={draft.frameY}
                width={draft.frameWidth}
                height={draft.frameHeight}
                // Konva's background image occupies this exact persisted frame.
                preserveAspectRatio="none"
              />
            )}
            {draft.gridEnabled && (
              <rect
                className="scene-grid-preview__grid"
                width={draft.width}
                height={draft.height}
                fill={`url(#${patternId})`}
                opacity={draft.gridOpacity}
              />
            )}
          </svg>
        </svg>
      )}
      <figcaption>
        Только черновик этой формы. Карта игроков и привязка на игровом поле не
        меняются до сохранения.
        {!invalidReason && (
          <span className="scene-grid-preview__state">
            {!draft.gridEnabled
              ? "Сетка выключена."
              : draft.gridOpacity === 0
                ? "Линии невидимы; привязка включена."
                : `Клетка ${draft.gridSize} px; привязка включена.`}
          </span>
        )}
        {map && !mapUrl && (
          <span className="scene-grid-preview__state">
            Карта недоступна для безопасного предпросмотра.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
