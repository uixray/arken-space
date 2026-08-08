import { useEffect, useMemo, useState } from "react";
import type {
  AssetDto,
  WorldContentDto,
  WorldContentLifecycle,
  WorldContentMediaDto,
  WorldContentRelationEdgeDto,
  WorldContentType,
} from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import { ArkenDialog } from "./ui/ArkenDialog";
import { FormInput, FormSelect, FormTextArea } from "./ui/GravityFormControls";
import { ApiError, formatApiError } from "./api";
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
} from "./world-content-client";
import "./WorldContentWorkspace.css";

const safeError = "Не удалось выполнить операцию. Попробуйте ещё раз.";

/**
 * GM entity manager + review queue (UIX-245 Stage 3). Self-fetches against
 * `/api/world-content*` (see `world-content-client.ts`) rather than riding
 * `GameSnapshot`, since World Content is campaign-independent (mirrors
 * `OperatorFeedbackWorkspace`'s self-contained fetch pattern, not
 * `WorldMapsWorkspace`'s snapshot-driven one).
 *
 * `assets` (from `snapshot.assets`) is used only to let the GM pick an
 * *already-uploaded* asset for the cover image and gallery — there is no
 * world-content-specific upload endpoint yet (see the module doc comment on
 * `world-content-routes.ts`: `assetId` has no FK, by design). A proper asset
 * picker/uploader for World Content is a gap flagged for a follow-up task.
 */
export function WorldContentWorkspace({
  open,
  assets,
  onClose,
}: {
  open: boolean;
  assets: AssetDto[];
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
    try {
      const fresh = await fetchWorldContentDetail(id);
      applyUpdated(fresh);
    } catch {
      // Entity may have been archived/removed elsewhere; leave stale copy,
      // the next full list refresh will reconcile it.
    }
  };

  return (
    <ArkenDialog
      open={open}
      footer={false}
      title="Энциклопедия мира"
      variant="workspace"
      className="world-content-workspace"
      workspaceDraggable={false}
      onClose={onClose}
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
                placeholder="fraction, port"
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
                    onClick={() => setSelectedId(item.id)}
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
            <EntityDetail
              key={selected.id}
              entity={selected}
              allEntities={items}
              assets={assets}
              onSaved={applyUpdated}
              onConflict={() => void refetchSelected(selected.id)}
            />
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
            setSelectedId(created.id);
            setCreateOpen(false);
          }}
        />
      )}
    </ArkenDialog>
  );
}

function CreateEntityDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: WorldContentDto) => void;
}) {
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

  const submit = async () => {
    if (!name.trim()) {
      setError("Укажите название.");
      return;
    }
    if (!slugValid) {
      setError(
        "Slug должен быть в kebab-case (строчные латинские буквы, цифры, дефисы).",
      );
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
      <label className="field">
        Название
        <FormInput
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        Slug
        <FormInput
          value={effectiveSlug}
          disabled={busy}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.target.value);
          }}
        />
        {!slugValid && effectiveSlug.length > 0 && (
          <span className="field-error">
            Только строчные латинские буквы, цифры и дефисы.
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
      <p className="muted">Создаётся как черновик (DRAFT).</p>
    </ArkenDialog>
  );
}

