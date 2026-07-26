import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { AssetDto } from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import {
  TOKEN_FRAME_PREVIEW_COLORS,
  resolveTokenImagePreviewCrop,
} from "./token-image-preview";
import {
  DEFAULT_TOKEN_IMAGE_TRANSFORM,
  TOKEN_FRAME_PRESETS,
  clampTokenImageTransform,
  tokenImageTransformForKey,
  type TokenFramePreset,
  type TokenImageTransform,
} from "./token-image-editor-state";

const copy = {
  generator:
    "Генератор токена",
  uploadSource:
    'Сначала загрузите исходное изображение в разделе "Файлы".',
  fromImage: "Из IMAGE-asset",
  sourceImage:
    "Исходное изображение",
  previewLabel:
    "Интерактивный предпросмотр токена. Перетаскивайте изображение или используйте клавиши стрелок. Home или R сбрасывает кадрирование.",
  hint: "Перетаскивайте изображение или используйте клавиши стрелок. Shift делает шаг крупнее. Home / R сбрасывает кадрирование.",
  zoom: "Масштаб",
  zoomLabel:
    "Масштаб изображения токена",
  frame: "Рамка",
  chooseFrame:
    "Выберите рамку токена",
  noFrame: "Без рамки",
  reset: "Сбросить",
  create: "Создать TOKEN",
  failed:
    "Не удалось сгенерировать изображение токена.",
};

const frameLabels: Record<TokenFramePreset, string> = {
  NONE: copy.noFrame,
  BRONZE: "Бронза",
  SILVER: "Серебро",
  OBSIDIAN: "Обсидиан",
};

type Props = {
  imageAssets: AssetDto[];
  disabled?: boolean;
  onGenerate: (input: {
    sourceAssetId: string;
    cropX: number;
    cropY: number;
    zoom: number;
    frame: TokenFramePreset;
    name?: string;
  }) => Promise<AssetDto>;
  onGenerated: (asset: AssetDto) => void;
};

function sourceName(asset: AssetDto) {
  return asset.name.replace(/\.[^/.]+$/, "").slice(0, 90) || undefined;
}

function TokenFramePreview({ frame }: { frame: TokenFramePreset }) {
  if (frame === "NONE") return null;
  const [shadow, middle, highlight] = TOKEN_FRAME_PREVIEW_COLORS[frame];
  const gradientId = `token-frame-${frame.toLowerCase()}`;
  return (
    <svg
      className="token-image-preview__frame"
      viewBox="0 0 512 512"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={highlight} />
          <stop offset="0.48" stopColor={middle} />
          <stop offset="1" stopColor={shadow} />
        </linearGradient>
      </defs>
      <circle
        cx="256"
        cy="256"
        r="244"
        fill="none"
        stroke={shadow}
        strokeWidth="23"
      />
      <circle
        cx="256"
        cy="256"
        r="243"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="17"
      />
      <circle
        cx="256"
        cy="256"
        r="237"
        fill="none"
        stroke={highlight}
        strokeOpacity=".62"
        strokeWidth="2"
      />
    </svg>
  );
}

