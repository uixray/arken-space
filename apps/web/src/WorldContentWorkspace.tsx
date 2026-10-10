import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AssetDto,
  WorldContentDto,
  WorldContentLifecycle,
  WorldContentMediaDto,
  MembershipDto,
  WorldMapsSnapshotDto,
  WorldContentRelationEdgeDto,
  WorldContentType,
} from "@arken/contracts";
import { Button } from "./design-system/Button";
import { ArkenDialog } from "./ui/ArkenDialog";
import { FormInput, FormSelect, FormTextArea } from "./ui/GravityFormControls";
import { AssetPicker } from "./ui/AssetPicker";
import type { AssetActions } from "./use-asset-actions";
import { ApiError, formatApiError } from "./api";
import { WORLD_EDITOR_TITLE } from "./world-workspace-labels";
import { WorldContentInstancesPanel } from "./WorldContentInstancesPanel";
import { AppIcon } from "./ui/AppIcon";
import { MoveDownIcon, MoveUpIcon } from "./ui/icons";
import {
  WORLD_CONTENT_LIFECYCLE_LABELS,
  WORLD_CONTENT_LIFECYCLES,
  WORLD_CONTENT_TYPES,
  WORLD_CONTENT_TYPE_LABELS,
  addWorldContentMedia,
  archiveWorldContent,
  computeWorldContentMediaSwap,
  createWorldContent,
  createWorldContentRelation,
  deleteWorldContentRelation,
  fetchWorldContentDetail,
  fetchWorldContentList,
  fetchWorldContentMedia,
  fetchWorldContentRelations,
  isValidWorldContentSlug,
  legalWorldContentTransitions,
  parseTagList,
  removeWorldContentMedia,
  slugifyWorldContentName,
  sortWorldContentMedia,
  transitionWorldContentLifecycle,
  updateWorldContent,
  updateWorldContentMedia,
  isDuplicateWorldContentUpdate,
} from "./world-content-client";
import {
  canonicalDraftFromEntity,
  canonicalEditFieldLabel,
  canonicalEditFieldValue,
  canonicalEditPatch,
  canonicalEditValue,
  createCanonicalEditEnvelope,
  reapplyCanonicalEditPatch,
  type CanonicalEditEnvelope,
  type CanonicalEditPatch,
  type CanonicalEntityDraft,
} from "./canonical-edit-state";
import "./WorldContentWorkspace.css";

const safeError = "Не удалось выполнить операцию. Попробуйте ещё раз.";

type PendingCanonicalSave = {
  envelope: CanonicalEditEnvelope;
  base: WorldContentDto;
  status: "sending" | "unknown" | "reconciling";
};

type CanonicalConflict = {
  base: WorldContentDto;
  payload: CanonicalEditPatch;
  latest: WorldContentDto | null;
};

/**
 * GM entity manager + review queue (UIX-245 Stage 3). Self-fetches against
 * `/api/world-content*` (see `world-content-client.ts`) rather than riding
 * `GameSnapshot`, since World Content is campaign-independent (mirrors
 * `OperatorFeedbackWorkspace`'s self-contained fetch pattern, not
 * `WorldMapsWorkspace`'s snapshot-driven one).
 *
 * `assets` comes from `snapshot.assets`; cover and gallery pickers can upload
 * through the shared asset endpoint and select the new image immediately.
 * World Content still has no dedicated upload endpoint (its assetId has no FK).
 *
 * UIX-395: memoized — the entity list/detail/relations/media all self-fetch
 * (see above); `assets`, `members` and `worldMaps` are narrowly sourced from
 * `GameSnapshot` in `Sidebar.tsx` for the instance editor's authorized
 * selectors. Stable snapshot fields avoid unrelated panel refreshes.
 */