function EntityDetail({
  entity,
  allEntities,
  assets,
  onSaved,
  onConflict,
}: {
  entity: WorldContentDto;
  allEntities: WorldContentDto[];
  assets: AssetDto[];
  onSaved: (updated: WorldContentDto) => void;
  onConflict: () => void;
}) {
  const [name, setName] = useState(entity.name);
  const [subtype, setSubtype] = useState(entity.subtype ?? "");
  const [aliases, setAliases] = useState(entity.aliases.join(", "));
  const [summary, setSummary] = useState(entity.summary);
  const [publicText, setPublicText] = useState(entity.publicText);
  const [gmOnlyText, setGmOnlyText] = useState(entity.gmOnlyText);
  const [tags, setTags] = useState(entity.tags.join(", "));
  const [coverAssetId, setCoverAssetId] = useState(entity.coverAssetId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const dirty =
    name !== entity.name ||
    subtype !== (entity.subtype ?? "") ||
    aliases !== entity.aliases.join(", ") ||
    summary !== entity.summary ||
    publicText !== entity.publicText ||
    gmOnlyText !== entity.gmOnlyText ||
    tags !== entity.tags.join(", ") ||
    coverAssetId !== (entity.coverAssetId ?? "");

  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await updateWorldContent(entity.id, {
        revision: entity.revision,
        name: name.trim(),
        subtype: subtype.trim() || null,
        aliases: parseTagList(aliases),
        summary,
        publicText,
        gmOnlyText,
        tags: parseTagList(tags),
        coverAssetId: coverAssetId || null,
      });
      onSaved(updated);
      setNotice("Сохранено.");
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        onConflict();
        setError(
          "Сущность изменена в другом месте. Данные обновлены — проверьте поля и сохраните снова.",
        );
        return;
      }
      setError(formatApiError(reason, safeError));
    } finally {
      setBusy(false);
    }
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
        <span className="muted">rev. {entity.revision}</span>
      </header>
      <div className="world-content-workspace__lifecycle-actions">
        {legalWorldContentTransitions(entity.lifecycle).map((next) => (
          <Button
            key={next}
            size="s"
            disabled={busy}
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
            disabled={busy}
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
      <label className="field">
        Название
        <FormInput
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        Подтип
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
        Теги (через запятую)
        <FormInput
          value={tags}
          disabled={busy}
          onChange={(event) => setTags(event.target.value)}
        />
      </label>
      <label className="field">
        Обложка
        <FormSelect
          value={coverAssetId}
          disabled={busy}
          onChange={(event) => setCoverAssetId(event.target.value)}
          emptyMessage="Нет загруженных файлов"
        >
          <option value="">Без обложки</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </FormSelect>
      </label>
      <label className="field">
        Краткое описание
        <FormTextArea
          value={summary}
          rows={2}
          disabled={busy}
          onChange={(event) => setSummary(event.target.value)}
        />
      </label>
      <label className="field">
        Текст для игроков (публичный)
        <FormTextArea
          value={publicText}
          rows={8}
          disabled={busy}
          onChange={(event) => setPublicText(event.target.value)}
        />
      </label>
      <div className="world-content-workspace__gm-only">
        <p className="world-content-workspace__gm-only-badge">
          Только для мастера — игроки этот текст никогда не увидят
        </p>
        <FormTextArea
          value={gmOnlyText}
          rows={8}
          disabled={busy}
          onChange={(event) => setGmOnlyText(event.target.value)}
        />
      </div>
      <Button
        view="action"
        disabled={busy || !dirty}
        loading={busy}
        onClick={() => void save()}
      >
        Сохранить
      </Button>
      <RelationsSection entity={entity} allEntities={allEntities} />
      <MediaSection entity={entity} assets={assets} />
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
}: {
  entity: WorldContentDto;
  assets: AssetDto[];
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
              <img src={`/api/assets/${item.assetId}/content`} alt={item.caption ?? ""} />
              {item.caption && <p>{item.caption}</p>}
              <div className="world-content-workspace__media-actions">
                <Button
                  size="s"
                  disabled={busy || index === 0}
                  onClick={() => void reorder(item.id, "up")}
                >
                  ↑
                </Button>
                <Button
                  size="s"
                  disabled={busy || index === sorted.length - 1}
                  onClick={() => void reorder(item.id, "down")}
                >
                  ↓
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
        <FormSelect
          value={assetId}
          disabled={busy}
          onChange={(event) => setAssetId(event.target.value)}
          emptyMessage="Нет загруженных файлов"
        >
          <option value="">Выберите файл…</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </FormSelect>
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
