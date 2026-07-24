import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { AssetDto } from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import { resolveTokenImagePreviewCrop } from "./token-image-preview";
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
    "\u0413\u0435\u043d\u0435\u0440\u0430\u0442\u043e\u0440 \u0442\u043e\u043a\u0435\u043d\u0430",
  uploadSource:
    '\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0438\u0441\u0445\u043e\u0434\u043d\u043e\u0435 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435 \u0432 \u0440\u0430\u0437\u0434\u0435\u043b\u0435 "\u0424\u0430\u0439\u043b\u044b".',
  fromImage: "\u0418\u0437 IMAGE-asset",
  sourceImage:
    "\u0418\u0441\u0445\u043e\u0434\u043d\u043e\u0435 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435",
  previewLabel:
    "\u0418\u043d\u0442\u0435\u0440\u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u043f\u0440\u0435\u0434\u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440 \u0442\u043e\u043a\u0435\u043d\u0430. \u041f\u0435\u0440\u0435\u0442\u0430\u0441\u043a\u0438\u0432\u0430\u0439\u0442\u0435 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435 \u0438\u043b\u0438 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439\u0442\u0435 \u043a\u043b\u0430\u0432\u0438\u0448\u0438 \u0441\u0442\u0440\u0435\u043b\u043e\u043a. Home \u0438\u043b\u0438 R \u0441\u0431\u0440\u0430\u0441\u044b\u0432\u0430\u0435\u0442 \u043a\u0430\u0434\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435.",
  hint: "\u041f\u0435\u0440\u0435\u0442\u0430\u0441\u043a\u0438\u0432\u0430\u0439\u0442\u0435 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435 \u0438\u043b\u0438 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439\u0442\u0435 \u043a\u043b\u0430\u0432\u0438\u0448\u0438 \u0441\u0442\u0440\u0435\u043b\u043e\u043a. Shift \u0434\u0435\u043b\u0430\u0435\u0442 \u0448\u0430\u0433 \u043a\u0440\u0443\u043f\u043d\u0435\u0435. Home / R \u0441\u0431\u0440\u0430\u0441\u044b\u0432\u0430\u0435\u0442 \u043a\u0430\u0434\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435.",
  zoom: "\u041c\u0430\u0441\u0448\u0442\u0430\u0431",
  zoomLabel:
    "\u041c\u0430\u0441\u0448\u0442\u0430\u0431 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f \u0442\u043e\u043a\u0435\u043d\u0430",
  frame: "\u0420\u0430\u043c\u043a\u0430",
  chooseFrame:
    "\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0440\u0430\u043c\u043a\u0443 \u0442\u043e\u043a\u0435\u043d\u0430",
  noFrame: "\u0411\u0435\u0437 \u0440\u0430\u043c\u043a\u0438",
  reset: "\u0421\u0431\u0440\u043e\u0441\u0438\u0442\u044c",
  create: "\u0421\u043e\u0437\u0434\u0430\u0442\u044c TOKEN",
  failed:
    "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u0433\u0435\u043d\u0435\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435 \u0442\u043e\u043a\u0435\u043d\u0430.",
};

const frameLabels: Record<TokenFramePreset, string> = {
  NONE: copy.noFrame,
  BRONZE: "\u0411\u0440\u043e\u043d\u0437\u0430",
  SILVER: "\u0421\u0435\u0440\u0435\u0431\u0440\u043e",
  OBSIDIAN: "\u041e\u0431\u0441\u0438\u0434\u0438\u0430\u043d",
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
        <span className="token-image-preview__frame" aria-hidden="true" />
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
