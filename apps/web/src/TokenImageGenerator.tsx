import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { AssetDto } from "@arken/contracts";
import { Button } from "./design-system/Button";
import { AppIcon } from "./ui/AppIcon";
import { AddIcon, DecreaseIcon } from "./ui/icons";
import {
  TOKEN_FRAME_PREVIEW_COLORS,
  resolveTokenImagePreviewCrop,
} from "./token-image-preview";
import {
  DEFAULT_TOKEN_IMAGE_TRANSFORM,
  TOKEN_FRAME_PRESETS,
  clampTokenImageTransform,
  tokenImageCropSize,
  tokenImageTransformForKey,
  type TokenFramePreset,
  type TokenImageTransform,
} from "./token-image-editor-state";

const copy = {
  generator: "Генератор токена",
  uploadSource: 'Сначала загрузите исходное изображение в разделе "Файлы".',
  uploadHere: "Сначала загрузите исходное изображение здесь.",
  fromImage: "Из изображения",
  sourceImage: "Исходное изображение",
  previewLabel:
    "Интерактивный предпросмотр токена. Перетаскивайте изображение или используйте клавиши стрелок. Home или R сбрасывает кадрирование.",
  hint: "Перетаскивайте изображение или используйте клавиши стрелок. Shift делает шаг крупнее. Home / R сбрасывает кадрирование.",
  zoom: "Масштаб",
  zoomLabel: "Масштаб изображения токена",
  zoomPercentLabel: "Масштаб изображения токена, проценты",
  frame: "Рамка",
  chooseFrame: "Выберите рамку токена",
  noFrame: "Без рамки",
  reset: "Сбросить",
  create: "Создать изображение токена",
  failed: "Не удалось сгенерировать изображение токена.",
};

const frameLabels: Record<TokenFramePreset, string> = {
  NONE: copy.noFrame,
  BRONZE: "Бронза",
  SILVER: "Серебро",
  OBSIDIAN: "Обсидиан",
};

type Props = {
  imageAssets: AssetDto[];
  uploadedSourceId?: string;
  selectedSourceId?: string;
  disabled?: boolean;
  embedded?: boolean;
  onDraftChange?: (draft: TokenImageDraft | null) => void;
  onGenerate?: (input: TokenImageDraft) => Promise<AssetDto>;
  onGenerated?: (asset: AssetDto) => void;
};

