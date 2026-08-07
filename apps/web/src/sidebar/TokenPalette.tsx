import { useRef, useState, type FormEvent } from "react";
import type { AssetDto, GameSnapshot } from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import { TokenImageGenerator } from "../TokenImageGenerator";
import {
  mergeAssets,
  tokenAssetLabel,
  tokenDefinitionAssets,
  tokenGeneratorSources,
} from "../token-definition-options";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ArkenDialog } from "../ui/ArkenDialog";
import { ImageUploadField } from "../ui/ImageUploadField";
import { FormInput, FormSelect } from "../ui/GravityFormControls";
import type { Props } from "../Sidebar";
import { Empty } from "./MediaPanel";

export function PalettePanel(props: Props) {
  const definitions = props.snapshot.tokenDefinitions ?? [];
  const [editor, setEditor] = useState<
    (typeof definitions)[number] | "NEW" | null
  >(null);
  const [deleteDefinition, setDeleteDefinition] = useState<
    (typeof definitions)[number] | null
  >(null);
  if (!definitions.length && props.snapshot.me.role !== "GM")
    return (
      <Empty
        title="Нет доступных токенов"
        text="Мастер ещё не добавил токены в вашу палитру."
      />
    );
  return (
    <section className="panel-section token-palette">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Палитра</span>
          <h2>Токены</h2>
        </div>
        <span className="revision">{definitions.length}</span>
      </div>
      {props.snapshot.me.role === "GM" && (
        <Button view="action" onClick={() => setEditor("NEW")}>
          Создать токен
        </Button>
      )}
      <p className="muted">
        Нажмите, чтобы поставить токен в центр карты, или перетащите его на
        нужное место.
      </p>
      <div className="palette-grid">
        {definitions.map((definition) => {
          const asset = props.snapshot.assets.find(
            (item) => item.id === definition.defaultAssetId,
          );
          return (
            <article
              className="palette-card"
              key={definition.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(
                  "application/x-arken-token-definition",
                  definition.id,
                );
              }}
            >
              <Button
                className="palette-place"
                onClick={() => props.onPlaceTokenDefinition(definition.id)}
                title="Поставить экземпляр токена на активную сцену"
              >
                {asset ? (
                  <img src={asset.url} alt="" />
                ) : (
                  <span aria-hidden="true">
                    {definition.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </Button>
              <strong className="palette-card__title">{definition.name}</strong>
              <FormSelect
                aria-label={`Изображение токена ${definition.name}`}
                value={definition.defaultAssetId ?? ""}
                onChange={(event) =>
                  void props.onPatchTokenDefinition(
                    definition.id,
                    definition.revision,
                    { defaultAssetId: event.target.value || null },
                  )
                }
              >
                <option value="">Без изображения</option>
                {props.snapshot.assets
                  .filter((item) => item.kind === "TOKEN")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </FormSelect>
              {props.snapshot.me.role !== "GM" && (
                <TokenImageAssignment
                  definition={definition}
                  onUpload={props.onUpload}
                  onPatch={props.onPatchTokenDefinition}
                />
              )}
              {props.snapshot.me.role === "GM" && (
                <div className="inline-fields">
                  <Button onClick={() => setEditor(definition)}>
                    Настроить
                  </Button>
                  <Button
                    className="danger-link"
                    onClick={() => setDeleteDefinition(definition)}
                  >
                    Удалить определение и все размещения
                  </Button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {editor && (
        <TokenDefinitionEditor
          key={editor === "NEW" ? "new" : `${editor.id}:${editor.revision}`}
          snapshot={props.snapshot}
          definition={editor === "NEW" ? undefined : editor}
          onUpload={props.onUpload}
          onGenerateTokenImage={props.onGenerateTokenImage}
          onCancel={() => setEditor(null)}
          onCreate={props.onCreateTokenDefinition}
          onPatch={props.onPatchTokenDefinition}
          onReplaceControllers={props.onReplaceTokenControllers}
          onOpenCharacters={() => {
            setEditor(null);
            props.onWorkspaceChange("setup");
          }}
          onOpenMedia={() => {
            setEditor(null);
            props.onWorkspaceChange("media");
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteDefinition)}
        title="Удалить определение токена?"
        message={
          deleteDefinition
            ? `Определение «${deleteDefinition.name}» и все его размещения на сценах будут удалены. Это не удаление одного токена с карты.`
            : ""
        }
        confirmLabel="Удалить"
        onClose={() => setDeleteDefinition(null)}
        onConfirm={() => {
          if (!deleteDefinition) return;
          const target = deleteDefinition;
          setDeleteDefinition(null);
          void props.onDeleteTokenDefinition(target.id, target.revision);
        }}
      />
    </section>
  );
}

function TokenImageAssignment({
  definition,
  onUpload,
  onPatch,
}: {
  definition: NonNullable<GameSnapshot["tokenDefinitions"]>[number];
  onUpload: Props["onUpload"];
  onPatch: Props["onPatchTokenDefinition"];
}) {
  const [file, setFile] = useState<File>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const assign = async () => {
    if (!file || saving) return;
    setSaving(true);
    setError("");
    try {
      const asset = await onUpload(file, "TOKEN");
      await onPatch(definition.id, definition.revision, {
        defaultAssetId: asset.id,
      });
      setFile(undefined);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось назначить изображение токену.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="direct-asset-upload">
      <ImageUploadField
        label={`Новое изображение для ${definition.name}`}
        value={file}
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        hint="PNG, JPEG или WebP"
        disabled={saving}
        onUpdate={setFile}
      />
      <Button
        view="action"
        disabled={!file || saving}
        loading={saving}
        onClick={() => void assign()}
      >
        Загрузить и назначить
      </Button>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

function TokenDefinitionEditor({
  snapshot,
  definition,
  onUpload,
  onGenerateTokenImage,
  onCancel,
  onCreate,
  onPatch,
  onReplaceControllers,
  onOpenCharacters,
  onOpenMedia,
}: {
  snapshot: GameSnapshot;
  definition?: NonNullable<GameSnapshot["tokenDefinitions"]>[number];
  onUpload: Props["onUpload"];
  onGenerateTokenImage: Props["onGenerateTokenImage"];
  onCancel: () => void;
  onCreate: Props["onCreateTokenDefinition"];
  onPatch: Props["onPatchTokenDefinition"];
  onReplaceControllers: Props["onReplaceTokenControllers"];
  onOpenCharacters: () => void;
  onOpenMedia: () => void;
}) {
  const activeScene = snapshot.scenes.find((scene) => scene.active);
  const gridSize = activeScene?.grid.enabled ? activeScene.grid.size : 64;
  const initialWidth = (definition?.defaultWidth ?? 64) / gridSize;
  const initialHeight = (definition?.defaultHeight ?? 64) / gridSize;
  const [name, setName] = useState(definition?.name ?? "");
  const [characterId, setCharacterId] = useState(definition?.characterId ?? "");
  const [assetId, setAssetId] = useState(definition?.defaultAssetId ?? "");
  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);
  const [lockAspect, setLockAspect] = useState(true);
  const aspectRatio = useRef(
    initialHeight > 0 ? initialWidth / initialHeight : 1,
  );
  const [controllers, setControllers] = useState<string[]>(
    definition?.controllerMembershipIds ?? [],
  );
  const [image, setImage] = useState<File>();
  const [uploadedSource, setUploadedSource] = useState<AssetDto>();
  const uploadSourcePromise = useRef<Promise<AssetDto> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Укажите название токена.");
    setSaving(true);
    setError("");
    try {
      let selectedAssetId = assetId || null;
      if (image && uploadSourcePromise.current) {
        const uploaded = await uploadSourcePromise.current;
        if (!selectedAssetId) selectedAssetId = uploaded.id;
      }
      const input = {
        name: name.trim(),
        characterId: characterId || null,
        defaultAssetId: selectedAssetId,
        // The API keeps pixel values for backwards compatibility. The editor
        // exposes grid units, so a token follows the active scene's grid.
        defaultWidth: Math.round(width * gridSize),
        defaultHeight: Math.round(height * gridSize),
        controllerMembershipIds: controllers,
      };
      if (!definition) await onCreate(input);
      else {
        await onPatch(definition.id, definition.revision, input);
        await onReplaceControllers(
          definition.id,
          definition.revision + 1,
          controllers,
        );
      }
      onCancel();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить токен.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ArkenDialog
      open
      footer={false}
      title={definition ? `Настройка ${definition.name}` : "Новый токен"}
      onClose={onCancel}
    >
      <form className="entity-form" onSubmit={submit}>
        <label>
          Название
          <FormInput
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Персонаж
          <FormSelect
            value={characterId}
            onChange={(event) => setCharacterId(event.target.value)}
            emptyMessage={
              snapshot.characters.length === 0
                ? "Персонажей пока нет"
                : undefined
            }
            createAction={
              snapshot.characters.length === 0
                ? { label: "Создать персонажа", onSelect: onOpenCharacters }
                : undefined
            }
          >
            <option value="">Без персонажа</option>
            {snapshot.characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </FormSelect>
        </label>
        <label>
          Изображение из файлов
          <FormSelect
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
            emptyMessage={
              tokenDefinitionAssets(
                mergeAssets(snapshot.assets, uploadedSource),
              ).length === 0
                ? "Изображений токенов пока нет"
                : undefined
            }
            createAction={
              tokenDefinitionAssets(
                mergeAssets(snapshot.assets, uploadedSource),
              ).length === 0
                ? { label: "Добавить изображение", onSelect: onOpenMedia }
                : undefined
            }
          >
            <option value="">Без изображения</option>
            {tokenDefinitionAssets(
              mergeAssets(snapshot.assets, uploadedSource),
            ).map((asset) => (
              <option key={asset.id} value={asset.id}>
                {tokenAssetLabel(asset)}
              </option>
            ))}
          </FormSelect>
        </label>
        <TokenImageGenerator
          imageAssets={tokenGeneratorSources(
            mergeAssets(snapshot.assets, uploadedSource),
          )}
          disabled={saving}
          onGenerate={onGenerateTokenImage}
          onGenerated={(asset) => setAssetId(asset.id)}
        />
        <ImageUploadField
          label="Загрузить новое изображение"
          value={image}
          hint="После выбора файл станет доступен в генераторе"
          onUpdate={(file) => {
            setImage(file);
            setError("");
            setUploadedSource(undefined);
            uploadSourcePromise.current = null;
            if (!file) return;
            const upload = onUpload(file, "IMAGE");
            uploadSourcePromise.current = upload;
            void upload
              .then((asset) => {
                if (uploadSourcePromise.current !== upload) return;
                setUploadedSource(asset);
                setAssetId(asset.id);
              })
              .catch((reason) => {
                if (uploadSourcePromise.current !== upload) return;
                uploadSourcePromise.current = null;
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Не удалось загрузить исходное изображение.",
                );
              });
          }}
          disabled={saving}
        />
        <section className="token-dimensions" aria-label={"Размер токена"}>
          <p className="token-dimensions__hint">
            {"Размер в клетках активной сетки"} ({gridSize}
            {" px на клетку"}).
          </p>
          <div className="inline-fields">
            <label>
              {"Ширина, клетки"}
              <FormInput
                type="number"
                min={0.25}
                max={16}
                step={0.25}
                value={width}
                onChange={(event) => {
                  const next = Math.max(0.25, Number(event.target.value));
                  setWidth(next);
                  if (lockAspect) setHeight(next / aspectRatio.current);
                }}
              />
            </label>
            <label>
              {"Высота, клетки"}
              <FormInput
                type="number"
                min={0.25}
                max={16}
                step={0.25}
                value={height}
                onChange={(event) => {
                  const next = Math.max(0.25, Number(event.target.value));
                  setHeight(next);
                  if (lockAspect) setWidth(next * aspectRatio.current);
                }}
              />
            </label>
            <label className="aspect-lock">
              <FormInput
                type="checkbox"
                checked={lockAspect}
                onChange={(event) => {
                  setLockAspect(event.target.checked);
                  if (height > 0) aspectRatio.current = width / height;
                }}
              />
              {"Сохранять пропорции"}
            </label>
          </div>
        </section>
        <fieldset>
          <legend>Управление игроками</legend>
          {snapshot.members
            .filter((member) => member.role === "PLAYER")
            .map((member) => (
              <label key={member.id} className="inline-fields">
                <FormInput
                  type="checkbox"
                  checked={controllers.includes(member.id)}
                  onChange={(event) =>
                    setControllers((current) =>
                      event.target.checked
                        ? [...new Set([...current, member.id])]
                        : current.filter((id) => id !== member.id),
                    )
                  }
                />
                {member.displayName}
              </label>
            ))}
        </fieldset>
        {error && <div className="field-error">{error}</div>}
        <div className="dialog-actions">
          <Button type="submit" view="action" loading={saving}>
            Сохранить
          </Button>
          <Button type="button" onClick={onCancel} disabled={saving}>
            Отмена
          </Button>
        </div>
      </form>
    </ArkenDialog>
  );
}
