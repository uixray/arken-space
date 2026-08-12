import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CharacterMediaCategory,
  CharacterMediaDto,
  CharacterMediaVisibility,
} from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import { api, ApiError, formatApiError } from "../api";
import { ArkenDialog } from "../ui/ArkenDialog";
import { ImageUploadField } from "../ui/ImageUploadField";
import { FormSelect, FormTextArea } from "../ui/GravityFormControls";
import {
  CHARACTER_MEDIA_CATEGORY_LABELS,
  CHARACTER_MEDIA_VISIBILITY_LABELS,
  computeAdjacentSwap,
  sortMediaByOrdering,
  stepViewerItem,
} from "../character-media-gallery-state";
import type { AssetActions } from "../use-asset-actions";

const CATEGORY_OPTIONS = Object.keys(
  CHARACTER_MEDIA_CATEGORY_LABELS,
) as CharacterMediaCategory[];

function assetUrl(assetId: string): string {
  return `/api/assets/${assetId}/content`;
}

/**
 * Owner-facing gallery for a single character sheet (UIX-292 Stage 3): an
 * ordered set of media entries alongside the existing single `portraitAssetId`.
 * The list endpoint already excludes GM_ONLY entries for a non-GM owner, so
 * no client-side visibility filtering happens here.
 *
 * This component deliberately does NOT expose GM-only hard delete
 * (DELETE /api/character-media/:id) — that belongs to the GM
 * cross-character inspection UI (UIX-292 Stage 4), out of scope here. The
 * only removal action offered is `detach` ("remove from gallery"), a soft,
 * non-destructive removal available to the owner (and the GM).
 */