export type TokenImageDraft = {
  sourceAssetId: string;
  cropX: number;
  cropY: number;
  zoom: number;
  frame: TokenFramePreset;
  name?: string;
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
  uploadedSourceId,
  selectedSourceId,
  disabled = false,
  embedded = false,
  onDraftChange,
  onGenerate,
  onGenerated,
}: Props) {
  const [sourceAssetId, setSourceAssetId] = useState(
    selectedSourceId ?? (embedded ? "" : (imageAssets[0]?.id ?? "")),
  );
  const [transform, setTransform] = useState<TokenImageTransform>(
    DEFAULT_TOKEN_IMAGE_TRANSFORM,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(
    () => new Set(),
  );
  const dragStart = useRef<{
    pointerId: number;
    x: number;
    y: number;
    transform: TokenImageTransform;
    sourceDimensions: { width: number; height: number };
    cropSize: number;
  } | null>(null);
  const consumedUploadId = useRef<string | undefined>(undefined);
  const source =
    imageAssets.find((asset) => asset.id === sourceAssetId) ?? null;
  const previewKey = source ? `${source.id}:${source.url}` : "";
  const sourceDimensions = {
    width:
      source?.width && Number.isFinite(source.width) && source.width > 0
        ? source.width
        : 1,
    height:
      source?.height && Number.isFinite(source.height) && source.height > 0
        ? source.height
        : 1,
  };
  const [zoomText, setZoomText] = useState("100");

  const reportDraft = (next: TokenImageTransform, asset = source) => {
    onDraftChange?.(
      asset
        ? { sourceAssetId: asset.id, ...next, name: sourceName(asset) }
        : null,
    );
  };

  useEffect(() => {
    if (selectedSourceId !== undefined) {
      if (selectedSourceId !== sourceAssetId) {
        setSourceAssetId(selectedSourceId);
        setTransform({ ...DEFAULT_TOKEN_IMAGE_TRANSFORM });
        setZoomText("100");
      }
      // Controlled empty selection is an intentional "no source", not a
      // request to choose the first library image on the following render.
      return;
    }
    if (!uploadedSourceId) consumedUploadId.current = undefined;
    if (
      uploadedSourceId &&
      consumedUploadId.current !== uploadedSourceId &&
      imageAssets.some((asset) => asset.id === uploadedSourceId)
    ) {
      // Consume upload intent once; subsequent manual choices and bootstrap
      // refreshes must not reselect this asset or reset the edited transform.
      consumedUploadId.current = uploadedSourceId;
      setSourceAssetId(uploadedSourceId);
      setTransform({ ...DEFAULT_TOKEN_IMAGE_TRANSFORM });
      setZoomText("100");
      return;
    }
    if (
      sourceAssetId &&
      imageAssets.some((asset) => asset.id === sourceAssetId)
    )
      return;
    setSourceAssetId(imageAssets[0]?.id ?? "");
    setTransform({ ...DEFAULT_TOKEN_IMAGE_TRANSFORM });
    setZoomText("100");
  }, [imageAssets, selectedSourceId, sourceAssetId, uploadedSourceId]);

  useEffect(() => {
    dragStart.current = null;
  }, [sourceAssetId]);

  const updateTransform = (next: TokenImageTransform) => {
    const clamped = clampTokenImageTransform(next, sourceDimensions);
    setTransform(clamped);
    setZoomText(String(Math.round(clamped.zoom * 100)));
    reportDraft(clamped);
  };

  const clearDrag = () => {
    dragStart.current = null;
  };

  const onPreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!source || disabled || saving) return;
    const next = tokenImageTransformForKey(
      transform,
      event.key,
      event.shiftKey,
      sourceDimensions,
    );
    if (!next) return;
    event.preventDefault();
    if (event.key === "Home" || event.key === "r" || event.key === "R")
      clearDrag();
    updateTransform(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      !source ||
      disabled ||
      saving ||
      event.button !== 0 ||
      dragStart.current
    )
      return;
    dragStart.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      transform: { ...transform },
      sourceDimensions: { ...sourceDimensions },
      cropSize: tokenImageCropSize(sourceDimensions, transform.zoom),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!source || disabled || saving) return;
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // React can batch a pointer burst before re-rendering. Every move must be
    // derived from the immutable pointer-down crop, not a render-closed one.
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const next = clampTokenImageTransform(
      {
        ...start.transform,
        // Dragging the image right reveals its left side, hence inverted crop.
        cropX:
          start.transform.cropX -
          (dx / box.width) * (start.cropSize / start.sourceDimensions.width),
        cropY:
          start.transform.cropY -
          (dy / box.height) * (start.cropSize / start.sourceDimensions.height),
      },
      start.sourceDimensions,
    );
    setTransform(next);
    reportDraft(next);
  };

  const generate = async () => {
    if (!source || saving || disabled || !onGenerate || !onGenerated) return;
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

  const commitZoomText = () => {
    if (!source || disabled || saving) {
      setZoomText(String(Math.round(transform.zoom * 100)));
      return;
    }
    const percent = Number(zoomText);
    if (!Number.isFinite(percent) || percent <= 0) {
      setZoomText(String(Math.round(transform.zoom * 100)));
      return;
    }
    const normalizedPercent = Math.min(
      800,
      Math.max(100, Math.round(percent / 10) * 10),
    );
    clearDrag();
    updateTransform({ ...transform, zoom: normalizedPercent / 100 });
  };

  const changeZoom = (delta: number) => {
    clearDrag();
    const next = Math.round((transform.zoom + delta) * 10) / 10;
    updateTransform({ ...transform, zoom: next });
  };

  if (!imageAssets.length)
    return (
      <section className="token-image-generator token-image-generator--empty">
        <strong>{copy.generator}</strong>
        <p className="muted">
          {embedded ? copy.uploadHere : copy.uploadSource}
        </p>
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
            clearDrag();
            setSourceAssetId(event.target.value);
            const next = { ...DEFAULT_TOKEN_IMAGE_TRANSFORM };
            setTransform(next);
            setZoomText("100");
            reportDraft(
              next,
              imageAssets.find((asset) => asset.id === event.target.value) ??
                null,
            );
          }}
        >
          {embedded && <option value="">Выберите исходное изображение</option>}
          {imageAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </label>
      <div
        className={`token-image-preview token-image-preview--${transform.frame.toLowerCase()}`}
        tabIndex={source ? 0 : -1}
        role="group"
        aria-label={copy.previewLabel}
        aria-disabled={!source || disabled || saving || undefined}
        onKeyDown={onPreviewKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          if (dragStart.current?.pointerId === event.pointerId) clearDrag();
        }}
        onPointerCancel={(event) => {
          if (dragStart.current?.pointerId === event.pointerId) clearDrag();
        }}
        onLostPointerCapture={(event) => {
          if (dragStart.current?.pointerId === event.pointerId) clearDrag();
        }}
      >
        {source && (
          <img
            key={previewKey}
            src={source.url}
            alt=""
            draggable={false}
            style={imageStyle}
            onError={() =>
              setFailedPreviews((previous) => new Set(previous).add(previewKey))
            }
            onLoad={() =>
              setFailedPreviews((previous) => {
                if (!previous.has(previewKey)) return previous;
                const next = new Set(previous);
                next.delete(previewKey);
                return next;
              })
            }
          />
        )}
        <TokenFramePreview frame={transform.frame} />
      </div>
      {source && failedPreviews.has(previewKey) && (
        <p className="field-error" role="alert">
          Не удалось загрузить предпросмотр. Выберите другое изображение или
          откройте редактор заново.
        </p>
      )}
      <p className="token-image-generator__hint">{copy.hint}</p>
      <div className="token-image-generator__zoom">
        <span className="token-image-generator__zoom-heading">
          {copy.zoom}, %
        </span>
        <div className="token-image-generator__zoom-controls">
          <Button
            type="button"
            aria-label="Уменьшить масштаб"
            onClick={() => changeZoom(-0.1)}
            disabled={!source || disabled || saving || transform.zoom <= 1}
          >
            <AppIcon icon={DecreaseIcon} />
          </Button>
          <label>
            <span className="arken-visually-hidden">
              {copy.zoomPercentLabel}
            </span>
            <input
              aria-label={copy.zoomPercentLabel}
              type="number"
              min="100"
              max="800"
              step="10"
              inputMode="numeric"
              value={zoomText}
              disabled={!source || disabled || saving}
              onChange={(event) => setZoomText(event.target.value)}
              onBlur={commitZoomText}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitZoomText();
              }}
            />
          </label>
          <Button
            type="button"
            aria-label="Увеличить масштаб"
            onClick={() => changeZoom(0.1)}
            disabled={!source || disabled || saving || transform.zoom >= 8}
          >
            <AppIcon icon={AddIcon} />
          </Button>
        </div>
        <label>
          <span className="arken-visually-hidden">{copy.zoomLabel}</span>
          <input
            aria-label={copy.zoomLabel}
            type="range"
            min="1"
            max="8"
            step="0.1"
            value={transform.zoom}
            disabled={!source || disabled || saving}
            onChange={(event) => {
              clearDrag();
              updateTransform({
                ...transform,
                zoom: Number(event.target.value),
              });
            }}
          />
        </label>
      </div>
      <fieldset
        className="token-image-generator__frames"
        disabled={!source || disabled || saving}
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
                onChange={() => {
                  clearDrag();
                  updateTransform({ ...transform, frame });
                }}
              />
              {frameLabels[frame]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="token-image-generator__actions">
        <Button
          type="button"
          onClick={() => {
            clearDrag();
            updateTransform({ ...DEFAULT_TOKEN_IMAGE_TRANSFORM });
          }}
          disabled={!source || disabled || saving}
        >
          {copy.reset}
        </Button>
        {!embedded && (
          <Button
            type="button"
            view="action"
            onClick={() => void generate()}
            loading={saving}
            disabled={disabled || saving || !source}
          >
            {copy.create}
          </Button>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
