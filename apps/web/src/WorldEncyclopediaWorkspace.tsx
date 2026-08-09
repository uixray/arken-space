import { memo, useEffect, useState } from "react";
import type {
  WorldContentMediaDto,
  WorldContentPlayerDto,
  WorldContentRelationEdgeDto,
  WorldContentType,
} from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import { ArkenDialog } from "./ui/ArkenDialog";
import { FormInput, FormSelect } from "./ui/GravityFormControls";
import { ApiError, formatApiError } from "./api";
import {
  WORLD_CONTENT_TYPES,
  WORLD_CONTENT_TYPE_LABELS,
  fetchWorldContentMedia,
  fetchWorldContentPlayerDetail,
  fetchWorldContentPlayerList,
  fetchWorldContentRelations,
  parseTagList,
} from "./world-content-client";
import "./WorldEncyclopediaWorkspace.css";

const safeError = "Не удалось загрузить энциклопедию. Попробуйте ещё раз.";
const notFoundError =
  "Эта статья недоступна — возможно, она ещё не опубликована или была скрыта.";

/**
 * Player-and-GM-facing browse/search + detail panel over the World Content
 * canon (UIX-245 Stage 4). Distinct from `WorldContentWorkspace.tsx` (the
 * GM-only entity manager, wired to the `"world-encyclopedia"`
 * `WorkspaceDestination` in `App.tsx`/`Sidebar.tsx`) — this component is
 * wired to `"world-codex"` instead, open to both `GM` and `PLAYER` (mirrors
 * how `"world-maps"` is open to both, unlike GM-only destinations such as
 * `"operator-feedback"`).
 *
 * Always calls the `*Player*`-typed client helpers in `world-content-client.ts`
 * (`fetchWorldContentPlayerList`/`fetchWorldContentPlayerDetail`), which hit
 * the same `/api/world-content*` endpoints as the GM manager but are typed
 * to the safe `WorldContentPlayerDto` subset. The server itself decides the
 * DTO shape from the caller's role (see `worldContentVisibility`/`toPlayerDto`
 * in `apps/server/src/world-content.ts`), so when a GM opens this panel they
 * transparently get the fuller GM DTO on the wire — but since this component
 * only ever reads the player-safe fields, a GM browsing here sees exactly
 * what a player would see, which is the intended "preview" behavior (no
 * DRAFT/ARCHIVED entities ever appear in the list either way, since the
 * list/detail visibility gate is server-side and role-independent for
 * *this* stage — see the module doc comment on `world-content.ts`).
 *
 * No campaign discovery/overrides here (Delivery Plan step 5) — this shows
 * the full PUBLISHED canon to every caller unconditionally.
 */
/**
 * UIX-395: memoized — self-fetches its own list/detail data (see the module
 * doc comment above) purely from `open`/an internal `id`, never from
 * `GameSnapshot`, so with a stable `onClose` (see `closeWorkspace` in
 * `Sidebar.tsx`) this panel is inert to unrelated realtime snapshot events.
 */
