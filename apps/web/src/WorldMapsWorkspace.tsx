import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  GameSnapshot,
  WorldMapDto,
  WorldMapLocationDto,
  WorldMapLocationKind,
  WorldMapLocationVisibility,
  WorldMapScope,
  WorldMapVisibility,
} from "@arken/contracts";
import { ArkenDialog } from "./ui/ArkenDialog";
import {
  authorizedWorldMapBackground,
  locationSceneNames,
  locationsOnWorldMap,
  selectedWorldMap,
  worldMapCapabilities,
} from "./world-map-workspace-state";

type MapDraft = {
  name: string;
  scope: WorldMapScope;
  visibility: WorldMapVisibility;
};

type LocationDraft = {
  name: string;
  kind: WorldMapLocationKind;
  summary: string;
  gmNotes: string;
  visibility: WorldMapLocationVisibility;
  x: number;
  y: number;
};

const newMapDraft = (): MapDraft => ({
  name: "",
  scope: "REGION",
  visibility: "CAMPAIGN",
});

const newLocationDraft = (): LocationDraft => ({
  name: "",
  kind: "OTHER",
  summary: "",
  gmNotes: "",
  visibility: "GM_ONLY",
  x: 0.5,
  y: 0.5,
});
const toDraft = (
  location: WorldMapLocationDto,
  gmNotes?: string,
): LocationDraft => ({
  name: location.name,
  kind: location.kind,
  summary: location.summary,
  gmNotes: gmNotes ?? "",
  visibility: location.visibility,
  x: location.x,
  y: location.y,
});

