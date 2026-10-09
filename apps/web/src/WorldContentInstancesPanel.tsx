import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CreateWorldContentInstance,
  MembershipDto,
  UpdateWorldContentInstance,
  WorldContentInstanceDto,
} from "@arken/contracts";
import { ApiError, formatApiError } from "./api";
import { Button } from "./design-system/Button";
import { FormInput, FormSelect, FormTextArea } from "./ui/GravityFormControls";
import {
  createWorldContentInstance,
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
};

const emptyDraft = (): Draft => ({
  displayNameOverride: "",
  currentState: "",
  gmNotes: "",
  quantity: "",
  condition: "",
  ownerMembershipId: "",
});

const fieldsFrom = (instance: WorldContentInstanceDto): Draft => ({
  displayNameOverride: instance.displayNameOverride ?? "",
  currentState: instance.currentState ?? "",
  gmNotes: instance.gmNotes ?? "",
  quantity: instance.quantity === null ? "" : String(instance.quantity),
  condition: instance.condition ?? "",
  ownerMembershipId: instance.ownerMembershipId ?? "",
});

const editableFields = [
  "displayNameOverride",
  "currentState",
  "gmNotes",
  "quantity",
  "condition",
  "ownerMembershipId",
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
});

function actionId() {
  return globalThis.crypto.randomUUID();
}

export function WorldContentInstancesPanel({
  canonical,
  members = [],
}: {
  canonical: { id: string; name: string; type: string };
  members?: readonly MembershipDto[];
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
  const [conflictLatest, setConflictLatest] =
    useState<WorldContentInstanceDto | null>(null);
  const createActionRef = useRef<CreateWorldContentInstance | null>(null);
  const updateActionRef = useRef<{
    id: string;
    payload: UpdateWorldContentInstance;
  } | null>(null);
  const knownIdsAtCreateRef = useRef<Set<string>>(new Set());

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
    setConflictLatest(null);
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

  useEffect(() => {
    if (mode !== "view") return;
    if (selected) {
      setBase(selected);
      setDraft(fieldsFrom(selected));
    } else {
      setBase(null);
      setDraft(emptyDraft());
    }
    setConflictLatest(null);
    setError("");
    setNotice("");
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
    (mode === "edit" && updateActionRef.current !== null);

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
            row.ownerMembershipId === (request.ownerMembershipId ?? null),
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
          </div>
        </div>
      )}

      {mode === "view" && selected && (
        <div className="world-content-instances__actions">
          <Button view="action" onClick={() => setMode("edit")}>
            Изменить выбранный экземпляр
          </Button>
          <Button onClick={() => void load()} disabled={loading}>
            Обновить список
          </Button>
        </div>
      )}
    </section>
  );
}
