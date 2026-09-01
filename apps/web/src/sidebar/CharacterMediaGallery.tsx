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

type RemovalTarget = {
  item: CharacterMediaDto;
  mode: "detach" | "hard-delete";
  characterId: string;
  actionId: string;
};

function assetUrl(assetId: string): string {
  return `/api/assets/${assetId}/content`;
}

/**
 * Owner-facing gallery for a single character sheet (UIX-292 Stage 3): an
 * ordered set of media entries alongside the existing single `portraitAssetId`.
 * The list endpoint already excludes GM_ONLY entries for a non-GM owner, so
 * no client-side visibility filtering happens here.
 *
 * Removal is explicit: an owner (or the GM) may detach an entry from the
 * character gallery, while the GM may additionally hard-delete the gallery
 * row. Neither operation deletes the source asset from the media library.
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
  const [removalTarget, setRemovalTarget] = useState<RemovalTarget | null>(
    null,
  );
  const activeCharacterIdRef = useRef(characterId);
  const loadRequestIdRef = useRef(0);
  const removalOperationRef = useRef<string | null>(null);

  const load = async (): Promise<boolean> => {
    const requestId = ++loadRequestIdRef.current;
    const requestedCharacterId = characterId;
    const isCurrentRequest = () =>
      requestId === loadRequestIdRef.current &&
      requestedCharacterId === activeCharacterIdRef.current;
    try {
      const list = await api<CharacterMediaDto[]>(
        `/api/characters/${characterId}/media`,
      );
      if (!isCurrentRequest()) return false;
      setItems(list);
      setError("");
      return true;
    } catch (reason) {
      if (!isCurrentRequest()) return false;
      setItems([]);
      setError(formatApiError(reason, "Не удалось загрузить галерею."));
      return false;
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  };

  useEffect(() => {
    activeCharacterIdRef.current = characterId;
    removalOperationRef.current = null;
    setLoading(true);
    setViewerId(null);
    setEditingId(null);
    setPendingId(null);
    setRemovalTarget(null);
    setItems([]);
    void load();
    return () => {
      loadRequestIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  const sorted = useMemo(
    () =>
      sortMediaByOrdering(
        items.filter((item) => item.characterId === characterId),
      ),
    [characterId, items],
  );
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
      if (reason instanceof ApiError && reason.status === 409) {
        const refreshed = await load();
        if (!refreshed) return;
      }
      setError(formatApiError(reason, "Не удалось изменить порядок."));
    } finally {
      setPendingId(null);
    }
  };

  const remove = async (target: RemovalTarget) => {
    if (removalOperationRef.current) return;
    removalOperationRef.current = target.actionId;
    setPendingId(target.item.id);
    setError("");
    const isCurrentOperation = () =>
      removalOperationRef.current === target.actionId &&
      activeCharacterIdRef.current === target.characterId;
    try {
      await api(
        target.mode === "detach"
          ? `/api/character-media/${target.item.id}/detach`
          : `/api/character-media/${target.item.id}`,
        {
          method: target.mode === "detach" ? "POST" : "DELETE",
          body: JSON.stringify({
            actionId: target.actionId,
            revision: target.item.revision,
          }),
        },
      );
      if (!isCurrentOperation()) return;
      setItems((current) =>
        current.filter((entry) => entry.id !== target.item.id),
      );
      setRemovalTarget(null);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        if (!isCurrentOperation()) return;
        setItems([]);
        setLoading(true);
        setRemovalTarget(null);
        const refreshed = await load();
        if (!refreshed) return;
        setError(
          "Запись уже изменена. Галерея обновлена — повторите действие.",
        );
      } else {
        if (!isCurrentOperation()) return;
        setError(
          formatApiError(
            reason,
            target.mode === "detach"
              ? "Не удалось убрать изображение из галереи."
              : "Не удалось удалить запись галереи.",
          ),
        );
      }
    } finally {
      if (removalOperationRef.current === target.actionId) {
        removalOperationRef.current = null;
        setPendingId(null);
      }
    }
  };

  const openRemovalDialog = (
    item: CharacterMediaDto,
    mode: RemovalTarget["mode"],
  ) => {
    if (pendingId !== null || removalOperationRef.current) return;
    setError("");
    setRemovalTarget({
      item,
      mode,
      characterId,
      actionId: crypto.randomUUID(),
    });
  };

  const closeRemovalDialog = () => {
    if (removalOperationRef.current) return;
    setRemovalTarget(null);
  };

  /*
   * GM-only hard delete (AC2/AC14) permanently removes the gallery entry
   * row rather than just hiding it. Never offered to the owner; the source
   * asset remains in the media library.
   */
  const hardDeleteDescription =
    "Запись будет безвозвратно удалена из галереи персонажа, но файл останется в медиатеке.";

  const detachDescription =
    "Изображение исчезнет из галереи персонажа, но исходный файл останется в медиатеке.";

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
                    disabled={pendingId !== null}
                    onClick={() => openRemovalDialog(item, "detach")}
                  >
                    Убрать из галереи
                  </Button>
                  {isGm && (
                    <Button
                      size="s"
                      view="flat-danger"
                      disabled={pendingId !== null}
                      title="Безвозвратно удаляет запись галереи (сам файл не удаляется). Недоступно владельцу."
                      onClick={() => openRemovalDialog(item, "hard-delete")}
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
      {removalTarget && (
        <ArkenDialog
          open
          title={
            removalTarget.mode === "detach"
              ? "Убрать изображение из галереи?"
              : "Удалить запись галереи навсегда?"
          }
          applyLabel={
            removalTarget.mode === "detach" ? "Убрать" : "Удалить навсегда"
          }
          danger
          loading={pendingId === removalTarget.item.id}
          error={error}
          onApply={() => void remove(removalTarget)}
          onClose={closeRemovalDialog}
        >
          <p className="arken-dialog-message">
            {removalTarget.mode === "detach"
              ? detachDescription
              : hardDeleteDescription}
          </p>
        </ArkenDialog>
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