export function WorldMapsWorkspace({
  open,
  snapshot,
  onClose,
  onOpenScene,
  onCreateMap,
  onSetDraftBackground,
  onApproveBackground,
  onPublishMap,
  onArchiveMap,
  onCreateLocation,
  onUpdateLocation,
  onLinkLocationScene,
  onUnlinkLocationScene,
  onSetPartyPosition,
  onClearPartyPosition,
}: {
  open: boolean;
  snapshot: GameSnapshot;
  onClose: () => void;
  /** Opens a tactical scene only in the GM's local canvas; it does not publish it. */
  onOpenScene: (sceneId: string) => void;
  onCreateMap: (input: MapDraft) => Promise<void>;
  onSetDraftBackground: (
    map: WorldMapDto,
    assetId: string | null,
  ) => Promise<void>;
  onApproveBackground: (map: WorldMapDto) => Promise<void>;
  onPublishMap: (map: WorldMapDto) => Promise<void>;
  onArchiveMap: (map: WorldMapDto) => Promise<void>;
  onCreateLocation: (input: LocationDraft & { mapId: string }) => Promise<void>;
  onUpdateLocation: (
    location: WorldMapLocationDto,
    input: LocationDraft,
  ) => Promise<void>;
  onLinkLocationScene: (
    location: WorldMapLocationDto,
    sceneId: string,
  ) => Promise<void>;
  onUnlinkLocationScene: (
    location: WorldMapLocationDto,
    sceneId: string,
  ) => Promise<void>;
  onSetPartyPosition: (
    mapId: string,
    locationId: string,
    revision: number | null,
  ) => Promise<void>;
  onClearPartyPosition: (revision: number) => Promise<void>;
}) {
  const isGm = snapshot.me.role === "GM";
  const [mapId, setMapId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [editor, setEditor] = useState<"NEW" | WorldMapLocationDto | null>(
    null,
  );
  const [draft, setDraft] = useState<LocationDraft>(newLocationDraft);
  const [mapEditorOpen, setMapEditorOpen] = useState(false);
  const [mapDraft, setMapDraft] = useState<MapDraft>(newMapDraft);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [mapEditorError, setMapEditorError] = useState("");
  const [status, setStatus] = useState("");
  const worldMaps = snapshot.worldMaps;
  const map = selectedWorldMap(worldMaps, mapId);
  const capabilities = worldMapCapabilities(map);
  const isDraft = capabilities.canEditContent;
  const isPublished = capabilities.canSetPartyPosition;
  const isArchived = capabilities.isReadOnly;
  const locations = useMemo(
    () => locationsOnWorldMap(worldMaps, map?.id ?? null),
    [map?.id, worldMaps],
  );
  const selectedLocation =
    locations.find((location) => location.id === locationId) ??
    locations[0] ??
    null;
  const background = authorizedWorldMapBackground(snapshot.assets, map);
  const mapAssets = useMemo(
    () => snapshot.assets.filter((asset) => asset.kind === "MAP"),
    [snapshot.assets],
  );
  const party =
    worldMaps?.partyPosition?.mapId === map?.id
      ? (worldMaps?.partyPosition ?? null)
      : null;
  const partyLocation =
    locations.find((location) => location.id === party?.locationId) ?? null;
  const linkedScenes = selectedLocation
    ? locationSceneNames(selectedLocation, snapshot.scenes)
    : [];
  const unlinkedScenes = selectedLocation
    ? snapshot.scenes.filter(
        (scene) => !selectedLocation.sceneIds.includes(scene.id),
      )
    : [];
  const selectedGmNotes = isGm
    ? worldMaps?.gmLocations?.find(
        (location) => location.id === selectedLocation?.id,
      )?.gmNotes
    : undefined;

  useEffect(() => {
    if (map && map.id !== mapId) setMapId(map.id);
  }, [map, mapId]);
  useEffect(() => {
    if (selectedLocation && selectedLocation.id !== locationId)
      setLocationId(selectedLocation.id);
  }, [locationId, selectedLocation]);

  const openEditor = (location: "NEW" | WorldMapLocationDto) => {
    if (!isDraft) return;
    setEditorError("");
    setEditor(location);
    setDraft(
      location === "NEW"
        ? newLocationDraft()
        : toDraft(
            location,
            worldMaps?.gmLocations?.find((item) => item.id === location.id)
              ?.gmNotes,
          ),
    );
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor || !map || !isDraft) return;
    setSaving(true);
    setEditorError("");
    try {
      if (editor === "NEW") await onCreateLocation({ ...draft, mapId: map.id });
      else await onUpdateLocation(editor, draft);
      setStatus(
        editor === "NEW"
          ? `Локация «${draft.name}» создана.`
          : `Локация «${draft.name}» обновлена.`,
      );
      setEditor(null);
    } catch (reason) {
      setEditorError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить локацию.",
      );
    } finally {
      setSaving(false);
    }
  };
  const submitMap = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMapEditorError("");
    try {
      await onCreateMap(mapDraft);
      setStatus(`Карта «${mapDraft.name}» создана как черновик.`);
      setMapEditorOpen(false);
      setMapDraft(newMapDraft());
    } catch (reason) {
      setMapEditorError(
        reason instanceof Error ? reason.message : "Не удалось создать карту.",
      );
    } finally {
      setSaving(false);
    }
  };
  const perform = async (success: string, action: () => Promise<void>) => {
    setSaving(true);
    try {
      await action();
      setStatus(success);
    } catch (reason) {
      setStatus(
        reason instanceof Error
          ? reason.message
          : "Не удалось выполнить действие.",
      );
    } finally {
      setSaving(false);
    }
  };


  return (
    <ArkenDialog
      open={open}
      footer={false}
      title="Карты мира"
      variant="workspace"
      className="world-maps-workspace"
      onClose={onClose}
    >
      <div className="world-maps-workspace__content">
        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>
        {!map ? (
          <section className="world-map-empty">
            <h3>
              {isGm ? "Создайте первую карту" : "Карты пока не опубликованы"}
            </h3>
            <p>
              {isGm
                ? "Новая карта начинается как черновик и не видна игрокам."
                : "Доступные для вашей роли карты появятся здесь после подготовки мастером."}
            </p>
            {isGm ? (
              <button
                type="button"
                className="primary"
                onClick={() => setMapEditorOpen(true)}
              >
                Создать карту
              </button>
            ) : null}
          </section>
        ) : (
          <>
            <header className="world-map-toolbar">
              <label>
                Карта
                <select
                  value={map.id}
                  onChange={(event) => {
                    setMapId(event.target.value);
                    setLocationId(null);
                  }}
                >
                  {(worldMaps?.maps ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} —{" "}
                      {item.lifecycle === "DRAFT"
                        ? "Черновик"
                        : item.lifecycle === "PUBLISHED"
                          ? "Опубликована"
                          : "Архив"}
                    </option>
                  ))}
                </select>
              </label>
              <span className="world-map-toolbar__scope">
                {map.scope === "WORLD" ? "Мир" : "Регион"}
              </span>
              <span
                className={`world-map-lifecycle world-map-lifecycle--${map.lifecycle.toLowerCase()}`}
              >
                {map.lifecycle === "DRAFT"
                  ? "Черновик"
                  : map.lifecycle === "PUBLISHED"
                    ? "Опубликована"
                    : "Архив"}
              </span>
              {isGm ? (
                <button type="button" onClick={() => setMapEditorOpen(true)}>
                  Создать карту
                </button>
              ) : null}
              {isGm && isDraft ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => openEditor("NEW")}
                >
                  Добавить локацию
                </button>
              ) : null}
            </header>
            {isArchived ? (
              <p className="world-map-readonly" role="note">
                Карта в архиве и доступна только для просмотра.
              </p>
            ) : null}
            {isGm && isDraft ? (
              <section
                className="world-map-lifecycle-panel"
                aria-label="Публикация карты"
              >
                <label>
                  Фон черновика
                  <select
                    value={map.backgroundAssetId ?? ""}
                    disabled={saving}
                    onChange={(event) =>
                      void perform(
                        event.target.value
                          ? "Фон черновика изменён. Перед публикацией подтвердите его."
                          : "Фон черновика снят.",
                        () =>
                          onSetDraftBackground(map, event.target.value || null),
                      )
                    }
                  >
                    <option value="">Без фона</option>
                    {mapAssets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!mapAssets.length ? (
                  <p className="muted">
                    Сначала загрузите файл с типом MAP в «Файлы».
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={saving || !map.backgroundAssetId}
                  onClick={() =>
                    void perform(
                      "Фон подтверждён. Теперь карту можно опубликовать.",
                      () => onApproveBackground(map),
                    )
                  }
                >
                  Подтвердить фон
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={saving || !map.backgroundAssetId}
                  onClick={() =>
                    void perform("Карта опубликована для кампании.", () =>
                      onPublishMap(map),
                    )
                  }
                >
                  Опубликовать
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void perform("Карта перемещена в архив.", () =>
                      onArchiveMap(map),
                    )
                  }
                >
                  Архивировать
                </button>
              </section>
            ) : null}
            {isGm && isPublished ? (
              <section
                className="world-map-lifecycle-panel"
                aria-label="Статус опубликованной карты"
              >
                <p>
                  Опубликованная карта неизменяема: локации и связи сцен
                  заблокированы.
                </p>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void perform("Карта перемещена в архив.", () =>
                      onArchiveMap(map),
                    )
                  }
                >
                  Архивировать
                </button>
              </section>
            ) : null}
            <div className="world-map-layout">
              <section
                className="world-map-stage"
                aria-label={`Карта: ${map.name}`}
              >
                <div
                  className="world-map-stage__canvas"
                  style={{
                    aspectRatio:
                      background?.width && background?.height
                        ? `${background.width} / ${background.height}`
                        : "16 / 9",
                  }}
                >
                  {background ? (
                    <img src={background.url} alt={`Фон карты «${map.name}»`} />
                  ) : (
                    <div className="world-map-stage__placeholder">
                      {isDraft
                        ? "Выберите MAP-файл и подтвердите фон перед публикацией."
                        : "Одобренный фон карты пока не назначен."}
                    </div>
                  )}
                  {locations.map((location) => (
                    <button
                      key={location.id}
                      type="button"
                      className={`world-map-marker${location.id === selectedLocation?.id ? " is-selected" : ""}`}
                      style={{
                        left: `${location.x * 100}%`,
                        top: `${location.y * 100}%`,
                      }}
                      aria-pressed={location.id === selectedLocation?.id}
                      aria-label={`Локация: ${location.name}`}
                      onClick={() => {
                        setLocationId(location.id);
                        setStatus(`Выбрана локация: ${location.name}.`);
                      }}
                    >
                      <span aria-hidden="true">●</span>
                      <span>{location.name}</span>
                    </button>
                  ))}
                  {partyLocation ? (
                    <span
                      className="world-map-party-marker"
                      style={{
                        left: `${partyLocation.x * 100}%`,
                        top: `${partyLocation.y * 100}%`,
                      }}
                      aria-label="Текущая позиция группы"
                      role="img"
                    >
                      ◆
                    </span>
                  ) : null}
                </div>
              </section>
              <aside className="world-map-detail" aria-label="Локации карты">
                <div
                  className="world-map-location-list"
                  role="list"
                  aria-label="Список локаций"
                >
                  {locations.length ? (
                    locations.map((location) => (
                      <button
                        key={location.id}
                        type="button"
                        role="listitem"
                        aria-current={
                          location.id === selectedLocation?.id
                            ? "true"
                            : undefined
                        }
                        onClick={() => {
                          setLocationId(location.id);
                          setStatus(`Выбрана локация: ${location.name}.`);
                        }}
                      >
                        <strong>{location.name}</strong>
                        <span>{location.kind}</span>
                      </button>
                    ))
                  ) : (
                    <p className="muted">
                      На этой карте пока нет доступных локаций.
                    </p>
                  )}
                </div>
                {selectedLocation ? (
                  <article
                    className="world-map-location-card"
                    aria-labelledby="world-map-location-title"
                  >
                    <div>
                      <h3 id="world-map-location-title">
                        {selectedLocation.name}
                      </h3>
                      <span>{selectedLocation.kind}</span>
                    </div>
                    {selectedLocation.summary ? (
                      <p>{selectedLocation.summary}</p>
                    ) : (
                      <p className="muted">Описание не добавлено.</p>
                    )}
                    {isGm && selectedGmNotes ? (
                      <p className="world-map-gm-notes">
                        <strong>Заметки мастера</strong>
                        {selectedGmNotes}
                      </p>
                    ) : null}
                    {isGm && isDraft ? (
                      <div className="world-map-card-actions">
                        <button
                          type="button"
                          onClick={() => openEditor(selectedLocation)}
                        >
                          Редактировать
                        </button>
                      </div>
                    ) : null}
                    {isGm && isPublished ? (
                      <div className="world-map-card-actions">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            void perform(
                              `Позиция группы: ${selectedLocation.name}.`,
                              () =>
                                onSetPartyPosition(
                                  map.id,
                                  selectedLocation.id,
                                  party?.revision ?? null,
                                ),
                            )
                          }
                        >
                          Поставить группу здесь
                        </button>
                        {party ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              void perform("Позиция группы очищена.", () =>
                                onClearPartyPosition(party.revision),
                              )
                            }
                          >
                            Очистить позицию
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {isGm && linkedScenes.length ? (
                      <div className="world-map-scene-links">
                        <strong>Локальные сцены</strong>
                        {linkedScenes.map((scene) => (
                          <div key={scene.id} className="world-map-scene-link">
                            <button
                              type="button"
                              onClick={() => onOpenScene(scene.id)}
                            >
                              Открыть «{scene.name}» локально
                            </button>
                            {isDraft ? (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() =>
                                  void perform(
                                    `Связь со сценой «${scene.name}» удалена.`,
                                    () =>
                                      onUnlinkLocationScene(
                                        selectedLocation,
                                        scene.id,
                                      ),
                                  )
                                }
                              >
                                Убрать связь
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {isGm && isDraft ? (
                      <label className="world-map-scene-picker">
                        Связать с локальной сценой
                        <select
                          value=""
                          disabled={saving || !unlinkedScenes.length}
                          onChange={(event) => {
                            const sceneId = event.target.value;
                            if (!sceneId) return;
                            void perform("Связь со сценой добавлена.", () =>
                              onLinkLocationScene(selectedLocation, sceneId),
                            );
                          }}
                        >
                          <option value="">
                            {unlinkedScenes.length
                              ? "Выберите сцену"
                              : "Все сцены уже связаны"}
                          </option>
                          {unlinkedScenes.map((scene) => (
                            <option key={scene.id} value={scene.id}>
                              {scene.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </article>
                ) : null}
              </aside>
            </div>
          </>
        )}
      </div>
      <ArkenDialog
        open={mapEditorOpen}
        title="Новая карта"
        applyLabel="Создать черновик"
        cancelLabel="Отмена"
        loading={saving}
        error={mapEditorError}
        onApply={() =>
          (
            document.getElementById("world-map-form") as HTMLFormElement | null
          )?.requestSubmit()
        }
        onClose={() => !saving && setMapEditorOpen(false)}
      >
        <form
          id="world-map-form"
          className="world-map-location-form"
          onSubmit={(event) => void submitMap(event)}
        >
          <label>
            Название
            <input
              required
              maxLength={120}
              value={mapDraft.name}
              onChange={(event) =>
                setMapDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Охват
            <select
              value={mapDraft.scope}
              onChange={(event) =>
                setMapDraft((current) => ({
                  ...current,
                  scope: event.target.value as WorldMapScope,
                }))
              }
            >
              <option value="REGION">Регион</option>
              <option value="WORLD">Мир</option>
            </select>
          </label>
          <label>
            Видимость
            <select
              value={mapDraft.visibility}
              onChange={(event) =>
                setMapDraft((current) => ({
                  ...current,
                  visibility: event.target.value as WorldMapVisibility,
                }))
              }
            >
              <option value="CAMPAIGN">Кампания</option>
              <option value="GM_ONLY">Только мастер</option>
            </select>
          </label>
        </form>
      </ArkenDialog>
      <ArkenDialog
        open={editor !== null}
        title={editor === "NEW" ? "Новая локация" : "Локация"}
        applyLabel="Сохранить"
        cancelLabel="Отмена"
        loading={saving}
        error={editorError}
        onApply={() =>
          (
            document.getElementById(
              "world-map-location-form",
            ) as HTMLFormElement | null
          )?.requestSubmit()
        }
        onClose={() => !saving && setEditor(null)}
      >
        <form
          id="world-map-location-form"
          className="world-map-location-form"
          onSubmit={(event) => void submit(event)}
        >
          <label>
            Название
            <input
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Тип
            <select
              value={draft.kind}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  kind: event.target.value as WorldMapLocationKind,
                }))
              }
            >
              <option value="SETTLEMENT">Поселение</option>
              <option value="LANDMARK">Ориентир</option>
              <option value="REGION">Регион</option>
              <option value="OTHER">Другое</option>
            </select>
          </label>
          <label>
            Видимость
            <select
              value={draft.visibility}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  visibility: event.target.value as WorldMapLocationVisibility,
                }))
              }
            >
              <option value="PUBLIC">Всем</option>
              <option value="DISCOVERED">Открыта кампании</option>
              <option value="GM_ONLY">Только мастеру</option>
            </select>
          </label>
          <label>
            Описание
            <textarea
              maxLength={2000}
              value={draft.summary}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  summary: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Заметки мастера
            <textarea
              maxLength={10000}
              value={draft.gmNotes}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  gmNotes: event.target.value,
                }))
              }
            />
          </label>
          <div className="world-map-coordinate-fields">
            <label>
              X
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={draft.x}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    x: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              Y
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={draft.y}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    y: Number(event.target.value),
                  }))
                }
              />
            </label>
          </div>
        </form>
      </ArkenDialog>
    </ArkenDialog>
  );
}
