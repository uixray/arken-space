import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CreateWorldContentInstance,
  DeleteWorldContentInstance,
  AssetDto,
  MembershipDto,
  UpdateWorldContentInstance,
  WorldContentInstanceDto,
  WorldMapDto,
  WorldMapLocationDto,
} from "@arken/contracts";
import { ApiError, formatApiError } from "./api";
import { Button } from "./design-system/Button";
import { Dialog } from "./design-system/Dialog";
import { FormInput, FormSelect, FormTextArea } from "./ui/GravityFormControls";
import { AssetPicker } from "./ui/AssetPicker";
import type { AssetActions } from "./use-asset-actions";
import {
  createWorldContentInstance,
  deleteWorldContentInstance,
  fetchWorldContentInstance,
  fetchWorldContentInstances,
  type WorldContentInstanceFields,
  updateWorldContentInstance,
} from "./world-content-instances-client";
import "./WorldContentInstancesPanel.css";

type Draft = {
  displayNameOverride: string;
  currentState: string;
  gmNotes: string;
  quantity: string;
  condition: string;
  ownerMembershipId: string;
  portraitAssetId: string;
  currentLocationId: string;
};

const emptyDraft = (): Draft => ({
  displayNameOverride: "",
  currentState: "",
  gmNotes: "",
  quantity: "",
  condition: "",
  ownerMembershipId: "",
  portraitAssetId: "",
  currentLocationId: "",
});

type DeleteIntent = DeleteWorldContentInstance & {
  instanceId: string;
  canonicalId: string;
  displayName: string;
  dirtyEdit: boolean;
};

const fieldsFrom = (instance: WorldContentInstanceDto): Draft => ({
  displayNameOverride: instance.displayNameOverride ?? "",
  currentState: instance.currentState ?? "",
  gmNotes: instance.gmNotes ?? "",
  quantity: instance.quantity === null ? "" : String(instance.quantity),
  condition: instance.condition ?? "",
  ownerMembershipId: instance.ownerMembershipId ?? "",
  portraitAssetId: instance.portraitAssetId ?? "",
  currentLocationId: instance.currentLocationId ?? "",
});

const editableFields = [
  "displayNameOverride",
  "currentState",
  "gmNotes",
  "quantity",
  "condition",
  "ownerMembershipId",
  "portraitAssetId",
  "currentLocationId",
] as const satisfies readonly (keyof Draft)[];

const draftValues = (
  draft: Draft,
  item: boolean,
): WorldContentInstanceFields => ({
  displayNameOverride: draft.displayNameOverride.trim() || null,
  currentState: draft.currentState.trim() || null,
  gmNotes: draft.gmNotes.trim() || null,
  quantity:
    item && draft.quantity.trim() !== "" ? Number(draft.quantity) : null,
  condition: item ? draft.condition.trim() || null : null,
  ownerMembershipId: draft.ownerMembershipId || null,
  portraitAssetId: draft.portraitAssetId || null,
  currentLocationId: draft.currentLocationId || null,
});

function actionId() {
  return globalThis.crypto.randomUUID();
}