export const WorldEncyclopediaWorkspace = memo(function WorldEncyclopediaWorkspace({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<WorldContentPlayerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [filterType, setFilterType] = useState<WorldContentType | "">("");
  const [filterTags, setFilterTags] = useState("");
  const [filterQ, setFilterQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setListError("");
    try {
      const list = await fetchWorldContentPlayerList({
        type: filterType || undefined,
        tags: parseTagList(filterTags),
        q: filterQ.trim() || undefined,
      });
      setItems(list);
    } catch (reason) {
      setListError(formatApiError(reason, safeError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <ArkenDialog
      open={open}
      footer={false}
      title="Энциклопедия"
      variant="workspace"
      className="world-encyclopedia-workspace"
      workspaceDraggable={false}
      onClose={onClose}
    >
      <div className="world-encyclopedia-workspace__grid">
        <section className="world-encyclopedia-workspace__list-pane">
          <div className="world-encyclopedia-workspace__filters">
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
          </div>
          {listError && (
            <p className="field-error" role="alert">
              {listError}
            </p>
          )}
          {loading ? (
            <p className="muted">Загрузка…</p>
          ) : items.length === 0 ? (
            <p className="muted">Ничего не найдено.</p>
          ) : (
            <ul className="world-encyclopedia-workspace__list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={
                      item.id === selectedId
                        ? "world-encyclopedia-workspace__row is-selected"
                        : "world-encyclopedia-workspace__row"
                    }
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className="world-encyclopedia-workspace__row-name">
                      {item.name}
                    </span>
                    <span className="world-encyclopedia-workspace__row-type">
                      {WORLD_CONTENT_TYPE_LABELS[item.type]}
                    </span>
                    {item.tags.length > 0 && (
                      <span className="world-encyclopedia-workspace__row-tags">
                        {item.tags.map((tag) => (
                          <span key={tag} className="chip">
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="world-encyclopedia-workspace__detail-pane">
          {selectedId ? (
            <EntityPage
              key={selectedId}
              id={selectedId}
              onNavigate={setSelectedId}
              onMissing={() => setSelectedId(null)}
            />
          ) : (
            <p className="muted">
              Выберите статью слева, чтобы прочитать её.
            </p>
          )}
        </section>
      </div>
    </ArkenDialog>
  );
});

function EntityPage({
  id,
  onNavigate,
  onMissing,
}: {
  id: string;
  onNavigate: (id: string) => void;
  onMissing: () => void;
}) {
  const [entity, setEntity] = useState<WorldContentPlayerDto | null>(null);
  const [media, setMedia] = useState<WorldContentMediaDto[]>([]);
  const [relations, setRelations] = useState<WorldContentRelationEdgeDto[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setEntity(null);
    setMedia([]);
    setRelations([]);
    (async () => {
      try {
        // A player must never reach a DRAFT/ARCHIVED entity's page, even by
        // guessing/constructing an id: the server 404s on all three of
        // these calls the same way the single-entity GET already does (see
        // `worldContentByIdVisibleTo` in `apps/server/src/world-content.ts`),
        // so a missing/hidden id surfaces here as an ApiError with
        // status 404, handled below — never a crash.
        const [detail, mediaList, relationEdges] = await Promise.all([
          fetchWorldContentPlayerDetail(id),
          fetchWorldContentMedia(id),
          fetchWorldContentRelations(id),
        ]);
        if (!active) return;
        setEntity(detail);
        setMedia(mediaList);
        setRelations(relationEdges);
      } catch (reason) {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 404) {
          setError(notFoundError);
          onMissing();
          return;
        }
        setError(formatApiError(reason, safeError));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <p className="muted">Загрузка…</p>;
  if (error)
    return (
      <p className="field-error" role="alert">
        {error}
      </p>
    );
  if (!entity) return null;

  return (
    <article className="world-encyclopedia-workspace__article">
      <header>
        <h2>{entity.name}</h2>
        <p className="muted">
          {WORLD_CONTENT_TYPE_LABELS[entity.type]}
          {entity.subtype ? ` · ${entity.subtype}` : ""}
        </p>
        {entity.aliases.length > 0 && (
          <p className="world-encyclopedia-workspace__aliases">
            Также известен(а) как: {entity.aliases.join(", ")}
          </p>
        )}
      </header>
      {entity.coverAssetId && (
        <img
          className="world-encyclopedia-workspace__cover"
          src={`/api/assets/${entity.coverAssetId}/content`}
          alt=""
        />
      )}
      {entity.summary && (
        <p className="world-encyclopedia-workspace__summary">
          {entity.summary}
        </p>
      )}
      {entity.publicText && (
        // No markdown renderer exists anywhere in this codebase yet (checked
        // for a reuse candidate near GM story notes / UIX-320 and found
        // none) — rendered as plain preformatted text with line breaks
        // preserved rather than pulling in a new markdown dependency for
        // this stage. See the stage report for the gap this leaves (raw
        // markdown syntax, e.g. `**bold**`, shows up literally).
        <pre className="world-encyclopedia-workspace__body">
          {entity.publicText}
        </pre>
      )}
      {entity.tags.length > 0 && (
        <p className="world-encyclopedia-workspace__tags">
          {entity.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </p>
      )}
      {media.length > 0 && (
        <section>
          <h3>Галерея</h3>
          <ul className="world-encyclopedia-workspace__media-grid">
            {media.map((item) => (
              <li key={item.id}>
                <img
                  src={`/api/assets/${item.assetId}/content`}
                  alt={item.caption ?? ""}
                />
                {item.caption && <p>{item.caption}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {relations.length > 0 && (
        <section>
          <h3>Связанные статьи</h3>
          <ul className="world-encyclopedia-workspace__relations">
            {relations.map((edge) => (
              <li key={edge.id}>
                <Button
                  size="s"
                  view="flat"
                  className="world-encyclopedia-workspace__relation-link"
                  onClick={() => onNavigate(edge.entity.id)}
                >
                  {WORLD_CONTENT_TYPE_LABELS[edge.entity.type]}: {edge.entity.name}
                </Button>
                <span className="muted"> ({edge.relationType})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