export function TokenImageGenerator({
  imageAssets,
  disabled = false,
  onGenerate,
  onGenerated,
}: Props) {
  const [sourceAssetId, setSourceAssetId] = useState(imageAssets[0]?.id ?? "");
  const [transform, setTransform] = useState<TokenImageTransform>(
    DEFAULT_TOKEN_IMAGE_TRANSFORM,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const source =
    imageAssets.find((asset) => asset.id === sourceAssetId) ?? null;

  const updateTransform = (next: TokenImageTransform) =>
    setTransform(clampTokenImageTransform(next));

  const onPreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = tokenImageTransformForKey(
      transform,
      event.key,
      event.shiftKey,
    );
    if (!next) return;
    event.preventDefault();
    setTransform(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragStart.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    dragStart.current = { x: event.clientX, y: event.clientY };
    setTransform((current) =>
      clampTokenImageTransform({
        ...current,
        // Dragging the image right reveals its left side, hence inverted crop.
        cropX: current.cropX - dx / box.width,
        cropY: current.cropY - dy / box.height,
      }),
    );
  };

  const generate = async () => {
    if (!source || saving || disabled) return;
    setSaving(true);
    setError("");
    try {
      const asset = await onGenerate({
        sourceAssetId: source.id,
        ...transform,
        name: sourceName(source),
      });
      onGenerated(asset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.failed);
    } finally {
      setSaving(false);
    }
  };

  if (!imageAssets.length)
    return (
      <section className="token-image-generator token-image-generator--empty">
        <strong>{copy.generator}</strong>
        <p className="muted">{copy.uploadSource}</p>
      </section>
    );

  const sourceWidth = source?.width && source.width > 0 ? source.width : 1;
  const sourceHeight = source?.height && source.height > 0 ? source.height : 1;
  const previewCrop = resolveTokenImagePreviewCrop({
    width: sourceWidth,
    height: sourceHeight,
    cropX: transform.cropX,
    cropY: transform.cropY,
    zoom: transform.zoom,
  });
  const imageStyle = {
    width: `${previewCrop.imageWidthPercent}%`,
    height: `${previewCrop.imageHeightPercent}%`,
    left: `${previewCrop.imageLeftPercent}%`,
    top: `${previewCrop.imageTopPercent}%`,
  };

  return (
    <section
      className="token-image-generator"
      aria-labelledby="token-image-generator-title"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">{copy.fromImage}</span>
          <h3 id="token-image-generator-title">{copy.generator}</h3>
        </div>
        <span className="revision">512 x 512 WebP</span>
      </div>
      <label>
        {copy.sourceImage}
        <select
          value={sourceAssetId}
          disabled={disabled || saving}
          onChange={(event) => {
            setSourceAssetId(event.target.value);
            setTransform({ ...DEFAULT_TOKEN_IMAGE_TRANSFORM });
          }}
        >
          {imageAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </label>
      <div
        className={`token-image-preview token-image-preview--${transform.frame.toLowerCase()}`}
        tabIndex={0}
        role="group"
        aria-label={copy.previewLabel}
        onKeyDown={onPreviewKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          dragStart.current = null;
        }}
        onPointerCancel={() => {
          dragStart.current = null;
        }}
      >
        {source && (
          <img src={source.url} alt="" draggable={false} style={imageStyle} />
        )}
        <TokenFramePreview frame={transform.frame} />
      </div>
      <p className="token-image-generator__hint">{copy.hint}</p>
      <label>
        {copy.zoom}: {transform.zoom.toFixed(1)}x
        <input
          aria-label={copy.zoomLabel}
          type="range"
          min="1"
          max="8"
          step="0.1"
          value={transform.zoom}
          disabled={disabled || saving}
          onChange={(event) =>
            updateTransform({ ...transform, zoom: Number(event.target.value) })
          }
        />
      </label>
      <fieldset
        className="token-image-generator__frames"
        disabled={disabled || saving}
      >
        <legend>{copy.frame}</legend>
        <div role="radiogroup" aria-label={copy.chooseFrame}>
          {TOKEN_FRAME_PRESETS.map((frame) => (
            <label key={frame} className="token-image-generator__frame-option">
              <input
                type="radio"
                name="token-frame"
                value={frame}
                checked={transform.frame === frame}
                onChange={() => updateTransform({ ...transform, frame })}
              />
              {frameLabels[frame]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="token-image-generator__actions">
        <Button
          type="button"
          onClick={() => setTransform({ ...DEFAULT_TOKEN_IMAGE_TRANSFORM })}
          disabled={disabled || saving}
        >
          {copy.reset}
        </Button>
        <Button
          type="button"
          view="action"
          onClick={() => void generate()}
          loading={saving}
          disabled={disabled || saving || !source}
        >
          {copy.create}
        </Button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