export function WorldContentInstancesPanel({
  canonical,
  members = [],
  assets = [],
  maps = [],
  locations = [],
  onUpload,
}: {
  canonical: { id: string; name: string; type: string };
  members?: readonly MembershipDto[];
  assets?: readonly AssetDto[];
  maps?: readonly Pick<WorldMapDto, "id" | "name">[];
  locations?: readonly Pick<WorldMapLocationDto, "id" | "mapId" | "name">[];
  onUpload?: AssetActions["uploadAsset"];
}) {
  const isItem = canonical.type === "ITEM";
  const [instances, setInstances] = useState<WorldContentInstanceDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [base, setBase] = useState<WorldContentInstanceDto | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [mode, setMode] = useState<"view" | "create" | "edit">("view");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [failedPreviewId, setFailedPreviewId] = useState<string | null>(null);
  const [conflictLatest, setConflictLatest] =
    useState<WorldContentInstanceDto | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<DeleteIntent | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<DeleteIntent | null>(null);
  const createActionRef = useRef<CreateWorldContentInstance | null>(null);
  const updateActionRef = useRef<{
    id: string;
    payload: UpdateWorldContentInstance;
  } | null>(null);
  const knownIdsAtCreateRef = useRef<Set<string>>(new Set());
  const canonicalIdRef = useRef(canonical.id);
  canonicalIdRef.current = canonical.id;
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingDeletesByCanonicalRef = useRef(new Map<string, DeleteIntent>());
  const skipSelectionResetRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await fetchWorldContentInstances(canonical.id);
      setInstances(rows);
      setSelectedId((current) =>
        current && rows.some((row) => row.id === current)
          ? current
          : (rows[0]?.id ?? null),
      );
      return rows;
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось загрузить экземпляры."));
      return null;
    } finally {
      setLoading(false);
    }
  }, [canonical.id]);

  useEffect(() => {
    let active = true;
    setInstances([]);
    setSelectedId(null);
    setBase(null);
    setMode("view");
    setDraft(emptyDraft());
    setSaving(false);
    setConflictLatest(null);
    skipSelectionResetRef.current = false;
    setDeletePrompt(
      pendingDeletesByCanonicalRef.current.get(canonical.id) ?? null,
    );
    setPendingDelete(
      pendingDeletesByCanonicalRef.current.get(canonical.id) ?? null,
    );
    setNotice("");
    setLoading(true);
    setError("");
    void fetchWorldContentInstances(canonical.id)
      .then((rows) => {
        if (!active) return;
        setInstances(rows);
        setSelectedId(rows[0]?.id ?? null);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(formatApiError(reason, "Не удалось загрузить экземпляры."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canonical.id]);

  const selected =
    instances.find((instance) => instance.id === selectedId) ?? null;
  const mapNames = new Map(maps.map((map) => [map.id, map.name]));
  const locationChoices = Array.from(
    new Map(locations.map((location) => [location.id, location])).values(),
  );
  const portraitAssets = assets.filter(
    (asset) =>
      (asset.kind === "IMAGE" || asset.kind === "PORTRAIT") &&
      asset.mimeType.startsWith("image/"),
  );
  const portraitById = new Map(
    portraitAssets.map((asset) => [asset.id, asset]),
  );
  const sortedLocations = [...locationChoices].sort((left, right) => {
    const leftMap = mapNames.get(left.mapId) ?? "Карта недоступна";
    const rightMap = mapNames.get(right.mapId) ?? "Карта недоступна";
    return (
      leftMap.localeCompare(rightMap, "ru") ||
      left.name.localeCompare(right.name, "ru")
    );
  });
  const locationLabel = (locationId: string | null) => {
    if (!locationId) return "не указано";
    const location = locationChoices.find(
      (candidate) => candidate.id === locationId,
    );
    if (!location) return "место недоступно";
    const mapName = mapNames.get(location.mapId) ?? "карта недоступна";
    return `${mapName} — ${location.name}`;
  };

  useEffect(() => {
    if (mode !== "view") return;
    const preserveOutcomeMessage = skipSelectionResetRef.current;
    skipSelectionResetRef.current = false;
    if (selected) {
      setBase(selected);
      setDraft(fieldsFrom(selected));
    } else {
      setBase(null);
      setDraft(emptyDraft());
    }
    setConflictLatest(null);
    if (!preserveOutcomeMessage) {
      setError("");
      setNotice("");
    }
  }, [mode, selected]);

  const dirty = useMemo(() => {
    if (!base) return {};
    const normalized = draftValues(draft, isItem);
    return Object.fromEntries(
      editableFields
        .filter(
          (field) => isItem || (field !== "quantity" && field !== "condition"),
        )
        .filter((field) => normalized[field] !== base[field])
        .map((field) => [field, normalized[field]]),
    ) as Partial<WorldContentInstanceFields>;
  }, [base, draft, isItem]);
  const quantityInvalid =
    isItem &&
    draft.quantity.trim() !== "" &&
    (!/^\d+$/.test(draft.quantity.trim()) ||
      Number(draft.quantity) > 2_147_483_647);
  const conditionInvalid =
    isItem &&
    draft.condition.trim() !== "" &&
    draft.condition.trim().length > 200;
  const retryPending =
    (mode === "create" && createActionRef.current !== null) ||
    (mode === "edit" && updateActionRef.current !== null) ||
    pendingDelete !== null;

  const selectInstance = (instance: WorldContentInstanceDto) => {
    setSelectedId(instance.id);
    setBase(instance);
    setDraft(fieldsFrom(instance));
    setMode("view");
    setConflictLatest(null);
    setError("");
    setNotice("");
  };

  const startCreate = () => {
    knownIdsAtCreateRef.current = new Set(instances.map((row) => row.id));
    createActionRef.current = null;
    setSelectedId(null);
    setBase(null);
    setDraft(emptyDraft());
    setMode("create");
    setConflictLatest(null);
    setError("");
    setNotice("");
  };

  const cancelDraft = () => {
    createActionRef.current = null;
    updateActionRef.current = null;
    setMode("view");
    setConflictLatest(null);
    setError("");
    setNotice("");
    setDraft(base ? fieldsFrom(base) : emptyDraft());
  };

  const handleCreate = async () => {
    if (quantityInvalid || conditionInvalid) return;
    setSaving(true);
    setError("");
    setNotice("");
    const request = (createActionRef.current ??= {
      actionId: actionId(),
      worldContentId: canonical.id,
      displayNameOverride: draft.displayNameOverride.trim() || null,
      currentState: draft.currentState.trim() || null,
      gmNotes: draft.gmNotes.trim() || null,
      ownerMembershipId: draft.ownerMembershipId || null,
      portraitAssetId: draft.portraitAssetId || null,
      currentLocationId: draft.currentLocationId || null,
      ...(isItem ? draftValues(draft, true) : {}),
    });
    try {
      const result = await createWorldContentInstance(request);
      if ("duplicate" in result) {
        const rows = await load();
        const createdCandidates = rows?.filter(
          (row) =>
            !knownIdsAtCreateRef.current.has(row.id) &&
            row.worldContentId === canonical.id &&
            row.displayNameOverride === request.displayNameOverride &&
            row.currentState === request.currentState &&
            row.gmNotes === request.gmNotes &&
            row.quantity === (request.quantity ?? null) &&
            row.condition === (request.condition ?? null) &&
            row.ownerMembershipId === (request.ownerMembershipId ?? null) &&
            row.portraitAssetId === (request.portraitAssetId ?? null) &&
            row.currentLocationId === (request.currentLocationId ?? null),
        );
        createActionRef.current = null;
        setMode("view");
        if (createdCandidates?.length === 1) {
          selectInstance(createdCandidates[0]!);
          setNotice(
            "Повтор запроса распознан; существующий экземпляр загружен.",
          );
        } else {
          setNotice(
            "Запрос уже обработан. Список обновлён; выберите созданный экземпляр.",
          );
        }
        return;
      }
      createActionRef.current = null;
      setInstances((current) => [result, ...current]);
      setSelectedId(result.id);
      setBase(result);
      setDraft(fieldsFrom(result));
      setMode("view");
      setNotice("Экземпляр создан в текущей кампании.");
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось создать экземпляр."));
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async (revision = base?.revision) => {
    if (quantityInvalid || conditionInvalid) return;
    if (!base || revision === undefined || Object.keys(dirty).length === 0)
      return;
    setSaving(true);
    setError("");
    setNotice("");
    const pending = updateActionRef.current ?? {
      id: base.id,
      payload: { actionId: actionId(), revision, ...dirty },
    };
    updateActionRef.current = pending;
    try {
      const result = await updateWorldContentInstance(
        pending.id,
        pending.payload,
      );
      if ("duplicate" in result) {
        const latest = await fetchWorldContentInstance(base.id);
        setInstances((current) =>
          current.map((row) => (row.id === latest.id ? latest : row)),
        );
        updateActionRef.current = null;
        setConflictLatest(latest);
        setNotice(
          "Повтор запроса уже применён. Черновик сохранён; сравните его с актуальной версией.",
        );
        return;
      }
      updateActionRef.current = null;
      setInstances((current) =>
        current.map((row) => (row.id === result.id ? result : row)),
      );
      setBase(result);
      setDraft(fieldsFrom(result));
      setConflictLatest(null);
      setNotice("Изменения сохранены.");
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        updateActionRef.current = null;
        try {
          const latest = await fetchWorldContentInstance(pending.id);
          setInstances((current) =>
            current.map((row) => (row.id === latest.id ? latest : row)),
          );
          setConflictLatest(latest);
          setNotice(
            "Запись изменилась после загрузки. Ваш черновик сохранён; проверьте актуальную версию перед повторной записью.",
          );
        } catch (refreshError) {
          setError(
            `${formatApiError(reason, "Версия изменилась.")} Актуальную версию загрузить не удалось; черновик не сброшен. ${formatApiError(refreshError)}`,
          );
        }
      } else {
        setError(formatApiError(reason, "Не удалось сохранить изменения."));
      }
    } finally {
      setSaving(false);
    }
  };

  const beginDelete = () => {
    if (!selected || mode === "create" || saving || pendingDelete) return;
    const target = mode === "edit" ? (base ?? selected) : selected;
    setDeletePrompt({
      instanceId: target.id,
      canonicalId: canonical.id,
      actionId: actionId(),
      revision: target.revision,
      displayName: target.displayNameOverride || canonical.name,
      dirtyEdit: mode === "edit" && Object.keys(dirty).length > 0,
    });
    setError("");
  };

  const runDelete = async (intent = pendingDelete ?? deletePrompt) => {
    if (!intent || saving) return;
    const request = {
      actionId: intent.actionId,
      revision: intent.revision,
    };
    pendingDeletesByCanonicalRef.current.set(intent.canonicalId, intent);
    setPendingDelete(intent);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await deleteWorldContentInstance(intent.instanceId, request);
      if (canonicalIdRef.current !== intent.canonicalId) {
        pendingDeletesByCanonicalRef.current.delete(intent.canonicalId);
        return;
      }
      pendingDeletesByCanonicalRef.current.delete(intent.canonicalId);
      setPendingDelete(null);
      setDeletePrompt(null);
      // The server has confirmed deletion. Remove the known-deleted selection
      // before reconciliation so a failed list refresh cannot expose stale edit
      // or delete actions for it.
      skipSelectionResetRef.current = true;
      setInstances((current) =>
        current.filter((row) => row.id !== intent.instanceId),
      );
      setSelectedId(null);
      setBase(null);
      setDraft(emptyDraft());
      setMode("view");
      setConflictLatest(null);
      try {
        const rows = await fetchWorldContentInstances(intent.canonicalId);
        if (canonicalIdRef.current !== intent.canonicalId) return;
        skipSelectionResetRef.current = true;
        setInstances(rows);
        const survivor = rows[0] ?? null;
        setSelectedId(survivor?.id ?? null);
        setBase(survivor);
        setDraft(survivor ? fieldsFrom(survivor) : emptyDraft());
        setMode("view");
        setConflictLatest(null);
        setNotice(
          result?.duplicate
            ? "Подтверждённый повтор: экземпляр удалён текущим действием."
            : "Экземпляр удалён из этой кампании. Каноническая сущность и другие экземпляры не изменены.",
        );
      } catch {
        if (canonicalIdRef.current !== intent.canonicalId) return;
        setNotice(
          "Запрос на удаление подтверждён, но список не обновлён. Нажмите «Обновить список».",
        );
      }
    } catch (reason) {
      if (canonicalIdRef.current !== intent.canonicalId) return;
      if (reason instanceof ApiError && reason.status === 409) {
        pendingDeletesByCanonicalRef.current.delete(intent.canonicalId);
        setPendingDelete(null);
        setDeletePrompt(null);
        try {
          const latest = await fetchWorldContentInstance(intent.instanceId);
          if (canonicalIdRef.current !== intent.canonicalId) return;
          skipSelectionResetRef.current = true;
          setInstances((current) =>
            current.map((row) => (row.id === latest.id ? latest : row)),
          );
          setBase(latest);
          setConflictLatest(latest);
          setError(
            `Экземпляр изменился и не удалён. Загружена ревизия ${latest.revision}; проверьте данные и отдельно подтвердите удаление новой версии.`,
          );
        } catch (refreshError) {
          if (canonicalIdRef.current !== intent.canonicalId) return;
          setError(
            `Экземпляр изменился и не удалён. Актуальную версию загрузить не удалось: ${formatApiError(refreshError)}`,
          );
        }
      } else if (reason instanceof ApiError && reason.status === 404) {
        pendingDeletesByCanonicalRef.current.delete(intent.canonicalId);
        setPendingDelete(null);
        setDeletePrompt(null);
        try {
          const rows = await fetchWorldContentInstances(intent.canonicalId);
          if (canonicalIdRef.current !== intent.canonicalId) return;
          skipSelectionResetRef.current = true;
          setInstances(rows);
          setSelectedId((current) =>
            current && rows.some((row) => row.id === current)
              ? current
              : (rows[0]?.id ?? null),
          );
        } catch {
          if (canonicalIdRef.current !== intent.canonicalId) return;
          // Keep the non-success 404 message; never present it as our deletion.
        }
        setError(
          "Экземпляр недоступен или уже удалён. Этот ответ не подтверждает, что его удалил данный запрос.",
        );
      } else {
        // The request may have committed. Refresh for current state, but retain
        // and expose the exact command until an exact replay or 404/409 settles it.
        let targetIsPresent = true;
        try {
          const rows = await fetchWorldContentInstances(intent.canonicalId);
          if (canonicalIdRef.current !== intent.canonicalId) return;
          targetIsPresent = rows.some((row) => row.id === intent.instanceId);
          skipSelectionResetRef.current = true;
          setInstances(rows);
          setSelectedId((current) =>
            current && rows.some((row) => row.id === current)
              ? current
              : (rows[0]?.id ?? null),
          );
        } catch {
          if (canonicalIdRef.current !== intent.canonicalId) return;
          // Retain the retry envelope even when reconciliation is unavailable.
        }
        setPendingDelete(intent);
        setDeletePrompt(intent);
        setError(
          targetIsPresent
            ? "Ответ на удаление не подтверждён. Повтор отправит ту же команду с теми же ID и ревизией."
            : "Экземпляр сейчас отсутствует, но это не подтверждает, что его удалил данный запрос. Повторите ту же команду для сверки.",
        );
      }
    } finally {
      if (canonicalIdRef.current === intent.canonicalId) setSaving(false);
    }
  };

  return (
    <section
      className="world-content-instances"
      aria-labelledby="world-content-instances-title"
    >
      <header className="world-content-instances__header">
        <div>
          <h3 id="world-content-instances-title">Экземпляры в кампании</h3>
          <p>
            Отдельные версии «{canonical.name}» для этой кампании. Канон не
            изменяется.
          </p>
        </div>
        <Button
          view="action"
          disabled={loading || saving || retryPending}
          onClick={startCreate}
        >
          Создать экземпляр
        </Button>
      </header>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="world-content-instances__notice" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p className="muted">Загрузка экземпляров…</p>
      ) : instances.length === 0 ? (
        <p className="muted">
          В этой кампании пока нет экземпляров этой сущности.
        </p>
      ) : (
        <ul
          className="world-content-instances__list"
          aria-label="Экземпляры сущности"
        >
          {instances.map((instance) => (
            <li key={instance.id}>
              <button
                type="button"
                disabled={saving || retryPending}
                aria-pressed={instance.id === selectedId}
                className={
                  instance.id === selectedId ? "is-selected" : undefined
                }
                onClick={() => selectInstance(instance)}
              >
                <span>{instance.displayNameOverride || canonical.name}</span>
                <small>
                  {instance.currentState || "Состояние не указано"}
                  <span>
                    {" · владелец: "}
                    {instance.ownerMembershipId
                      ? (members.find(
                          (member) => member.id === instance.ownerMembershipId,
                        )?.displayName ?? "участник недоступен")
                      : "не назначен"}
                  </span>
                  <span>{` · место: ${locationLabel(instance.currentLocationId)}`}</span>
                  <span> · ревизия {instance.revision}</span>
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(mode === "create" || mode === "edit") && (
        <div className="world-content-instances__form">
          <h4>
            {mode === "create" ? "Новый экземпляр" : "Изменить экземпляр"}
          </h4>
          {mode === "edit" && base && (
            <p className="muted">
              Каноническая сущность: {canonical.name} · ревизия {base.revision}
            </p>
          )}
          <label className="field">
            Имя в этой кампании
            <FormInput
              value={draft.displayNameOverride}
              maxLength={200}
              disabled={saving || retryPending}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  displayNameOverride: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            Состояние
            <FormTextArea
              value={draft.currentState}
              maxLength={4000}
              disabled={saving || retryPending}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  currentState: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            Заметки мастера
            <FormTextArea
              value={draft.gmNotes}
              maxLength={20000}
              disabled={saving || retryPending}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  gmNotes: event.target.value,
                }))
              }
            />
          </label>
          <div className="field">
            <span>Портрет экземпляра</span>
            <AssetPicker
              aria-label="Портрет экземпляра"
              value={draft.portraitAssetId || null}
              onUpload={
                onUpload
                  ? async (file) => (await onUpload(file, "IMAGE")).id
                  : undefined
              }
              noneLabel="Без портрета"
              disabled={saving || retryPending}
              assets={portraitAssets}
              onChange={(assetId) =>
                setDraft((current) => ({
                  ...current,
                  portraitAssetId: assetId ?? "",
                }))
              }
            />
            {draft.portraitAssetId &&
              !portraitById.has(draft.portraitAssetId) && (
                <p className="muted" role="status">
                  Сохранённый портрет недоступен. Выберите другой или снимите
                  выбор.
                </p>
              )}
          </div>
          <div className="field">
            <span>Текущее место на карте кампании</span>
            <FormSelect
              aria-label="Текущее место на карте кампании"
              value={draft.currentLocationId}
              disabled={saving || retryPending}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  currentLocationId: event.target.value,
                }))
              }
            >
              <option value="">Не указано</option>
              {draft.currentLocationId &&
                !locationChoices.some(
                  (location) => location.id === draft.currentLocationId,
                ) && (
                  <option value={draft.currentLocationId}>
                    Место недоступно
                  </option>
                )}
              {sortedLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {mapNames.get(location.mapId) ?? "Карта недоступна"} —{" "}
                  {location.name}
                </option>
              ))}
            </FormSelect>
            {draft.currentLocationId &&
              !locationChoices.some(
                (location) => location.id === draft.currentLocationId,
              ) && (
                <p className="muted" role="status">
                  Сохранённое место недоступно. Выберите другое или снимите
                  выбор.
                </p>
              )}
          </div>
          <label className="field">
            Владелец в этой кампании
            <FormSelect
              value={draft.ownerMembershipId}
              disabled={saving || retryPending}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  ownerMembershipId: event.target.value,
                }))
              }
            >
              <option value="">Не назначен</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName} (
                  {member.role === "GM" ? "Мастер" : "Игрок"})
                </option>
              ))}
            </FormSelect>
          </label>
          {isItem && (
            <>
              <label className="field">
                Количество{" "}
                <span className="muted">
                  (пусто — не указано; 0 — явно ноль)
                </span>
                <FormInput
                  type="number"
                  min={0}
                  max={2_147_483_647}
                  step={1}
                  inputMode="numeric"
                  value={draft.quantity}
                  disabled={saving || retryPending}
                  aria-invalid={quantityInvalid}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                Состояние предмета
                <FormInput
                  value={draft.condition}
                  maxLength={200}
                  disabled={saving || retryPending}
                  aria-invalid={conditionInvalid}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      condition: event.target.value,
                    }))
                  }
                />
              </label>
              {(quantityInvalid || conditionInvalid) && (
                <p className="field-error" role="alert">
                  {quantityInvalid
                    ? "Количество должно быть целым числом от 0 до 2 147 483 647 или оставаться пустым."
                    : "Состояние предмета должно содержать не более 200 символов."}
                </p>
              )}
            </>
          )}
          {mode === "edit" && conflictLatest && (
            <div className="world-content-instances__conflict" role="alert">
              <strong>
                Актуальная версия — ревизия {conflictLatest.revision}.
              </strong>
              <p>Имя: {conflictLatest.displayNameOverride || canonical.name}</p>
              <p>Состояние: {conflictLatest.currentState || "не указано"}</p>
              <p>Заметки мастера: {conflictLatest.gmNotes || "нет"}</p>
              <p>
                Владелец:{" "}
                {conflictLatest.ownerMembershipId
                  ? (members.find(
                      (member) =>
                        member.id === conflictLatest.ownerMembershipId,
                    )?.displayName ?? "участник недоступен")
                  : "не назначен"}
              </p>
              <p>
                Портрет:{" "}
                {conflictLatest.portraitAssetId
                  ? portraitById.has(conflictLatest.portraitAssetId)
                    ? "изображение сохранено"
                    : "изображение недоступно"
                  : "не указан"}
              </p>
              <p>Место: {locationLabel(conflictLatest.currentLocationId)}</p>
              {isItem && (
                <>
                  <p>Количество: {conflictLatest.quantity ?? "не указано"}</p>
                  <p>
                    Состояние предмета:{" "}
                    {conflictLatest.condition || "не указано"}
                  </p>
                </>
              )}
              <p>
                Ваш текст остаётся в полях выше. Повторная запись затронет
                только изменённые поля.
              </p>
            </div>
          )}
          <div className="world-content-instances__actions">
            <Button disabled={saving || retryPending} onClick={cancelDraft}>
              Отмена
            </Button>
            <Button
              view="action"
              loading={saving}
              disabled={
                saving ||
                quantityInvalid ||
                conditionInvalid ||
                (mode === "edit" && Object.keys(dirty).length === 0)
              }
              onClick={() =>
                mode === "create" ? void handleCreate() : void saveDraft()
              }
            >
              {retryPending
                ? "Повторить тот же запрос"
                : mode === "create"
                  ? "Создать"
                  : "Сохранить"}
            </Button>
            {mode === "edit" && conflictLatest && (
              <Button
                view="action"
                disabled={saving || Object.keys(dirty).length === 0}
                onClick={() => void saveDraft(conflictLatest.revision)}
              >
                Сохранить черновик поверх ревизии {conflictLatest.revision}
              </Button>
            )}
            {mode === "edit" && base && (
              <Button
                ref={deleteTriggerRef}
                view="action-danger"
                disabled={saving || retryPending}
                onClick={beginDelete}
              >
                Удалить экземпляр…
              </Button>
            )}
          </div>
        </div>
      )}

      {mode === "view" && selected?.portraitAssetId && (
        <div className="world-content-instances__portrait-preview">
          {portraitById.has(selected.portraitAssetId) &&
          failedPreviewId !== selected.portraitAssetId ? (
            <img
              src={portraitById.get(selected.portraitAssetId)!.url}
              alt={`Портрет: ${selected.displayNameOverride || canonical.name}`}
              onError={() => setFailedPreviewId(selected.portraitAssetId)}
            />
          ) : (
            <span role="status">Предпросмотр портрета недоступен.</span>
          )}
        </div>
      )}

      {mode === "view" && selected && (
        <div className="world-content-instances__actions">
          <Button view="action" onClick={() => setMode("edit")}>
            Изменить выбранный экземпляр
          </Button>
          <Button
            ref={deleteTriggerRef}
            view="action-danger"
            disabled={saving || retryPending}
            onClick={beginDelete}
          >
            Удалить экземпляр…
          </Button>
          <Button onClick={() => void load()} disabled={loading}>
            Обновить список
          </Button>
        </div>
      )}
      <Dialog
        open={deletePrompt !== null}
        title="Удаление экземпляра"
        danger
        aria-describedby="world-content-instance-delete-description"
        onClose={() => {
          if (!saving && !pendingDelete) setDeletePrompt(null);
        }}
      >
        <div id="world-content-instance-delete-description">
          {deletePrompt && (
            <>
              <p>
                Удалить экземпляр «{deletePrompt.displayName}» из этой кампании
                навсегда?
              </p>
              <p>Каноническая сущность и другие экземпляры не изменятся.</p>
              {deletePrompt.dirtyEdit && (
                <p role="alert">
                  Несохранённые изменения этого экземпляра будут отброшены только
                  после подтверждения удаления.
                </p>
              )}
            </>
          )}
        </div>
        <Dialog.Footer>
          <div className="world-content-instances__actions">
            <Button
              disabled={saving || pendingDelete !== null}
              onClick={() => setDeletePrompt(null)}
            >
              Отмена
            </Button>
            <Button
              view="action-danger"
              loading={saving}
              disabled={saving || !deletePrompt}
              onClick={() => void runDelete()}
            >
              {pendingDelete
                ? "Повторить то же удаление"
                : deletePrompt?.dirtyEdit
                  ? "Отбросить изменения и удалить"
                  : "Удалить экземпляр"}
            </Button>
          </div>
        </Dialog.Footer>
      </Dialog>
    </section>
  );
}