export function CharacterMediaGallery({
  characterId,
  characterName,
  editable,
  isGm,
  onUpload,
}: {
  characterId: string;
  characterName: string;
  editable: boolean;
  isGm: boolean;
  onUpload: AssetActions["uploadAsset"];
}) {
  const [items, setItems] = useState<CharacterMediaDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = async () => {
    try {
      const list = await api<CharacterMediaDto[]>(
        `/api/characters/${characterId}/media`,
      );
      setItems(list);
      setError("");
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось загрузить галерею."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  const sorted = useMemo(() => sortMediaByOrdering(items), [items]);
  const viewerItem = sorted.find((item) => item.id === viewerId) ?? null;

  const reorder = async (id: string, direction: "up" | "down") => {
    const swap = computeAdjacentSwap(items, id, direction);
    if (!swap) return;
    setPendingId(id);
    setError("");
    try {
      for (const move of swap) {
        const updated = await api<CharacterMediaDto>(
          `/api/character-media/${move.id}/reorder`,
          {
            method: "POST",
            body: JSON.stringify({
              actionId: crypto.randomUUID(),
              revision: move.revision,
              ordering: move.ordering,
            }),
          },
        );
        setItems((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        );
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) await load();
      setError(formatApiError(reason, "Не удалось изменить порядок."));
    } finally {
      setPendingId(null);
    }
  };

  const detach = async (item: CharacterMediaDto) => {
    setPendingId(item.id);
    setError("");
    try {
      await api(`/api/character-media/${item.id}/detach`, {
        method: "POST",
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          revision: item.revision,
        }),
      });
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) await load();
      setError(
        formatApiError(reason, "Не удалось убрать изображение из галереи."),
      );
    } finally {
      setPendingId(null);
    }
  };

  /**
   * GM-only hard delete (AC2/AC14): permanently removes the gallery entry
   * row rather than just hiding it. Never offered to the owner.
   */
  const hardDelete = async (item: CharacterMediaDto) => {
    setPendingId(item.id);
    setError("");
    try {
      await api(`/api/character-media/${item.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          revision: item.revision,
        }),
      });
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) await load();
      setError(formatApiError(reason, "Не удалось удалить запись галереи."));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="character-media-gallery">
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted">Загрузка галереи…</p>
      ) : sorted.length === 0 ? (
        <p className="muted">В галерее пока нет изображений.</p>
      ) : (
        <ul className="character-media-gallery__grid">
          {sorted.map((item, index) => (
            <li className="character-media-gallery__item" key={item.id}>
              <button
                type="button"
                className="character-media-gallery__thumb"
                onClick={() => setViewerId(item.id)}
                aria-label={`Открыть в полном размере: ${
                  item.caption || CHARACTER_MEDIA_CATEGORY_LABELS[item.category]
                }`}
              >
                <GalleryImage assetId={item.assetId} alt={item.caption ?? ""} />
              </button>
              <div className="character-media-gallery__meta">
                <span className="character-media-gallery__category">
                  {CHARACTER_MEDIA_CATEGORY_LABELS[item.category]}
                </span>
                {item.caption && <p>{item.caption}</p>}
              </div>
              {editable && (
                <div className="character-media-gallery__actions">
                  <Button
                    size="s"
                    disabled={index === 0 || pendingId === item.id}
                    aria-label="Переместить выше"
                    title="Переместить выше"
                    onClick={() => void reorder(item.id, "up")}
                  >
                    ↑
                  </Button>
                  <Button
                    size="s"
                    disabled={
                      index === sorted.length - 1 || pendingId === item.id
                    }
                    aria-label="Переместить ниже"
                    title="Переместить ниже"
                    onClick={() => void reorder(item.id, "down")}
                  >
                    ↓
                  </Button>
                  <Button
                    size="s"
                    disabled={pendingId === item.id}
                    onClick={() => setEditingId(item.id)}
                  >
                    Изменить
                  </Button>
                  <Button
                    size="s"
                    view="flat-danger"
                    disabled={pendingId === item.id}
                    onClick={() => void detach(item)}
                  >
                    Убрать из галереи
                  </Button>
                  {isGm && (
                    <Button
                      size="s"
                      view="flat-danger"
                      disabled={pendingId === item.id}
                      title="Безвозвратно удаляет запись галереи (сам файл не удаляется). Недоступно владельцу."
                      onClick={() => void hardDelete(item)}
                    >
                      Удалить навсегда
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <AttachMediaForm
          characterId={characterId}
          isGm={isGm}
          onUpload={onUpload}
          onAttached={(created) => setItems((current) => [...current, created])}
        />
      )}
      {viewerItem && (
        <MediaViewer
          item={viewerItem}
          characterName={characterName}
          items={sorted}
          onNavigate={(id) => setViewerId(id)}
          onClose={() => setViewerId(null)}
        />
      )}
      {editingId && (
        <EditMediaDialog
          item={sorted.find((item) => item.id === editingId) ?? null}
          isGm={isGm}
          onClose={() => setEditingId(null)}
          onSaved={(updated) => {
            setItems((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
            setEditingId(null);
          }}
          onConflict={() => void load()}
        />
      )}
    </div>
  );
}

function GalleryImage({ assetId, alt }: { assetId: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span
        className="character-media-gallery__broken"
        role="img"
        aria-label="Изображение недоступно"
      >
        Изображение недоступно
      </span>
    );
  return (
    <img src={assetUrl(assetId)} alt={alt} onError={() => setFailed(true)} />
  );
}

/** Attach flow: reuses the same file-picker upload pattern as the portrait field, then attaches the resulting asset. */
function AttachMediaForm({
  characterId,
  isGm,
  onUpload,
  onAttached,
}: {
  characterId: string;
  isGm: boolean;
  onUpload: AssetActions["uploadAsset"];
  onAttached: (created: CharacterMediaDto) => void;
}) {
  const [file, setFile] = useState<File>();
  const [category, setCategory] =
    useState<CharacterMediaCategory>("CHARACTER_ART");
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] =
    useState<CharacterMediaVisibility>("OWNER_GM");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const visibilityOptions: CharacterMediaVisibility[] = isGm
    ? ["OWNER_GM", "PARTY", "GM_ONLY"]
    : ["OWNER_GM", "PARTY"];

  const attach = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      // Players may only upload TOKEN/PORTRAIT-kind assets (see the role
      // check on POST /api/assets in routes.ts); PORTRAIT is reused here for
      // gallery images so this works for both players and the GM.
      const asset = await onUpload(file, "PORTRAIT");
      const created = await api<CharacterMediaDto>(
        `/api/characters/${characterId}/media`,
        {
          method: "POST",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            characterId,
            assetId: asset.id,
            category,
            caption: caption.trim() || null,
            visibility,
          }),
        },
      );
      onAttached(created);
      setFile(undefined);
      setCaption("");
    } catch (reason) {
      setError(
        formatApiError(reason, "Не удалось добавить изображение в галерею."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="character-media-gallery__attach subsection">
      <h3>Добавить в галерею</h3>
      <ImageUploadField
        label="Изображение для галереи"
        value={file}
        disabled={busy}
        onUpdate={setFile}
      />
      <label className="field">
        Категория
        <FormSelect
          value={category}
          disabled={busy}
          onChange={(event) =>
            setCategory(event.target.value as CharacterMediaCategory)
          }
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {CHARACTER_MEDIA_CATEGORY_LABELS[option]}
            </option>
          ))}
        </FormSelect>
      </label>
      <label className="field">
        Подпись (необязательно)
        <FormTextArea
          value={caption}
          disabled={busy}
          rows={2}
          onChange={(event) => setCaption(event.target.value)}
        />
      </label>
      <label className="field">
        Видимость
        <FormSelect
          value={visibility}
          disabled={busy}
          onChange={(event) =>
            setVisibility(event.target.value as CharacterMediaVisibility)
          }
        >
          {visibilityOptions.map((option) => (
            <option key={option} value={option}>
              {CHARACTER_MEDIA_VISIBILITY_LABELS[option]}
            </option>
          ))}
        </FormSelect>
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <Button
        disabled={!file || busy}
        loading={busy}
        onClick={() => void attach()}
      >
        Добавить в галерею
      </Button>
    </div>
  );
}

function EditMediaDialog({
  item,
  isGm,
  onClose,
  onSaved,
  onConflict,
}: {
  item: CharacterMediaDto | null;
  isGm: boolean;
  onClose: () => void;
  onSaved: (updated: CharacterMediaDto) => void;
  onConflict: () => void;
}) {
  const [category, setCategory] = useState<CharacterMediaCategory>(
    item?.category ?? "OTHER",
  );
  const [caption, setCaption] = useState(item?.caption ?? "");
  const [visibility, setVisibility] = useState<CharacterMediaVisibility>(
    item?.visibility ?? "OWNER_GM",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!item) return;
    setCategory(item.category);
    setCaption(item.caption ?? "");
    setVisibility(item.visibility);
    setError("");
  }, [item]);

  const visibilityOptions: CharacterMediaVisibility[] = isGm
    ? ["OWNER_GM", "PARTY", "GM_ONLY"]
    : ["OWNER_GM", "PARTY"];

  const save = async () => {
    if (!item) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<CharacterMediaDto>(
        `/api/character-media/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            revision: item.revision,
            category,
            caption: caption.trim() || null,
            visibility,
          }),
        },
      );
      onSaved(updated);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        onConflict();
        setError(
          "Запись уже изменена в другой сессии. Данные обновлены — откройте редактирование заново.",
        );
        return;
      }
      setError(formatApiError(reason, "Не удалось сохранить изменения."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ArkenDialog
      open={Boolean(item)}
      title="Изменить запись галереи"
      applyLabel="Сохранить"
      loading={busy}
      error={error}
      onApply={() => void save()}
      onClose={onClose}
    >
      <label className="field">
        Категория
        <FormSelect
          value={category}
          disabled={busy}
          onChange={(event) =>
            setCategory(event.target.value as CharacterMediaCategory)
          }
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {CHARACTER_MEDIA_CATEGORY_LABELS[option]}
            </option>
          ))}
        </FormSelect>
      </label>
      <label className="field">
        Подпись
        <FormTextArea
          value={caption}
          disabled={busy}
          rows={3}
          onChange={(event) => setCaption(event.target.value)}
        />
      </label>
      <label className="field">
        Видимость
        <FormSelect
          value={visibility}
          disabled={busy}
          onChange={(event) =>
            setVisibility(event.target.value as CharacterMediaVisibility)
          }
        >
          {visibilityOptions.map((option) => (
            <option key={option} value={option}>
              {CHARACTER_MEDIA_VISIBILITY_LABELS[option]}
            </option>
          ))}
        </FormSelect>
      </label>
    </ArkenDialog>
  );
}

