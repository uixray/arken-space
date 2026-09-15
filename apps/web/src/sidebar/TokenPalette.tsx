import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { AssetDto, GameSnapshot } from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import {
  TokenImageGenerator,
  type TokenImageDraft,
} from "../TokenImageGenerator";
import { DEFAULT_TOKEN_IMAGE_TRANSFORM } from "../token-image-editor-state";
import {
  mergeAssets,
  tokenDefinitionAssets,
  tokenGeneratorSources,
} from "../token-definition-options";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ArkenDialog } from "../ui/ArkenDialog";
import { ImageUploadField } from "../ui/ImageUploadField";
import { FormInput, FormSelect } from "../ui/GravityFormControls";
import { AssetPicker } from "../ui/AssetPicker";
import type { Props } from "../Sidebar";
import { useCampaignActions } from "../campaign-actions-context";
import type { TokenDefinitionActions } from "../use-token-definition-actions";
import type { AssetActions } from "../use-asset-actions";
import { Empty } from "./MediaPanel";
import { canPlaceTokenDefinition } from "../token-placement";

export function PalettePanel(props: Props) {
  const { token: tokenActions, asset: assetActions } = useCampaignActions();
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
        {props.snapshot.campaign.paused
          ? "Размещение токенов недоступно во время перерыва."
          : "Нажмите, чтобы поставить токен в центр карты, или перетащите его на нужное место."}
      </p>
      <div className="palette-grid">
        {definitions.map((definition) => {
          const asset = props.snapshot.assets.find(
            (item) => item.id === definition.defaultAssetId,
          );
          const canPlace =
            !props.snapshot.campaign.paused &&
            canPlaceTokenDefinition({
              role: props.snapshot.me.role,
              membershipId: props.snapshot.me.id,
              controllerMembershipIds: definition.controllerMembershipIds,
            });
          return (
            <article
              className="palette-card"
              key={definition.id}
              draggable={canPlace}
              onDragStart={
                canPlace
                  ? (event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData(
                        "application/x-arken-token-definition",
                        definition.id,
                      );
                    }
                  : (event) => event.preventDefault()
              }
            >
              <Button
                className="palette-place"
                disabled={props.snapshot.campaign.paused}
                onClick={() =>
                  tokenActions.onPlaceTokenDefinition(definition.id)
                }
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
              {(() => {
                /**
                 * UIX-400: маркер расхождения, а не требование его устранить.
                 *
                 * Расхождение — нормальное состояние для «Тейн верхом», и
                 * диалог с мастером здесь был бы навязчивым. Но у пяти
                 * определений на боевых данных оно есть, и одно из них
                 * («Хорист» у «Могучего Тэйна») — настоящая ошибка, которую
                 * иначе нечем починить.
                 */
                const character = props.snapshot.characters.find(
                  (item) => item.id === definition.characterId,
                );
                if (!character || !definition.ownName) return null;
                if (definition.ownName === character.name) return null;
                return (
                  <p className="palette-card__mismatch">
                    <span>Персонаж: {character.name}</span>
                    <Button
                      size="s"
                      view="flat"
                      title="Токен станет зваться как персонаж и будет переименовываться вместе с ним"
                      onClick={() =>
                        void tokenActions.onPatchTokenDefinition(
                          definition.id,
                          definition.revision,
                          { name: null },
                        )
                      }
                    >
                      Назвать по персонажу
                    </Button>
                  </p>
                );
              })()}
              <FormSelect
                aria-label={`Изображение токена ${definition.name}`}
                value={definition.defaultAssetId ?? ""}
                onChange={(event) =>
                  void tokenActions.onPatchTokenDefinition(
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
                  onUpload={assetActions.uploadAsset}
                  onPatch={tokenActions.onPatchTokenDefinition}
                />
              )}
              {props.snapshot.me.role === "GM" && (
                <div className="inline-fields">
                  <Button onClick={() => setEditor(definition)}>
                    Настроить
                  </Button>
                  <Button
                    className="danger-link"
                    view="flat-danger"
                    size="s"
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
          onUpload={assetActions.uploadAsset}
          onGenerateTokenImage={assetActions.generateTokenImage}
          onCancel={() => setEditor(null)}
          onCreate={tokenActions.onCreateTokenDefinition}
          onCreateAndPlace={tokenActions.onCreateAndPlaceTokenDefinition}
          onPatch={tokenActions.onPatchTokenDefinition}
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
          void tokenActions.onDeleteTokenDefinition(target.id, target.revision);
        }}
      />
    </section>
  );
}

/**
 * UIX-491, вторая половина жалобы: «я не смог загрузить и назначить картинку на
 * токен, но при этом она назначилась».
 *
 * Форма сообщала только об ошибке. При успехе она молча очищала поле файла —
 * и это выглядело неотличимо от «ничего не произошло»: игрок видит ту же
 * форму, что и до нажатия, а результат виден лишь на самом токене, до которого
 * ещё надо доскроллить. Человек решил, что загрузка не удалась, и написал об
 * этом в «Сообщить».
 *
 * Поэтому успех теперь называется вслух и живёт до следующего действия: таймер
 * тут только добавил бы гонку в тесте и шанс, что подтверждение исчезнет
 * раньше, чем его прочитают. `role="status"` — чтобы это услышал и экранный
 * диктор, иначе для него ничего и не изменилось.
 *
 * Экспортируется ради компонентного теста: показывается этот блок только
 * игроку (у мастера на его месте «Настроить»), и добираться до него через всю
 * палитру значило бы проверять не то.
 */
export function TokenImageAssignment({
  definition,
  onUpload,
  onPatch,
}: {
  definition: NonNullable<GameSnapshot["tokenDefinitions"]>[number];
  onUpload: AssetActions["uploadAsset"];
  onPatch: TokenDefinitionActions["onPatchTokenDefinition"];
}) {
  const [file, setFile] = useState<File>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const uploadStatusId = useId();
  const uploadStatus = saving
    ? "Файл загружается и назначается."
    : file
      ? "Файл готов к загрузке."
      : "Сначала выберите файл.";
  const assign = async () => {
    if (!file || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const asset = await onUpload(file, "TOKEN");
      await onPatch(definition.id, definition.revision, {
        defaultAssetId: asset.id,
      });
      setFile(undefined);
      setNotice(`Изображение назначено токену «${definition.name}».`);
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
        onUpdate={(next) => {
          // Выбран другой файл — прежнее подтверждение относится уже не к нему.
          setNotice("");
          setFile(next);
        }}
      />
      <Button
        view="action"
        disabled={!file || saving}
        loading={saving}
        aria-describedby={uploadStatusId}
        onClick={() => void assign()}
      >
        Загрузить и назначить
      </Button>
      <p className="muted" id={uploadStatusId}>
        {uploadStatus}
      </p>
      {error && (
        <div className="field-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="field-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

function initialImageDraft(asset: AssetDto): TokenImageDraft {
  return {
    sourceAssetId: asset.id,
    ...DEFAULT_TOKEN_IMAGE_TRANSFORM,
    name: asset.name.replace(/\.[^/.]+$/, "").slice(0, 90) || undefined,
  };
}

export function TokenDefinitionEditor({
  snapshot,
  definition,
  onUpload,
  onGenerateTokenImage,
  onCancel,
  onCreate,
  onCreateAndPlace,
  onPatch,
  onOpenCharacters,
  onOpenMedia,
}: {
  snapshot: GameSnapshot;
  definition?: NonNullable<GameSnapshot["tokenDefinitions"]>[number];
  onUpload: AssetActions["uploadAsset"];
  onGenerateTokenImage: AssetActions["generateTokenImage"];
  onCancel: () => void;
  onCreate: TokenDefinitionActions["onCreateTokenDefinition"];
  onCreateAndPlace: TokenDefinitionActions["onCreateAndPlaceTokenDefinition"];
  onPatch: TokenDefinitionActions["onPatchTokenDefinition"];
  // Kept at the component boundary while older focused harnesses migrate;
  // editing now sends controllers atomically in PATCH rather than calling it.
  onReplaceControllers?: TokenDefinitionActions["onReplaceTokenControllers"];
  onOpenCharacters: () => void;
  onOpenMedia: () => void;
}) {
  const activeScene = snapshot.scenes.find((scene) => scene.active);
  const gridSize = activeScene?.grid.enabled ? activeScene.grid.size : 64;
  const initialWidth = (definition?.defaultWidth ?? 64) / gridSize;
  const initialHeight = (definition?.defaultHeight ?? 64) / gridSize;
  /**
   * UIX-400: редактируется **собственное** имя, а не то, что видно на карте.
   * Иначе «сохранить» у токена, следующего за персонажем, превратило бы
   * наследование в намеренную копию — молча и навсегда.
   */
  const [name, setName] = useState(definition?.ownName ?? "");
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
  const [uploadPending, setUploadPending] = useState(false);
  const uploadSourcePromise = useRef<Promise<AssetDto> | null>(null);
  const uploadSourceError = useRef<string | null>(null);
  const generationDraft = useRef<TokenImageDraft | null>(null);
  const [assetIntent, setAssetIntent] = useState<
    "none" | "token" | "source" | "upload"
  >(definition?.defaultAssetId ? "token" : "none");
  const assetIntentRef = useRef(assetIntent);
  const selectAssetIntent = (intent: typeof assetIntent) => {
    assetIntentRef.current = intent;
    setAssetIntent(intent);
  };
  const [generatorSourceId, setGeneratorSourceId] = useState("");
  const generatedDerivative = useRef<{
    key: string;
    asset: AssetDto;
  } | null>(null);
  const generationCommand = useRef<{
    key: string;
    draft: TokenImageDraft;
    actionId: string;
  } | null>(null);
  const patchCommand = useRef<{
    key: string;
    input: Parameters<TokenDefinitionActions["onPatchTokenDefinition"]>[2];
    actionId: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  // This ref belongs to one mounted editor instance. PalettePanel can reopen
  // another "NEW" editor while this instance's server request is still pending.
  const mounted = useRef(true);
  const operationEpoch = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operationEpoch.current += 1;
    };
  }, []);

  const cancelEditor = () => {
    operationEpoch.current += 1;
    uploadSourcePromise.current = null;
    onCancel();
  };

  const draftKey = (draft: TokenImageDraft) => JSON.stringify(draft);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const createAndPlace = submitter?.value === "create-and-place";
    // Имя обязательно, только когда наследовать не от кого.
    if (!name.trim() && !characterId)
      return setError("Укажите название токена или выберите персонажа.");
    const inputSnapshot = {
      name: name.trim() || null,
      characterId: characterId || null,
      defaultWidth: Math.round(width * gridSize),
      defaultHeight: Math.round(height * gridSize),
      controllerMembershipIds: [...controllers],
      intent: assetIntentRef.current,
      selectedAssetId: assetId,
      draft: generationDraft.current ? { ...generationDraft.current } : null,
      upload: uploadSourcePromise.current,
      uploadError: uploadSourceError.current,
    };
    const operation = ++operationEpoch.current;
    const current = () =>
      mounted.current && operationEpoch.current === operation;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      let draft = inputSnapshot.draft;
      if (inputSnapshot.intent === "upload") {
        if (!inputSnapshot.upload)
          throw new Error(
            inputSnapshot.uploadError ??
              "Загрузка изображения не завершилась. Выберите файл заново.",
          );
        const source = await inputSnapshot.upload;
        if (!current()) return;
        // The upload's resolved asset is authoritative even before React has
        // rendered its selection or the generator has run an effect.
        draft = initialImageDraft(source);
      }
      if (!current()) return;
      let defaultAssetId =
        inputSnapshot.intent === "token" ? inputSnapshot.selectedAssetId : null;
      if (
        inputSnapshot.intent === "source" ||
        inputSnapshot.intent === "upload"
      ) {
        if (!draft) {
          setError("Выберите исходное изображение для токена.");
          return;
        }
        const key = draftKey(draft);
        const cached = generatedDerivative.current;
        const command =
          generationCommand.current?.key === key
            ? generationCommand.current
            : {
                key,
                draft: { ...draft },
                actionId: crypto.randomUUID(),
              };
        generationCommand.current = command;
        const derivative =
          cached?.key === key
            ? cached.asset
            : await onGenerateTokenImage(command.draft, {
                actionId: command.actionId,
              });
        if (!current()) return;
        generatedDerivative.current = { key, asset: derivative };
        defaultAssetId = derivative.id;
      }
      const input = {
        // Пустое поле у токена с персонажем — это «зовусь как он».
        name: inputSnapshot.name,
        characterId: inputSnapshot.characterId,
        defaultAssetId,
        // The API keeps pixel values for backwards compatibility. The editor
        // exposes grid units, so a token follows the active scene's grid.
        defaultWidth: inputSnapshot.defaultWidth,
        defaultHeight: inputSnapshot.defaultHeight,
        controllerMembershipIds: inputSnapshot.controllerMembershipIds,
      };
      if (!definition && createAndPlace) {
        await onCreateAndPlace(input);
        if (!current()) return;
      } else if (!definition) {
        await onCreate(input);
        if (!current()) return;
      } else {
        const key = JSON.stringify({
          definitionId: definition.id,
          revision: definition.revision,
          input,
        });
        const command =
          patchCommand.current?.key === key
            ? patchCommand.current
            : {
                key,
                input: { ...input },
                actionId: crypto.randomUUID(),
              };
        patchCommand.current = command;
        await onPatch(definition.id, definition.revision, command.input, {
          actionId: command.actionId,
          refresh: true,
          errorOwner: "caller",
        });
        if (!current()) return;
      }
      if (current()) {
        savingRef.current = false;
        setSaving(false);
        cancelEditor();
      }
    } catch (reason) {
      if (current())
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось сохранить токен.",
        );
    } finally {
      if (current()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  return (
    <ArkenDialog
      open
      footer={false}
      title={definition ? `Настройка ${definition.name}` : "Новый токен"}
      onClose={cancelEditor}
    >
      <form className="entity-form" onSubmit={submit}>
        <fieldset
          className="entity-form"
          disabled={saving}
          style={{ border: 0, margin: 0, minInlineSize: 0, padding: 0 }}
        >
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
            <AssetPicker
              aria-label="Изображение токена из файлов"
              value={assetId || null}
              hasExternalSelection={
                assetIntent === "source" || assetIntent === "upload"
              }
              assets={tokenDefinitionAssets(
                mergeAssets(snapshot.assets, uploadedSource),
              )}
              onChange={(nextAssetId) => {
                if (savingRef.current) return;
                uploadSourcePromise.current = null;
                uploadSourceError.current = null;
                setUploadPending(false);
                setError("");
                setImage(undefined);
                generatedDerivative.current = null;
                generationCommand.current = null;
                selectAssetIntent(nextAssetId ? "token" : "none");
                generationDraft.current = null;
                setGeneratorSourceId("");
                setAssetId(nextAssetId ?? "");
              }}
              emptyAction={{
                label: "Добавить изображение",
                onSelect: onOpenMedia,
              }}
            />
          </label>
          <TokenImageGenerator
            imageAssets={tokenGeneratorSources(
              mergeAssets(snapshot.assets, uploadedSource),
            )}
            uploadedSourceId={uploadedSource?.id}
            selectedSourceId={generatorSourceId}
            disabled={saving || uploadPending}
            embedded
            onDraftChange={(draft) => {
              if (savingRef.current) return;
              uploadSourcePromise.current = null;
              uploadSourceError.current = null;
              setUploadPending(false);
              setError("");
              generationDraft.current = draft;
              selectAssetIntent(draft ? "source" : "none");
              setGeneratorSourceId(draft?.sourceAssetId ?? "");
              setAssetId("");
              if (
                !draft ||
                generatedDerivative.current?.key !== draftKey(draft)
              ) {
                generatedDerivative.current = null;
              }
              if (
                !draft ||
                generationCommand.current?.key !== draftKey(draft)
              ) {
                generationCommand.current = null;
              }
            }}
          />
          <ImageUploadField
            label="Загрузить новое изображение"
            value={image}
            hint="Выберите, вставьте или перетащите файл — он станет доступен в генераторе"
            unifiedIntake
            onUpdate={(file) => {
              if (savingRef.current) return;
              setImage(file);
              setError("");
              // Retain the current preview/crop while a replacement uploads.
              // Save still awaits the captured new source, never this preview.
              if (!file) setUploadedSource(undefined);
              setUploadPending(Boolean(file));
              uploadSourcePromise.current = null;
              uploadSourceError.current = null;
              generatedDerivative.current = null;
              generationCommand.current = null;
              selectAssetIntent(file ? "upload" : "none");
              generationDraft.current = null;
              setAssetId("");
              if (!file) setGeneratorSourceId("");
              if (!file) return;
              const upload = onUpload(file, "IMAGE");
              uploadSourcePromise.current = upload;
              void upload
                .then((asset) => {
                  if (
                    !mounted.current ||
                    uploadSourcePromise.current !== upload
                  )
                    return;
                  const draft = initialImageDraft(asset);
                  setUploadPending(false);
                  generationDraft.current = draft;
                  selectAssetIntent("source");
                  setGeneratorSourceId(asset.id);
                  setUploadedSource(asset);
                })
                .catch((reason) => {
                  if (
                    !mounted.current ||
                    uploadSourcePromise.current !== upload
                  )
                    return;
                  uploadSourcePromise.current = null;
                  setUploadPending(false);
                  uploadSourceError.current =
                    reason instanceof Error
                      ? reason.message
                      : "Не удалось загрузить исходное изображение.";
                  setError(uploadSourceError.current);
                });
            }}
            disabled={saving}
          />
          {uploadPending && (
            <p role="status">Загрузка исходного изображения…</p>
          )}
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
        </fieldset>
        {error && (
          <div className="field-error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <Button type="submit" view="action" loading={saving}>
            Сохранить
          </Button>
          {!definition && activeScene ? (
            <Button
              type="submit"
              name="token-submit-mode"
              value="create-and-place"
              loading={saving}
            >
              Создать и поставить
            </Button>
          ) : null}
          <Button type="button" onClick={cancelEditor}>
            Отмена
          </Button>
        </div>
      </form>
    </ArkenDialog>
  );
}
