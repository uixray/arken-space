import { memo, useRef } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { AppIcon } from "./ui/AppIcon";
import { RenameIcon, ScenePickerIcon } from "./ui/icons";
import { useDismissibleDetails } from "./ui/dismissible-details";

export interface ScenePickerProps {
  activeScene: GameSnapshot["scenes"][number] | null | undefined;
  scenes: GameSnapshot["scenes"];
  assets: GameSnapshot["assets"];
  tokens: GameSnapshot["tokens"];
  isGm: boolean;
  isPreview: boolean;
  onSelectScene: (sceneId: string) => void;
  onEditScene?: (sceneId: string) => void;
}

export const ScenePicker = memo(function ScenePicker({
  activeScene,
  scenes,
  assets,
  tokens,
  isGm,
  isPreview,
  onSelectScene,
  onEditScene,
}: ScenePickerProps) {
  const scenePickerRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(scenePickerRef, undefined, {
    closeOnViewportChange: true,
  });

  if (!isGm || isPreview) {
    return (
      <div
        className="scene-picker scene-picker--readonly"
        aria-label="Активная сцена"
      >
        <span>{activeScene?.name ?? "Сцена не выбрана"}</span>
      </div>
    );
  }

  const activeAsset = activeScene?.mapAssetId
    ? assets.find((asset) => asset.id === activeScene.mapAssetId)
    : undefined;

  const syncPopupBounds = (details: HTMLDetailsElement) => {
    const summary = details.querySelector<HTMLElement>("summary");
    if (summary) {
      const rect = summary.getBoundingClientRect();
      details.style.setProperty(
        "--details-popup-max-height",
        `${Math.max(0, window.innerHeight - rect.bottom - 12)}px`,
      );
      details.style.setProperty(
        "--details-popup-max-width",
        `${Math.max(0, window.innerWidth - rect.left - 8)}px`,
      );
    }
  };

  const moveChoiceFocus = (key: string, fromSummary: boolean) => {
    const details = scenePickerRef.current;
    if (!details) return;
    syncPopupBounds(details);
    const choices = Array.from(
      details.querySelectorAll<HTMLButtonElement>(
        '.scene-picker__menu button[role="menuitemradio"]',
      ),
    );
    if (choices.length === 0) return;
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    const selected = choices.findIndex(
      (choice) => choice.getAttribute("aria-checked") === "true",
    );
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? choices.length - 1
          : fromSummary
            ? Math.max(0, selected)
            : (index + (key === "ArrowDown" ? 1 : -1) + choices.length) %
              choices.length;
    details.open = true;
    const target = choices[next];
    target?.focus({ preventScroll: true });
    const menu = details.querySelector<HTMLElement>(".scene-picker__menu");
    if (target && menu) {
      // Scroll only the popup. Scrolling its ancestor closes the anchored
      // details through useDismissibleDetails.
      const item = target.getBoundingClientRect();
      const popup = menu.getBoundingClientRect();
      if (item.bottom > popup.bottom)
        menu.scrollTop += item.bottom - popup.bottom;
      else if (item.top < popup.top) menu.scrollTop += item.top - popup.top;
    }
  };

  return (
    <details
      ref={scenePickerRef}
      className="scene-picker"
      onToggle={(event) => {
        if (event.currentTarget.open) syncPopupBounds(event.currentTarget);
      }}
    >
      <summary
        aria-label="Выбрать просматриваемую сцену"
        aria-haspopup="menu"
        aria-controls="scene-picker-options"
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          moveChoiceFocus(event.key, true);
        }}
      >
        {activeAsset ? (
          <img src={activeAsset.url} alt="" />
        ) : (
          <span className="scene-picker__placeholder" aria-hidden="true" />
        )}
        <span>{activeScene?.name ?? "Сцена не выбрана"}</span>
        <AppIcon icon={ScenePickerIcon} />
      </summary>
      <div
        className="scene-picker__menu"
        id="scene-picker-options"
        role="menu"
        aria-label="Сцены"
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          moveChoiceFocus(event.key, false);
        }}
      >
        {scenes.map((scene) => {
          const background = assets.find(
            (asset) => asset.id === scene.mapAssetId,
          );
          const tokenCount = tokens.filter(
            (token) => token.sceneId === scene.id,
          ).length;
          return (
            <div
              key={scene.id}
              className="scene-picker__row"
              role="presentation"
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={scene.id === activeScene?.id}
                onClick={(event) => {
                  onSelectScene(scene.id);
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                  scenePickerRef.current?.querySelector("summary")?.focus();
                }}
              >
                {background ? (
                  <img src={background.url} alt="" />
                ) : (
                  <span
                    className="scene-picker__placeholder"
                    aria-hidden="true"
                  />
                )}
                <span>
                  <strong>{scene.name}</strong>
                  <small>{tokenCount} токенов</small>
                </span>
              </button>
              {onEditScene && (
                <button
                  type="button"
                  className="scene-picker__edit"
                  role="menuitem"
                  aria-label={`Редактировать сцену «${scene.name}»`}
                  title="Редактировать сцену"
                  onClick={() => {
                    scenePickerRef.current?.removeAttribute("open");
                    scenePickerRef.current?.querySelector("summary")?.focus();
                    onEditScene(scene.id);
                  }}
                >
                  <AppIcon icon={RenameIcon} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
});