/**
 * Full-size, keyboard-accessible viewer. Mirrors the accessible-viewer intent
 * of the operator-feedback attachment viewer (Escape-dismissable, accessible
 * labels, graceful handling of a broken image) but renders assets directly
 * via their authenticated `/api/assets/:id/content` URL — the same pattern
 * already used for the character portrait — rather than fetching a blob.
 */
function MediaViewer({
  item,
  characterName,
  items,
  onNavigate,
  onClose,
}: {
  item: CharacterMediaDto;
  characterName: string;
  items: CharacterMediaDto[];
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFailed(false);
  }, [item.id]);

  useEffect(() => {
    containerRef.current?.focus();
  }, [item.id]);

  return (
    <ArkenDialog
      open
      footer={false}
      title={`${characterName}: ${CHARACTER_MEDIA_CATEGORY_LABELS[item.category]}`}
      onClose={onClose}
    >
      <div
        ref={containerRef}
        className="character-media-viewer"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            const next = stepViewerItem(items, item.id, 1);
            if (next) onNavigate(next);
          } else if (event.key === "ArrowLeft") {
            const previous = stepViewerItem(items, item.id, -1);
            if (previous) onNavigate(previous);
          }
        }}
      >
        {failed ? (
          <div
            className="character-media-viewer__broken"
            role="img"
            aria-label="Изображение недоступно"
          >
            Изображение недоступно
          </div>
        ) : (
          <img
            src={assetUrl(item.assetId)}
            alt={
              item.caption ||
              `${characterName}: ${CHARACTER_MEDIA_CATEGORY_LABELS[item.category]}`
            }
            onError={() => setFailed(true)}
          />
        )}
        {item.caption && (
          <p className="character-media-viewer__caption">{item.caption}</p>
        )}
        {items.length > 1 && (
          <div className="character-media-viewer__nav">
            <Button
              aria-label="Предыдущее изображение"
              onClick={() => {
                const previous = stepViewerItem(items, item.id, -1);
                if (previous) onNavigate(previous);
              }}
            >
              ← Назад
            </Button>
            <Button
              aria-label="Следующее изображение"
              onClick={() => {
                const next = stepViewerItem(items, item.id, 1);
                if (next) onNavigate(next);
              }}
            >
              Далее →
            </Button>
          </div>
        )}
      </div>
    </ArkenDialog>
  );
}
