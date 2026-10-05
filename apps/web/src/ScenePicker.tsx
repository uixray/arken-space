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

  return (
    <details ref={scenePickerRef} className="scene-picker">
      <summary
        aria-label="Выбрать просматриваемую сцену"
        aria-haspopup="menu"
        aria-controls="scene-picker-options"
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
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
          );
          const index = controls.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? controls.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    controls.length) %
                  controls.length;
          controls[next]?.focus();
          event.preventDefault();
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
