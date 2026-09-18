import { useCallback, useEffect, useRef, useState } from "react";
import type { SceneDto } from "@arken/contracts";
import { useDismissibleDetails } from "../ui/dismissible-details";
import { AppIcon } from "../ui/AppIcon";
import { GridSettingsIcon } from "../ui/icons";

export interface GridSettingsProps {
  scene: SceneDto;
  onSave: (grid: SceneDto["grid"]) => Promise<void>;
  onPreview: (grid: SceneDto["grid"] | null) => void;
}

export function GridSettings({ scene, onSave, onPreview }: GridSettingsProps) {
  const [draft, setDraft] = useState(scene.grid);
  const [saving, setSaving] = useState(false);
  const settingsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => setDraft(scene.grid), [scene]);

  const dismissGridSettings = useCallback(() => {
    setDraft(scene.grid);
    onPreview(null);
  }, [onPreview, scene.grid]);

  useDismissibleDetails(settingsRef, dismissGridSettings);

  const closeSettings = (restoreLostFocus = false) => {
    const details = settingsRef.current;
    const summary = details?.querySelector<HTMLElement>("summary");
    if (
      details?.open &&
      (details.contains(document.activeElement) ||
        (restoreLostFocus && document.activeElement === document.body)) &&
      summary?.getClientRects().length &&
      !summary.closest("[hidden], [inert]")
    )
      summary.focus({ preventScroll: true });
    if (details) details.open = false;
  };

  const resetGrid = () => {
    const next = {
      enabled: true,
      size: 64,
      offsetX: 0,
      offsetY: 0,
      color: "#c8b78b",
      opacity: 0.22,
    };
    setDraft(next);
    onPreview(next);
  };

  return (
    <details className="grid-settings" ref={settingsRef}>
      <summary
        aria-label="Настройки сетки"
        title="Настройки сетки"
        className="toolbar-detail-trigger"
        data-tool="GRID"
      >
        <AppIcon icon={GridSettingsIcon} />
        <span className="map-tool__label">Сетка</span>
      </summary>
      <div className="grid-settings-popover">
        <label>
          Шаг
          <input
            type="number"
            min="16"
            max="256"
            value={draft.size}
            onChange={(event) => {
              const next = { ...draft, size: Number(event.target.value) };
              setDraft(next);
              onPreview(next);
            }}
          />
        </label>
        <label>
          Сдвиг X
          <input
            type="number"
            value={draft.offsetX}
            onChange={(event) => {
              const next = { ...draft, offsetX: Number(event.target.value) };
              setDraft(next);
              onPreview(next);
            }}
          />
        </label>
        <label>
          Сдвиг Y
          <input
            type="number"
            value={draft.offsetY}
            onChange={(event) => {
              const next = { ...draft, offsetY: Number(event.target.value) };
              setDraft(next);
              onPreview(next);
            }}
          />
        </label>
        <div className="inline-fields">
          <button type="button" onClick={resetGrid}>
            {"Сбросить"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              // Disabling Save can move native focus to body while awaiting.
              // Restore only that lost focus, not a newer external owner.
              const restoreLostFocus = Boolean(
                settingsRef.current?.contains(document.activeElement),
              );
              setSaving(true);
              try {
                await onSave(draft);
                onPreview(null);
                closeSettings(restoreLostFocus);
              } catch {
                // The shared mutation runner exposes the server error. Keep the
                // draft open so a conflict or validation failure can be fixed
                // and retried instead of looking like a successful reset.
              } finally {
                setSaving(false);
              }
            }}
          >
            Сохранить
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(scene.grid);
              onPreview(null);
              closeSettings();
            }}
          >
            Отмена
          </button>
        </div>
      </div>
    </details>
  );
}
