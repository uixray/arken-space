import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AssetDto, GameSnapshot, SceneDto } from "@arken/contracts";
import { Button, Label } from "@gravity-ui/uikit";
import { ArkenDialog } from "./ArkenDialog";
import { ImageUploadField } from "./ImageUploadField";
import { FormInput, FormSelect } from "./GravityFormControls";
import { useEntityForm } from "./useEntityForm";
import { EntityConflictError } from "./useEntityForm";
import { ApiError } from "../api";

export type SceneDraft = {
  name: string;
  mapAssetId: string | null;
  width: number;
  height: number;
  gridEnabled: boolean;
  gridSize: number;
  gridOffsetX: number;
  gridOffsetY: number;
  gridColor: string;
  gridOpacity: number;
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
};

function draftFromScene(scene?: SceneDto): SceneDraft {
  return {
    name: scene?.name ?? "Новая сцена",
    mapAssetId: scene?.mapAssetId ?? null,
    width: scene?.width ?? 1920,
    height: scene?.height ?? 1080,
    gridEnabled: scene?.grid.enabled ?? true,
    gridSize: scene?.grid.size ?? 64,
    gridOffsetX: scene?.grid.offsetX ?? 0,
    gridOffsetY: scene?.grid.offsetY ?? 0,
    gridColor: scene?.grid.color ?? "#c8b78b",
    gridOpacity: scene?.grid.opacity ?? 0.22,
    frameX: scene?.backgroundFrame.x ?? 0,
    frameY: scene?.backgroundFrame.y ?? 0,
    frameWidth: scene?.backgroundFrame.width ?? 1920,
    frameHeight: scene?.backgroundFrame.height ?? 1080,
  };
}

export function SceneManagerDialog({
  open,
  snapshot,
  viewedSceneId,
  onClose,
  onView,
  onPublish,
  onSave,
  onUpload,
  variant = "modal",
}: {
  open: boolean;
  snapshot: GameSnapshot;
  viewedSceneId: string | null;
  onClose: () => void;
  onView: (sceneId: string) => void;
  onPublish: (sceneId: string) => Promise<void>;
  onSave: (scene: SceneDto | null, draft: SceneDraft) => Promise<void>;
  onUpload: (file: File, kind: "MAP") => Promise<AssetDto>;
  variant?: "modal" | "workspace";
}) {
  const [editing, setEditing] = useState<SceneDto | "NEW" | null>(null);
  const broadcast = snapshot.scenes.find((scene) => scene.active);
  const placementCount = (sceneId: string) =>
    snapshot.tokens.filter((token) => token.sceneId === sceneId).length;

  return (
    <ArkenDialog
      open={open}
      footer={false}
      title="Сцены"
      variant={variant}
      onClose={onClose}
    >
      <div className="scene-manager-heading">
        <p>Подготавливайте сцену локально, не переключая игроков.</p>
        <Button view="action" onClick={() => setEditing("NEW")}>
          Создать сцену
        </Button>
      </div>
      <div className="scene-manager-list">
        {snapshot.scenes.map((scene) => {
          const viewed =
            scene.id === viewedSceneId || (!viewedSceneId && scene.active);
          return (
            <article className="scene-manager-card" key={scene.id}>
              <div>
                <strong>{scene.name}</strong>
                <span>{placementCount(scene.id)} токенов на сцене</span>
              </div>
              <div className="scene-manager-statuses">
                {viewed && <Label theme="info">Просматривается мастером</Label>}
                {scene.active && (
                  <Label theme="success">Показана игрокам</Label>
                )}
              </div>
              <div className="dialog-actions">
                <Button onClick={() => onView(scene.id)} disabled={viewed}>
                  Открыть для мастера
                </Button>
                <Button
                  view="action"
                  onClick={() => void onPublish(scene.id)}
                  disabled={scene.id === broadcast?.id}
                >
                  Показать игрокам
                </Button>
                <Button onClick={() => setEditing(scene)}>Настроить</Button>
              </div>
            </article>
          );
        })}
      </div>
      {editing && (
        <SceneEditor
          key={editing === "NEW" ? "new" : `${editing.id}:${editing.revision}`}
          scene={editing === "NEW" ? null : editing}
          maps={snapshot.assets.filter((asset) => asset.kind === "MAP")}
          onUpload={onUpload}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            await onSave(editing === "NEW" ? null : editing, draft);
            setEditing(null);
          }}
        />
      )}
    </ArkenDialog>
  );
}

