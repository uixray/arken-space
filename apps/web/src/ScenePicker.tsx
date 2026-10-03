import { memo, useRef } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { AppIcon } from "./ui/AppIcon";
import { ScenePickerIcon } from "./ui/icons";
import { useDismissibleDetails } from "./ui/dismissible-details";

export interface ScenePickerProps {
  activeScene: GameSnapshot["scenes"][number] | null | undefined;
  scenes: GameSnapshot["scenes"];
  assets: GameSnapshot["assets"];
  tokens: GameSnapshot["tokens"];
  isGm: boolean;
  isPreview: boolean;
  onSelectScene: (sceneId: string) => void;
}

export const ScenePicker = memo(function ScenePicker({
  activeScene,
  scenes,
  assets,
  tokens,
  isGm,
  isPreview,
  onSelectScene,
}: ScenePickerProps) {
  const scenePickerRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(scenePickerRef, undefined, {
    listbox: true,
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
        aria-haspopup="listbox"
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
        role="listbox"
        aria-label="Сцены"
      >
        {scenes.map((scene) => {
          const background = assets.find(
            (asset) => asset.id === scene.mapAssetId,
          );
          const tokenCount = tokens.filter(
            (token) => token.sceneId === scene.id,
          ).length;
          return (
            <button
              key={scene.id}
              type="button"
              role="option"
              aria-selected={scene.id === activeScene?.id}
              onClick={(event) => {
                onSelectScene(scene.id);
                event.currentTarget
                  .closest("details")
                  ?.removeAttribute("open");
                scenePickerRef.current
                  ?.querySelector("summary")
                  ?.focus();
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
          );
        })}
      </div>
    </details>
  );
});
