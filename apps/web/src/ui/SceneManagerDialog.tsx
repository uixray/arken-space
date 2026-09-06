import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
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

const numericFields = {
  width: { label: "Ширина (px)", min: 320, max: 16384, step: 1 },
  height: { label: "Высота (px)", min: 320, max: 16384, step: 1 },
  gridSize: { label: "Размер клетки (px)", min: 16, max: 256, step: 1 },
  gridOffsetX: { label: "Смещение X (px)", step: "any" },
  gridOffsetY: { label: "Смещение Y (px)", step: "any" },
  gridOpacity: { label: "Непрозрачность (0–1)", min: 0, max: 1, step: "any" },
  frameX: {
    label: "Позиция X рамки (px)",
    min: -16384,
    max: 16384,
    step: "any",
  },
  frameY: {
    label: "Позиция Y рамки (px)",
    min: -16384,
    max: 16384,
    step: "any",
  },
  frameWidth: { label: "Ширина рамки (px)", min: 16, max: 16384, step: "any" },
  frameHeight: { label: "Высота рамки (px)", min: 16, max: 16384, step: "any" },
} satisfies Record<
  string,
  { label: string; min?: number; max?: number; step: number | "any" }
>;
type NumericField = keyof typeof numericFields;

function numericHint(key: NumericField) {
  const field: { min?: number; max?: number; step: number | "any" } =
    numericFields[key];
  if (key === "gridOpacity")
    return "От 0 до 1: 0 — линии не видны, 1 — непрозрачные линии.";
  if (field.min === undefined)
    return "Любое конечное число в px; допустимы отрицательные и дробные значения.";
  return `От ${field.min} до ${field.max} px${field.step === 1 ? ", целое число" : "; допустимы дробные значения"}.`;
}