function SceneEditor({
  scene,
  maps,
  onUpload,
  onCancel,
  onSave,
}: {
  scene: SceneDto | null;
  maps: AssetDto[];
  onUpload: (file: File, kind: "MAP") => Promise<AssetDto>;
  onCancel: () => void;
  onSave: (draft: SceneDraft) => Promise<void>;
}) {
  const initial = useMemo(() => draftFromScene(scene ?? undefined), [scene]);
  const [uploadFile, setUploadFile] = useState<File>();
  const form = useEntityForm(initial, async (draft) => {
    try {
      const savedDraft = uploadFile
        ? {
            ...draft,
            mapAssetId: (await onUpload(uploadFile, "MAP")).id,
          }
        : draft;
      await onSave(savedDraft);
      setUploadFile(undefined);
      return savedDraft;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409)
        throw new EntityConflictError("Сцена изменилась на сервере.", initial);
      throw error;
    }
  });
  const [aspectLocked, setAspectLocked] = useState(true);
  const selectedMap = maps.find(
    (asset) => asset.id === form.state.draft.mapAssetId,
  );

  useEffect(() => form.replace(initial), [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const number = (key: keyof SceneDraft, value: string) =>
    form.update({ [key]: Number(value) } as Partial<SceneDraft>);
  const fitMap = () => {
    const mapWidth = selectedMap?.width ?? form.state.draft.frameWidth;
    const mapHeight = selectedMap?.height ?? form.state.draft.frameHeight;
    const scale = Math.min(
      form.state.draft.width / Math.max(mapWidth, 1),
      form.state.draft.height / Math.max(mapHeight, 1),
    );
    const width = mapWidth * scale;
    const height = mapHeight * scale;
    form.update({
      frameWidth: width,
      frameHeight: height,
      frameX: (form.state.draft.width - width) / 2,
      frameY: (form.state.draft.height - height) / 2,
    });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await form.submit();
  };

  return (
    <ArkenDialog
      open
      footer={false}
      title={scene ? `Настройка: ${scene.name}` : "Новая сцена"}
      onClose={onCancel}
    >
      <form className="scene-editor" onSubmit={submit}>
        <label className="field">
          Название
          <FormInput
            value={form.state.draft.name}
            onChange={(e) => form.update({ name: e.target.value })}
          />
        </label>
        <label className="field">
          Карта
          <FormSelect
            value={form.state.draft.mapAssetId ?? ""}
            onChange={(e) =>
              form.update({ mapAssetId: e.target.value || null })
            }
          >
            <option value="">Без карты</option>
            {maps.map((map) => (
              <option key={map.id} value={map.id}>
                {map.name}
              </option>
            ))}
          </FormSelect>
        </label>
        {selectedMap?.url && (
          <img
            className="scene-map-preview"
            src={selectedMap.url}
            alt={`Предпросмотр карты ${selectedMap.name}`}
          />
        )}
        <ImageUploadField
          label="Загрузить новую карту"
          value={uploadFile}
          onUpdate={setUploadFile}
        />
        <fieldset>
          <legend>Игровая область</legend>
          <div className="scene-form-grid">
            <label>
              Ширина
              <FormInput
                type="number"
                min={320}
                max={16384}
                value={form.state.draft.width}
                onChange={(e) => number("width", e.target.value)}
              />
            </label>
            <label>
              Высота
              <FormInput
                type="number"
                min={320}
                max={16384}
                value={form.state.draft.height}
                onChange={(e) => number("height", e.target.value)}
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Сетка</legend>
          <label>
            <input
              type="checkbox"
              checked={form.state.draft.gridEnabled}
              onChange={(e) => form.update({ gridEnabled: e.target.checked })}
            />{" "}
            Показывать сетку
          </label>
          <div className="scene-form-grid">
            <label>
              Размер клетки
              <FormInput
                type="number"
                min={16}
                max={256}
                value={form.state.draft.gridSize}
                onChange={(e) => number("gridSize", e.target.value)}
              />
            </label>
            <label>
              Смещение X
              <FormInput
                type="number"
                value={form.state.draft.gridOffsetX}
                onChange={(e) => number("gridOffsetX", e.target.value)}
              />
            </label>
            <label>
              Смещение Y
              <FormInput
                type="number"
                value={form.state.draft.gridOffsetY}
                onChange={(e) => number("gridOffsetY", e.target.value)}
              />
            </label>
            <label>
              Цвет
              <FormInput
                type="color"
                value={form.state.draft.gridColor}
                onChange={(e) => form.update({ gridColor: e.target.value })}
              />
            </label>
            <label>
              Непрозрачность
              <FormInput
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={form.state.draft.gridOpacity}
                onChange={(e) => number("gridOpacity", e.target.value)}
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Рамка изображения</legend>
          <label>
            <input
              type="checkbox"
              checked={aspectLocked}
              onChange={(e) => setAspectLocked(e.target.checked)}
            />{" "}
            Сохранять пропорции
          </label>
          <Button type="button" onClick={fitMap}>
            Вписать карту
          </Button>
          <div className="scene-form-grid">
            {(["frameX", "frameY", "frameWidth", "frameHeight"] as const).map(
              (key) => (
                <label key={key}>
                  {key.replace("frame", "")}
                  <FormInput
                    type="number"
                    min={
                      key.includes("Width") || key.includes("Height")
                        ? 16
                        : undefined
                    }
                    value={form.state.draft[key]}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (
                        aspectLocked &&
                        selectedMap &&
                        (key === "frameWidth" || key === "frameHeight")
                      ) {
                        const ratio =
                          (selectedMap.width ?? form.state.draft.frameWidth) /
                          Math.max(
                            selectedMap.height ?? form.state.draft.frameHeight,
                            1,
                          );
                        form.update(
                          key === "frameWidth"
                            ? { frameWidth: value, frameHeight: value / ratio }
                            : { frameHeight: value, frameWidth: value * ratio },
                        );
                      } else number(key, e.target.value);
                    }}
                  />
                </label>
              ),
            )}
          </div>
        </fieldset>
        {form.state.error && (
          <div className="field-error">{form.state.error}</div>
        )}
        {form.state.status === "conflict" && (
          <div className="field-error">
            Сцена изменилась на сервере. Закройте форму и откройте её снова.
          </div>
        )}
        <div className="dialog-actions">
          <Button
            type="submit"
            view="action"
            loading={form.state.status === "saving"}
            disabled={!form.dirty && !uploadFile}
          >
            Сохранить
          </Button>
          <Button type="button" onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </form>
    </ArkenDialog>
  );
}