export const WorldContentWorkspace = memo(function WorldContentWorkspace({
  open,
  assets,
  members = [],
  worldMaps,
  onUpload,
  onClose,
}: {
  open: boolean;
  assets: AssetDto[];
  members?: readonly MembershipDto[];
  worldMaps?: WorldMapsSnapshotDto;
  onUpload?: AssetActions["uploadAsset"];
  onClose: () => void;
}) {
  const [items, setItems] = useState<WorldContentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [filterType, setFilterType] = useState<WorldContentType | "">("");
  const [filterLifecycle, setFilterLifecycle] = useState<
    WorldContentLifecycle | "ALL"
  >("ALL");
  const [filterTags, setFilterTags] = useState("");
  const [filterQ, setFilterQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editorGuard, setEditorGuard] = useState({
    dirty: false,
    pending: false,
  });
  const editorGuardRef = useRef(editorGuard);
  const [pendingExit, setPendingExit] = useState<
    { kind: "close" } | { kind: "select"; id: string } | null
  >(null);
  const selectedIdRef = useRef(selectedId);
  const selectionEpochRef = useRef(0);
  selectedIdRef.current = selectedId;

  const setSelection = (id: string | null) => {
    selectionEpochRef.current += 1;
    selectedIdRef.current = id;
    setSelectedId(id);
    editorGuardRef.current = { dirty: false, pending: false };
    setEditorGuard(editorGuardRef.current);
  };

  const requestSelection = (id: string) => {
    if (id === selectedIdRef.current) return;
    if (editorGuardRef.current.dirty || editorGuardRef.current.pending) {
      setPendingExit({ kind: "select", id });
      return;
    }
    setSelection(id);
  };

  const requestClose = () => {
    if (editorGuardRef.current.dirty || editorGuardRef.current.pending) {
      setPendingExit({ kind: "close" });
      return;
    }
    selectionEpochRef.current += 1;
    onClose();
  };

  const onEditorStateChange = useCallback(
    (state: { dirty: boolean; pending: boolean }) => {
      editorGuardRef.current = state;
      setEditorGuard(state);
    },
    [],
  );

  const confirmExit = () => {
    const next = pendingExit;
    setPendingExit(null);
    if (next?.kind === "select") setSelection(next.id);
    else if (next?.kind === "close") {
      selectionEpochRef.current += 1;
      onClose();
    }
  };

  const load = async () => {
    setLoading(true);
    setListError("");
    try {
      const list = await fetchWorldContentList({
        type: filterType || undefined,
        tags: parseTagList(filterTags),
        q: filterQ.trim() || undefined,
      });
      setItems(list);
    } catch (reason) {
      setListError(formatApiError(reason, "Не удалось загрузить список."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visible = useMemo(
    () =>
      filterLifecycle === "ALL"
        ? items
        : items.filter((item) => item.lifecycle === filterLifecycle),
    [items, filterLifecycle],
  );

  const selected = items.find((item) => item.id === selectedId) ?? null;

  const applyUpdated = (updated: WorldContentDto) => {
    setItems((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
  };

  const refetchSelected = async (id: string) => {
    const epoch = selectionEpochRef.current;
    try {
      const fresh = await fetchWorldContentDetail(id);
      if (epoch !== selectionEpochRef.current || selectedIdRef.current !== id)
        return null;
      applyUpdated(fresh);
      return fresh;
    } catch {
      // Entity may have been archived/removed elsewhere; leave stale copy,
      // the next full list refresh will reconcile it.
      return null;
    }
  };

  return (
    <>
      <ArkenDialog
        open={open}
        footer={false}
        title={WORLD_EDITOR_TITLE}
        variant="workspace"
        className="world-content-workspace"
        workspaceDraggable={false}
        onClose={requestClose}
      >
        <div className="world-content-workspace__grid">
          <section className="world-content-workspace__list-pane">
            <div className="world-content-workspace__filters">
              <label className="field">
                Тип
                <FormSelect
                  value={filterType}
                  onChange={(event) =>
                    setFilterType(event.target.value as WorldContentType | "")
                  }
                >
                  <option value="">Все типы</option>
                  {WORLD_CONTENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {WORLD_CONTENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </FormSelect>
              </label>
              <label className="field">
                Статус
                <FormSelect
                  value={filterLifecycle}
                  onChange={(event) =>
                    setFilterLifecycle(
                      event.target.value as WorldContentLifecycle | "ALL",
                    )
                  }
                >
                  <option value="ALL">Все статусы (очередь проверки)</option>
                  {WORLD_CONTENT_LIFECYCLES.map((lifecycle) => (
                    <option key={lifecycle} value={lifecycle}>
                      {WORLD_CONTENT_LIFECYCLE_LABELS[lifecycle]}
                    </option>
                  ))}
                </FormSelect>
              </label>
              <label className="field">
                Поиск
                <FormInput
                  value={filterQ}
                  placeholder="Название, описание, алиас…"
                  onChange={(event) => setFilterQ(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void load();
                  }}
                />
              </label>
              <label className="field">
                Теги (через запятую)
                <FormInput
                  value={filterTags}
                  placeholder="фракция, порт"
                  onChange={(event) => setFilterTags(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void load();
                  }}
                />
              </label>
              <Button onClick={() => void load()} disabled={loading}>
                Применить
              </Button>
              <Button view="action" onClick={() => setCreateOpen(true)}>
                Создать сущность
              </Button>
            </div>
            {listError && (
              <p className="field-error" role="alert">
                {listError}
              </p>
            )}
            {loading ? (
              <p className="muted">Загрузка…</p>
            ) : visible.length === 0 ? (
              <p className="muted">Ничего не найдено.</p>
            ) : (
              <ul className="world-content-workspace__list">
                {visible.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={
                        item.id === selectedId
                          ? "world-content-workspace__row is-selected"
                          : "world-content-workspace__row"
                      }
                      onClick={() => requestSelection(item.id)}
                    >
                      <span
                        className={`world-content-workspace__badge world-content-workspace__badge--${item.lifecycle.toLowerCase()}`}
                      >
                        {WORLD_CONTENT_LIFECYCLE_LABELS[item.lifecycle]}
                      </span>
                      <span className="world-content-workspace__row-name">
                        {item.name}
                      </span>
                      <span className="world-content-workspace__row-type">
                        {WORLD_CONTENT_TYPE_LABELS[item.type]}
                      </span>
                      {item.tags.length > 0 && (
                        <span className="world-content-workspace__row-tags">
                          {item.tags.map((tag) => (
                            <span key={tag} className="chip">
                              {tag}
                            </span>
                          ))}
                        </span>
                      )}
                      <span className="world-content-workspace__row-updated">
                        {new Date(item.updatedAt).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="world-content-workspace__detail-pane">
            {selected ? (
              <>
                <EntityDetail
                  key={selected.id}
                  entity={selected}
                  allEntities={items}
                  assets={assets}
                  onUpload={onUpload}
                  onSaved={applyUpdated}
                  onConflict={() => refetchSelected(selected.id)}
                  onEditorStateChange={onEditorStateChange}
                />
                <WorldContentInstancesPanel
                  key={selected.id}
                  canonical={{
                    id: selected.id,
                    name: selected.name,
                    type: selected.type,
                  }}
                  members={members}
                  assets={assets}
                  maps={worldMaps?.maps ?? []}
                  locations={[
                    ...(worldMaps?.locations ?? []),
                    ...(worldMaps?.gmLocations ?? []),
                  ]}
                  onUpload={onUpload}
                />
              </>
            ) : (
              <p className="muted">
                Выберите сущность слева, чтобы просмотреть или отредактировать
                её.
              </p>
            )}
          </section>
        </div>
        {createOpen && (
          <CreateEntityDialog
            onClose={() => setCreateOpen(false)}
            onCreated={(created) => {
              setItems((current) => [created, ...current]);
              setCreateOpen(false);
              requestSelection(created.id);
            }}
          />
        )}
      </ArkenDialog>
      <ArkenDialog
        open={pendingExit !== null}
        footer={false}
        title="Покинуть редактор?"
        onClose={() => setPendingExit(null)}
      >
        <p>
          {editorGuard.pending
            ? "Есть незавершённый запрос сохранения. Сервер мог применить его; при уходе вы потеряете черновик и возможность повторить тот же запрос."
            : "Есть несохранённые изменения. Если продолжить, локальный черновик будет отброшен."}
        </p>
        <div className="world-content-workspace__exit-actions">
          <Button onClick={() => setPendingExit(null)}>Остаться</Button>
          <Button view="flat-danger" onClick={confirmExit}>
            {pendingExit?.kind === "select"
              ? "Отбросить и открыть выбранную сущность"
              : "Отбросить и закрыть редактор"}
          </Button>
        </div>
      </ArkenDialog>
    </>
  );
});

function CreateEntityDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: WorldContentDto) => void;
}) {
  const fieldId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const [attempted, setAttempted] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [type, setType] = useState<WorldContentType>("LOCATION");
  const [subtype, setSubtype] = useState("");
  const [aliases, setAliases] = useState("");
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const effectiveSlug = slugTouched ? slug : slugifyWorldContentName(name);
  const slugValid = isValidWorldContentSlug(effectiveSlug);
  const nameInvalid = attempted && !name.trim();
  const slugInvalid =
    !slugValid &&
    (effectiveSlug.length > 0 ||
      (attempted && (slugTouched || Boolean(name.trim()))));
  const slugHint = !effectiveSlug.trim()
    ? "Укажите идентификатор, например waterdeep."
    : effectiveSlug.trim().length > 160
      ? "Идентификатор — не больше 160 символов."
      : "Только строчные латинские буквы, цифры и дефисы.";

  const submit = async () => {
    setAttempted(true);
    if (!name.trim()) {
      setError("Укажите название.");
      nameRef.current?.focus();
      return;
    }
    if (!slugValid) {
      setError(
        "Идентификатор должен содержать строчные латинские буквы, цифры и дефисы между словами.",
      );
      slugRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await createWorldContent({
        name: name.trim(),
        slug: effectiveSlug,
        type,
        subtype: subtype.trim() || null,
        aliases: parseTagList(aliases),
        summary: summary.trim() || undefined,
        tags: parseTagList(tags),
      });
      onCreated(created);
    } catch (reason) {
      setError(formatApiError(reason, safeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ArkenDialog
      open
      title="Новая сущность энциклопедии"
      applyLabel="Создать"
      loading={busy}
      error={error}
      onApply={() => void submit()}
      onClose={onClose}
    >
      <label className="field world-content-workspace__create-name">
        Название
        <FormInput
          controlRef={nameRef}
          aria-label="Название"
          aria-invalid={nameInvalid}
          aria-describedby={nameInvalid ? `${fieldId}-name-error` : undefined}
          value={name}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
        />
        {nameInvalid && (
          <span id={`${fieldId}-name-error`} className="field-error">
            Укажите название.
          </span>
        )}
      </label>
      <label className="field">
        Идентификатор
        <FormInput
          controlRef={slugRef}
          aria-label="Идентификатор"
          aria-invalid={slugInvalid}
          aria-describedby={slugInvalid ? `${fieldId}-slug-error` : undefined}
          value={effectiveSlug}
          disabled={busy}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.target.value);
            setError("");
          }}
        />
        {slugInvalid && (
          <span id={`${fieldId}-slug-error`} className="field-error">
            {slugHint}
          </span>
        )}
      </label>
      <label className="field">
        Тип
        <FormSelect
          value={type}
          disabled={busy}
          onChange={(event) => setType(event.target.value as WorldContentType)}
        >
          {WORLD_CONTENT_TYPES.map((option) => (
            <option key={option} value={option}>
              {WORLD_CONTENT_TYPE_LABELS[option]}
            </option>
          ))}
        </FormSelect>
      </label>
      <label className="field">
        Подтип (свободный текст)
        <FormInput
          value={subtype}
          disabled={busy}
          onChange={(event) => setSubtype(event.target.value)}
        />
      </label>
      <label className="field">
        Алиасы (через запятую)
        <FormInput
          value={aliases}
          disabled={busy}
          onChange={(event) => setAliases(event.target.value)}
        />
      </label>
      <label className="field">
        Краткое описание
        <FormTextArea
          value={summary}
          rows={3}
          disabled={busy}
          onChange={(event) => setSummary(event.target.value)}
        />
      </label>
      <label className="field">
        Теги (через запятую)
        <FormInput
          value={tags}
          disabled={busy}
          onChange={(event) => setTags(event.target.value)}
        />
      </label>
      <p className="muted">Создаётся как черновик.</p>
    </ArkenDialog>
  );
}

function EntityDetail({
  entity,
  allEntities,
  assets,
  onUpload,
  onSaved,
  onConflict,
  onEditorStateChange,
}: {
  entity: WorldContentDto;
  allEntities: WorldContentDto[];
  assets: AssetDto[];
  onUpload?: AssetActions["uploadAsset"];
  onSaved: (updated: WorldContentDto) => void;
  onConflict: () => Promise<WorldContentDto | null>;
  onEditorStateChange: (state: { dirty: boolean; pending: boolean }) => void;
}) {
  const [draft, setDraft] = useState<CanonicalEntityDraft>(() =>
    canonicalDraftFromEntity(entity),
  );
  const baseRef = useRef(entity);
  const [pending, setPending] = useState<PendingCanonicalSave | null>(null);
  const [conflict, setConflict] = useState<CanonicalConflict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestEpochRef = useRef(0);
  const inFlightRef = useRef(false);

  const dirty =
    Object.keys(canonicalEditPatch(baseRef.current, draft)).length > 0;
  const editorLocked = busy || pending !== null || conflict !== null;

  useEffect(() => {
    onEditorStateChange({ dirty, pending: pending !== null });
  }, [dirty, pending, onEditorStateChange]);

  useEffect(
    () => () => {
      requestEpochRef.current += 1;
    },
    [],
  );

  const changeDraft = <K extends keyof CanonicalEntityDraft>(
    field: K,
    value: CanonicalEntityDraft[K],
  ) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    onEditorStateChange({
      dirty: Object.keys(canonicalEditPatch(baseRef.current, next)).length > 0,
      pending: pending !== null,
    });
  };

  const commitUpdated = (updated: WorldContentDto, message: string) => {
    baseRef.current = updated;
    setDraft(canonicalDraftFromEntity(updated));
    setPending(null);
    setConflict(null);
    onSaved(updated);
    setNotice(message);
  };

  const sendEnvelope = async (
    envelope: CanonicalEditEnvelope,
    base: WorldContentDto,
  ) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const epoch = ++requestEpochRef.current;
    const isCurrent = () => epoch === requestEpochRef.current;
    setBusy(true);
    setError("");
    setNotice("");
    setConflict(null);
    setPending({ envelope, base, status: "sending" });
    try {
      const result = await updateWorldContent(
        envelope.entityId,
        { revision: envelope.revision, ...envelope.payload },
        envelope.actionId,
      );
      if (!isCurrent()) return;
      if (isDuplicateWorldContentUpdate(result)) {
        setPending({ envelope, base, status: "reconciling" });
        try {
          const authoritative = await fetchWorldContentDetail(
            envelope.entityId,
          );
          if (!isCurrent()) return;
          commitUpdated(
            authoritative,
            "Этот запрос уже был применён. Загружена актуальная версия.",
          );
        } catch {
          if (!isCurrent()) return;
          setPending({ envelope, base, status: "unknown" });
          setError(
            "Сервер подтвердил повтор запроса, но актуальную версию загрузить не удалось. Повторите тот же запрос для сверки.",
          );
        }
        return;
      }
      commitUpdated(result, "Сохранено.");
    } catch (reason) {
      if (!isCurrent()) return;
      if (reason instanceof ApiError && reason.status === 409) {
        setPending(null);
        const nextConflict: CanonicalConflict = {
          base,
          payload: { ...envelope.payload },
          latest: null,
        };
        setConflict(nextConflict);
        setError(
          "Версия изменилась на сервере. Сверьте локальные и серверные значения.",
        );
        const latest = await onConflict();
        if (!isCurrent()) return;
        if (latest) setConflict({ ...nextConflict, latest });
        else
          setError(
            "Не удалось загрузить актуальную версию. Черновик сохранён локально; повторите загрузку.",
          );
      } else if (
        reason instanceof ApiError &&
        reason.status >= 400 &&
        reason.status < 500
      ) {
        setPending(null);
        setError(formatApiError(reason, safeError));
      } else {
        setPending({ envelope, base, status: "unknown" });
        setError(
          "Не удалось подтвердить результат сохранения. Черновик и исходный запрос сохранены в этом редакторе; повтор отправит тот же запрос.",
        );
      }
    } finally {
      if (isCurrent()) {
        inFlightRef.current = false;
        setBusy(false);
      }
    }
  };

  const save = async () => {
    if (!dirty || pending || conflict) return;
    const base = baseRef.current;
    const payload = canonicalEditPatch(base, draft);
    if (Object.keys(payload).length === 0) return;
    await sendEnvelope(
      createCanonicalEditEnvelope(base, payload, crypto.randomUUID()),
      base,
    );
  };

  const retryPending = () => {
    if (pending && pending.status !== "sending")
      void sendEnvelope(pending.envelope, pending.base);
  };

  const loadLatestAndDiscard = (latest: WorldContentDto) => {
    baseRef.current = latest;
    setDraft(canonicalDraftFromEntity(latest));
    setConflict(null);
    setError("");
    setNotice("Черновик отброшен. Загружена актуальная версия.");
  };

  const refreshConflict = async () => {
    if (inFlightRef.current || !conflict) return;
    inFlightRef.current = true;
    const epoch = ++requestEpochRef.current;
    const isCurrent = () => epoch === requestEpochRef.current;
    setBusy(true);
    setError("");
    try {
      const latest = await onConflict();
      if (!isCurrent()) return;
      if (!latest) {
        setError(
          "Актуальную версию загрузить не удалось. Черновик не изменён.",
        );
        return;
      }
      setConflict((current) => (current ? { ...current, latest } : current));
    } finally {
      if (isCurrent()) {
        inFlightRef.current = false;
        setBusy(false);
      }
    }
  };

  const reapplyConflict = () => {
    if (!conflict?.latest || conflict.latest.lifecycle === "ARCHIVED") return;
    const latest = conflict.latest;
    const payload = { ...conflict.payload };
    const mergedDraft = reapplyCanonicalEditPatch(latest, payload);
    baseRef.current = latest;
    setDraft(mergedDraft);
    setConflict(null);
    void sendEnvelope(
      createCanonicalEditEnvelope(latest, payload, crypto.randomUUID()),
      latest,
    );
  };

  const transition = async (lifecycle: WorldContentLifecycle) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await transitionWorldContentLifecycle(
        entity.id,
        entity.revision,
        lifecycle,
      );
      onSaved(updated);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        onConflict();
        setError(
          "Сущность изменена в другом месте. Статус обновлён — повторите переход при необходимости.",
        );
        return;
      }
      setError(formatApiError(reason, safeError));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await archiveWorldContent(entity.id, entity.revision);
      onSaved(updated);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        onConflict();
        setError("Сущность уже изменена в другом месте.");
        return;
      }
      setError(formatApiError(reason, safeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="world-content-workspace__detail">
      <header className="world-content-workspace__detail-header">
        <h2>{entity.name}</h2>
        <span
          className={`world-content-workspace__badge world-content-workspace__badge--${entity.lifecycle.toLowerCase()}`}
        >
          {WORLD_CONTENT_LIFECYCLE_LABELS[entity.lifecycle]}
        </span>
        <span className="muted">Версия {entity.revision}</span>
      </header>
      <div className="world-content-workspace__lifecycle-actions">
        {legalWorldContentTransitions(entity.lifecycle).map((next) => (
          <Button
            key={next}
            size="s"
            disabled={busy || editorLocked || dirty}
            onClick={() => void transition(next)}
          >
            {next === "ARCHIVED"
              ? "В архив"
              : `Перевести: ${WORLD_CONTENT_LIFECYCLE_LABELS[next]}`}
          </Button>
        ))}
        {entity.lifecycle !== "ARCHIVED" && (
          <Button
            size="s"
            view="flat-danger"
            disabled={busy || editorLocked || dirty}
            title="Мягкое удаление: переводит сущность в архив."
            onClick={() => void archive()}
          >
            Удалить (в архив)
          </Button>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="field-notice" role="status">
          {notice}
        </p>
      )}
      {pending && (
        <section
          className="world-content-workspace__save-pending"
          aria-label="Незавершённое сохранение"
        >
          <h3>Результат сохранения не подтверждён</h3>
          <p>
            Черновик заблокирован до сверки. Повтор отправит тот же запрос с
            исходной версией и идентификатором действия.
          </p>
          {pending.status !== "sending" && (
            <Button disabled={busy} onClick={retryPending}>
              Повторить тот же запрос
            </Button>
          )}
        </section>
      )}
      {conflict && (
        <section
          className="world-content-workspace__conflict"
          aria-label="Сверка конфликта версии"
        >
          <h3>Сверка изменений</h3>
          {conflict.latest ? (
            <>
              <p>
                На сервере версия {conflict.latest.revision}. Черновик не
                применён автоматически.
              </p>
              <ul className="world-content-workspace__conflict-fields">
                {(
                  Object.entries(conflict.payload) as [
                    keyof CanonicalEditPatch,
                    CanonicalEditPatch[keyof CanonicalEditPatch],
                  ][]
                ).map(([field, localValue]) => (
                  <li key={field}>
                    <strong>{canonicalEditFieldLabel(field)}</strong>
                    <p>Было: {canonicalEditFieldValue(conflict.base, field)}</p>
                    <p>Ваш черновик: {canonicalEditValue(localValue)}</p>
                    <p>
                      На сервере:{" "}
                      {canonicalEditFieldValue(conflict.latest!, field)}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="world-content-workspace__conflict-actions">
                <Button disabled={busy} onClick={refreshConflict}>
                  Обновить сравнение
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => loadLatestAndDiscard(conflict.latest!)}
                >
                  Отбросить черновик и загрузить версию{" "}
                  {conflict.latest.revision}
                </Button>
                <Button
                  view="action"
                  disabled={busy || conflict.latest.lifecycle === "ARCHIVED"}
                  onClick={reapplyConflict}
                >
                  {conflict.latest.lifecycle === "ARCHIVED"
                    ? "Архивную версию нельзя сохранить"
                    : `Перенести мои изменения на версию ${conflict.latest.revision} и сохранить`}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>
                Актуальную версию загрузить не удалось. Локальный черновик
                сохранён, но повторное применение недоступно до сверки.
              </p>
              <Button disabled={busy} onClick={refreshConflict}>
                Загрузить актуальную версию
              </Button>
            </>
          )}
        </section>
      )}
      <label className="field">
        Название
        <FormInput
          value={draft.name}
          disabled={editorLocked}
          onChange={(event) => changeDraft("name", event.target.value)}
        />
      </label>
      <label className="field">
        Подтип
        <FormInput
          value={draft.subtype}
          disabled={editorLocked}
          onChange={(event) => changeDraft("subtype", event.target.value)}
        />
      </label>
      <label className="field">
        Алиасы (через запятую)
        <FormInput
          value={draft.aliases}
          disabled={editorLocked}
          onChange={(event) => changeDraft("aliases", event.target.value)}
        />
      </label>
      <label className="field">
        Теги (через запятую)
        <FormInput
          value={draft.tags}
          disabled={editorLocked}
          onChange={(event) => changeDraft("tags", event.target.value)}
        />
      </label>
      <div className="field">
        <span>Обложка</span>
        <AssetPicker
          aria-label="Обложка"
          value={draft.coverAssetId || null}
          onUpload={
            onUpload
              ? async (file) => (await onUpload(file, "IMAGE")).id
              : undefined
          }
          noneLabel="Без обложки"
          disabled={editorLocked}
          assets={assets.filter((asset) => asset.mimeType.startsWith("image/"))}
          onChange={(assetId) => changeDraft("coverAssetId", assetId ?? "")}
        />
      </div>
      <label className="field">
        Краткое описание
        <FormTextArea
          value={draft.summary}
          rows={2}
          disabled={editorLocked}
          onChange={(event) => changeDraft("summary", event.target.value)}
        />
      </label>
      <label className="field">
        Текст для игроков (публичный)
        <FormTextArea
          value={draft.publicText}
          rows={8}
          disabled={editorLocked}
          onChange={(event) => changeDraft("publicText", event.target.value)}
        />
      </label>
      <div className="world-content-workspace__gm-only">
        <p className="world-content-workspace__gm-only-badge">
          Только для мастера — игроки этот текст никогда не увидят
        </p>
        <FormTextArea
          value={draft.gmOnlyText}
          rows={8}
          disabled={editorLocked}
          onChange={(event) => changeDraft("gmOnlyText", event.target.value)}
        />
      </div>
      <Button
        view="action"
        disabled={editorLocked || !dirty}
        loading={busy}
        onClick={() => void save()}
      >
        Сохранить
      </Button>
      <RelationsSection entity={entity} allEntities={allEntities} />
      <MediaSection entity={entity} assets={assets} onUpload={onUpload} />
    </div>
  );
}

function RelationsSection({
  entity,
  allEntities,
}: {
  entity: WorldContentDto;
  allEntities: WorldContentDto[];
}) {
  const [targetId, setTargetId] = useState("");
  const [relationType, setRelationType] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Real fetch against GET /api/world-content/:id/relations (UIX-245 Stage
  // 4) — both directions, joined with the other entity's name/type/slug —
  // replacing the earlier session-only, outgoing-only placeholder.
  const [edges, setEdges] = useState<WorldContentRelationEdgeDto[]>([]);

  const candidates = allEntities.filter((item) => item.id !== entity.id);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setEdges(await fetchWorldContentRelations(entity.id));
    } catch (reason) {
      setError(formatApiError(reason, safeError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.id]);

  const add = async () => {
    if (!targetId || !relationType.trim()) {
      setError("Выберите сущность и укажите тип связи.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createWorldContentRelation(entity.id, {
        toWorldContentId: targetId,
        relationType: relationType.trim(),
        note: note.trim() || null,
      });
      setRelationType("");
      setNote("");
      await load();
    } catch (reason) {
      setError(formatApiError(reason, safeError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (relationId: string) => {
    setBusy(true);
    setError("");
    try {
      await deleteWorldContentRelation(relationId);
      setEdges((current) => current.filter((item) => item.id !== relationId));
    } catch (reason) {
      setError(formatApiError(reason, safeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="world-content-workspace__subsection">
      <h3>Связи</h3>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : edges.length > 0 ? (
        <ul className="world-content-workspace__relations">
          {edges.map((edge) => (
            <li key={edge.id}>
              <span>
                {edge.direction === "OUTGOING"
                  ? `${edge.relationType} → ${edge.entity.name}`
                  : `${edge.entity.name} → ${edge.relationType}`}
              </span>
              {edge.note && <span className="muted"> ({edge.note})</span>}
              <Button
                size="s"
                view="flat-danger"
                disabled={busy}
                onClick={() => void remove(edge.id)}
              >
                Удалить
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Связей пока нет.</p>
      )}
      <div className="world-content-workspace__relation-form">
        <FormSelect
          aria-label="Сущность для связи"
          value={targetId}
          disabled={busy}
          onChange={(event) => setTargetId(event.target.value)}
          emptyMessage="Нет других сущностей"
        >
          <option value="">Выберите сущность…</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({WORLD_CONTENT_TYPE_LABELS[candidate.type]})
            </option>
          ))}
        </FormSelect>
        <FormInput
          value={relationType}
          placeholder="Тип связи, напр. «союзник»"
          disabled={busy}
          onChange={(event) => setRelationType(event.target.value)}
        />
        <FormInput
          value={note}
          placeholder="Заметка (необязательно)"
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
        <Button disabled={busy} onClick={() => void add()}>
          Добавить связь
        </Button>
      </div>
    </section>
  );
}

function MediaSection({
  entity,
  assets,
  onUpload,
}: {
  entity: WorldContentDto;
  assets: AssetDto[];
  onUpload?: AssetActions["uploadAsset"];
}) {
  const [items, setItems] = useState<WorldContentMediaDto[]>([]);
  const [assetId, setAssetId] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sorted = sortWorldContentMedia(items);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetchWorldContentMedia(entity.id)
      .then((fetched) => {
        if (active) setItems(fetched);
      })
      .catch((reason) => {
        if (active) setError(formatApiError(reason, safeError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entity.id]);

  const attach = async () => {
    if (!assetId) {
      setError("Выберите файл.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await addWorldContentMedia(entity.id, {
        assetId,
        caption: caption.trim() || null,
      });
      setItems((current) => [...current, created]);
      setCaption("");
      setAssetId("");
    } catch (reason) {
      setError(formatApiError(reason, safeError));
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (id: string, direction: "up" | "down") => {
    const swap = computeWorldContentMediaSwap(items, id, direction);
    if (!swap) return;
    setBusy(true);
    setError("");
    try {
      for (const move of swap) {
        const updated = await updateWorldContentMedia(entity.id, move.id, {
          ordering: move.ordering,
        });
        setItems((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
    } catch (reason) {
      setError(formatApiError(reason, safeError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await removeWorldContentMedia(entity.id, id);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (reason) {
      setError(formatApiError(reason, safeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="world-content-workspace__subsection">
      <h3>Галерея</h3>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="muted">Загрузка…</p>}
      {sorted.length > 0 && (
        <ul className="world-content-workspace__media-grid">
          {sorted.map((item, index) => (
            <li key={item.id}>
              <img
                src={
                  assets.find((asset) => asset.id === item.assetId)?.url ??
                  `/api/assets/${item.assetId}/content`
                }
                alt={item.caption ?? ""}
              />
              {item.caption && <p>{item.caption}</p>}
              <div className="world-content-workspace__media-actions">
                <Button
                  size="s"
                  disabled={busy || index === 0}
                  aria-label="Переместить выше"
                  onClick={() => void reorder(item.id, "up")}
                >
                  <AppIcon icon={MoveUpIcon} />
                </Button>
                <Button
                  size="s"
                  disabled={busy || index === sorted.length - 1}
                  aria-label="Переместить ниже"
                  onClick={() => void reorder(item.id, "down")}
                >
                  <AppIcon icon={MoveDownIcon} />
                </Button>
                <Button
                  size="s"
                  view="flat-danger"
                  disabled={busy}
                  onClick={() => void remove(item.id)}
                >
                  Убрать
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="world-content-workspace__media-form">
        <AssetPicker
          aria-label="Файл для прикрепления к галерее"
          value={assetId || null}
          onUpload={
            onUpload
              ? async (file) => (await onUpload(file, "IMAGE")).id
              : undefined
          }
          noneLabel="Выберите файл…"
          disabled={busy}
          assets={assets.filter((asset) => asset.mimeType.startsWith("image/"))}
          onChange={(nextAssetId) => setAssetId(nextAssetId ?? "")}
        />
        <FormInput
          value={caption}
          placeholder="Подпись (необязательно)"
          disabled={busy}
          onChange={(event) => setCaption(event.target.value)}
        />
        <Button disabled={busy} onClick={() => void attach()}>
          Прикрепить
        </Button>
      </div>
    </section>
  );
}