function draftFromScene(scene?: SceneDto): SceneDraft {
  const backgroundFrame = scene?.backgroundFrame;
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
    // Older snapshots can contain scenes created before background framing was
    // persisted. An editor must still open so the GM can configure the scene.
    frameX: backgroundFrame?.x ?? 0,
    frameY: backgroundFrame?.y ?? 0,
    frameWidth: backgroundFrame?.width ?? 1920,
    frameHeight: backgroundFrame?.height ?? 1080,
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
                <Button
                  view="action"
                  onClick={() => onView(scene.id)}
                  disabled={viewed}
                >
                  Открыть для мастера
                </Button>
                {!scene.active && (
                  <Button onClick={() => void onPublish(scene.id)}>
                    Показать игрокам
                  </Button>
                )}
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
  // Keep intermediate text such as "-0." while the draft stays numeric.
  const [numericInputs, setNumericInputs] = useState<
    Partial<Record<NumericField, string>>
  >({});
  const fieldPrefix = useId();
  const selectedMap = maps.find(
    (asset) => asset.id === form.state.draft.mapAssetId,
  );

  useEffect(() => {
    form.replace(initial);
    setNumericInputs({});
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors: Partial<Record<keyof SceneDraft, string>> = {};
  if (
    !form.state.draft.name.trim() ||
    form.state.draft.name.trim().length > 100
  )
    errors.name = "Введите название от 1 до 100 символов.";
  for (const key of Object.keys(numericFields) as NumericField[]) {
    const field: { min?: number; max?: number; step: number | "any" } =
      numericFields[key];
    const value = form.state.draft[key];
    if (
      !Number.isFinite(value) ||
      (field.min !== undefined && value < field.min) ||
      (field.max !== undefined && value > field.max) ||
      (field.step === 1 && !Number.isInteger(value))
    )
      errors[key] = `Введите значение. ${numericHint(key)}`;
  }
  const invalid = Object.keys(errors).length > 0;
  const saveReason =
    form.state.status === "saving"
      ? "Сохраняем изменения…"
      : invalid
        ? "Исправьте отмеченные поля перед сохранением."
        : !form.dirty && !uploadFile
          ? "Нет изменений для сохранения."
          : undefined;
  const number = (key: NumericField, raw: string) => {
    const value = raw.trim() === "" ? Number.NaN : Number(raw);
    setNumericInputs((current) => ({ ...current, [key]: raw }));
    if (
      aspectLocked &&
      selectedMap &&
      (key === "frameWidth" || key === "frameHeight")
    ) {
      const ratio =
        (selectedMap.width ?? form.state.draft.frameWidth) /
        Math.max(selectedMap.height ?? form.state.draft.frameHeight, 1);
      form.update(
        key === "frameWidth"
          ? { frameWidth: value, frameHeight: value / ratio }
          : { frameHeight: value, frameWidth: value * ratio },
      );
      const linkedKey = key === "frameWidth" ? "frameHeight" : "frameWidth";
      setNumericInputs((current) => {
        const next = { ...current };
        delete next[linkedKey];
        return next;
      });
    } else form.update({ [key]: value });
  };
  const numericField = (key: NumericField) => {
    const { label, ...constraints } = numericFields[key];
    const id = `${fieldPrefix}-${key}`;
    return (
      <label key={key} htmlFor={id}>
        <span>{label}</span>
        <FormInput
          id={id}
          aria-label={label}
          type="number"
          {...constraints}
          required
          value={
            numericInputs[key] ??
            (Number.isFinite(form.state.draft[key])
              ? form.state.draft[key]
              : "")
          }
          aria-describedby={`${id}-hint${errors[key] ? ` ${id}-error` : ""}`}
          aria-invalid={Boolean(errors[key])}
          onChange={(e) => number(key, e.target.value)}
        />
        <small id={`${id}-hint`}>{numericHint(key)}</small>
        {errors[key] && (
          <span className="field-error" id={`${id}-error`}>
            {errors[key]}
          </span>
        )}
      </label>
    );
  };
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
    setNumericInputs((current) => {
      const next = { ...current };
      for (const key of [
        "frameX",
        "frameY",
        "frameWidth",
        "frameHeight",
      ] as const)
        delete next[key];
      return next;
    });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saveReason) return;
    await form.submit();
  };

  return (
    <ArkenDialog
      open
      footer={false}
      title={scene ? `Настройка: ${scene.name}` : "Новая сцена"}
      onClose={onCancel}
    >
      <form className="scene-editor" onSubmit={submit} noValidate>
        <label className="field">
          Название
          <FormInput
            required
            maxLength={100}
            aria-label="Название"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={
              errors.name ? `${fieldPrefix}-name-error` : undefined
            }
            value={form.state.draft.name}
            onChange={(e) => form.update({ name: e.target.value })}
          />
        </label>
        {errors.name && (
          <div className="field-error" id={`${fieldPrefix}-name-error`}>
            {errors.name}
          </div>
        )}
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
            {numericField("width")}
            {numericField("height")}
          </div>
        </fieldset>
        <fieldset>
          <legend>Сетка</legend>
          <label>
            <input
              type="checkbox"
              aria-describedby={`${fieldPrefix}-grid-hint`}
              checked={form.state.draft.gridEnabled}
              onChange={(e) => form.update({ gridEnabled: e.target.checked })}
            />{" "}
            Сетка: привязка и измерение
          </label>
          <p id={`${fieldPrefix}-grid-hint`}>
            Сетка задаёт привязку к клетке, шаг перемещения и единицу линейки.
            Непрозрачность меняет только видимость линий: при 0 привязка
            остаётся включённой.
          </p>
          <div className="scene-form-grid">
            {numericField("gridSize")}
            {numericField("gridOffsetX")}
            {numericField("gridOffsetY")}
            <label>
              Цвет сетки
              <FormInput
                type="color"
                value={form.state.draft.gridColor}
                onChange={(e) => form.update({ gridColor: e.target.value })}
              />
            </label>
            {numericField("gridOpacity")}
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
              numericField,
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
        {saveReason && (
          <p id={`${fieldPrefix}-save-reason`} role="status">
            {saveReason}
          </p>
        )}
        <div className="dialog-actions">
          <Button
            type="submit"
            view="action"
            loading={form.state.status === "saving"}
            disabled={Boolean(saveReason)}
            aria-describedby={
              saveReason ? `${fieldPrefix}-save-reason` : undefined
            }
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
