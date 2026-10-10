import { AssetReplacementDialog } from "./AssetReplacementDialog";
import { AssetAudioPreview } from "./AssetAudioPreview";
import { useId, useMemo, useState } from "react";
import type {
  AudioPurpose,
  AssetKind,
  AssetUsageResponseDto,
  GameSnapshot,
} from "@arken/contracts";
import { Button } from "../design-system/Button";
import { ApiError, formatApiError } from "../api";
import { ASSET_KIND_LABELS } from "../asset-labels";
import { api } from "../api";
import { ImageUploadField } from "../ui/ImageUploadField";
import { AudioUploadField } from "../ui/AudioUploadField";
import type { AssetActions } from "../use-asset-actions";
import { StickerPackManager } from "../StickerPackManager";
import { GlobalStickerPackManager } from "../GlobalStickerPackManager";

export function MediaPanel({
  snapshot,
  onUpload,
  onGetUsage,
  onDelete,
  onReplace,
  onRefresh,
}: {
  snapshot: GameSnapshot;
  onUpload: AssetActions["uploadAsset"];
  onGetUsage: AssetActions["getAssetUsage"];
  onDelete: AssetActions["deleteAsset"];
  onReplace?: AssetActions["replaceAsset"];
  onRefresh?: AssetActions["refreshAssets"];
}) {
  const uploadStatusPrefix = useId();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<AssetKind | "ALL">("ALL");
  const [audioPurposeFilter, setAudioPurposeFilter] = useState<"ALL" | "MUSIC" | "SOUND_EFFECT">("ALL");
  const [audioUploadPurpose, setAudioUploadPurpose] = useState<AudioPurpose | "">("");
  const [updatingAudioPurposeId, setUpdatingAudioPurposeId] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const replacement = snapshot.assets.find(
    (asset) => asset.id === replacementId,
  );
  const [drafts, setDrafts] = useState<Partial<Record<AssetKind, File>>>({});
  const [uploading, setUploading] = useState<AssetKind | null>(null);
  const [error, setError] = useState("");
  const [usageByAsset, setUsageByAsset] = useState<
    Record<string, AssetUsageResponseDto>
  >({});
  const [checkingAssetId, setCheckingAssetId] = useState<string | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const allowed = useMemo<AssetKind[]>(
    () =>
      snapshot.me.role === "GM"
        ? ["MAP", "TOKEN", "PORTRAIT", "IMAGE", "AUDIO"]
        : ["TOKEN", "PORTRAIT"],
    [snapshot.me.role],
  );
  const labels: Record<AssetKind, string> = {
    MAP: "Карты",
    TOKEN: "Изображения токенов",
    PORTRAIT: "Портреты персонажей",
    IMAGE: "Другие изображения",
    AUDIO: "Музыка и звуки",
  };
  const uploadPurposes: Record<AssetKind, string> = {
    MAP: "Для карт и фонов сцен кампании.",
    TOKEN: "Для изображений игровых токенов.",
    PORTRAIT: "Для портретов персонажей.",
    IMAGE: "Для изображений в других разделах кампании.",
    AUDIO: "Для музыкальных дорожек и звуков кампании.",
  };
  const kindOrder: AssetKind[] = ["MAP", "TOKEN", "PORTRAIT", "IMAGE", "AUDIO"];
  const visibleKinds = kindOrder.filter((kind) =>
    snapshot.assets.some((asset) => asset.kind === kind),
  );
  const filteredKinds =
    kindFilter === "ALL"
      ? visibleKinds
      : kindOrder.filter((kind) => kind === kindFilter);
  const upload = async (kind: AssetKind) => {
    const file = drafts[kind];
    if (!file) return;
    if (kind === "AUDIO" && !audioUploadPurpose) return;
    setUploading(kind);
    setError("");
    try {
      await onUpload(
        file,
        kind,
        kind === "AUDIO" ? { audioPurpose: audioUploadPurpose as AudioPurpose } : undefined,
      );
      setDrafts((current) => ({ ...current, [kind]: undefined }));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось загрузить файл.",
      );
    } finally {
      setUploading(null);
    }
  };
  const changeAudioPurpose = async (assetId: string, audioPurpose: AudioPurpose) => {
    if (!onRefresh) return;
    setUpdatingAudioPurposeId(assetId);
    setError("");
    try {
      await api(`/api/assets/${assetId}/audio-purpose`, {
        method: "PATCH",
        body: JSON.stringify({ actionId: crypto.randomUUID(), audioPurpose }),
      });
      await onRefresh();
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось изменить назначение аудио."));
    } finally {
      setUpdatingAudioPurposeId(null);
    }
  };
  const checkUsage = async (assetId: string, clearError = true) => {
    setCheckingAssetId(assetId);
    if (clearError) setError("");
    try {
      const usage = await onGetUsage(assetId);
      setUsageByAsset((current) => ({ ...current, [assetId]: usage }));
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось проверить использование."));
    } finally {
      setCheckingAssetId(null);
    }
  };
  const remove = async (assetId: string, assetName: string) => {
    const usage = usageByAsset[assetId];
    const worldContentCount = usage?.usages.filter((item) =>
      item.kind === "WORLD_CONTENT_COVER" || item.kind === "WORLD_CONTENT_MEDIA",
    ).length ?? 0;
    const publishedMapCount = usage?.usages.filter((item) => item.kind === "WORLD_MAP_BACKGROUND").length ?? 0;
    const confirmation = usage?.inUse
      ? `Отвязать ${usage.usages.length} связей и удалить файл «${assetName}» без возможности отмены? Материалы мира сохранятся; их обложки и файлы будут отвязаны.${worldContentCount ? ` Материалов мира: ${worldContentCount}.` : ""}${publishedMapCount ? ` Опубликованные карты: ${publishedMapCount} — станут черновиками.` : ""}`
      : `Удалить файл «${assetName}» без возможности отмены?`;
    if (!window.confirm(confirmation))
      return;
    setDeletingAssetId(assetId);
    setError("");
    try {
      await onDelete(assetId);
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось удалить файл."));
      if (reason instanceof ApiError && reason.code === "ASSET_IN_USE")
        await checkUsage(assetId, false).catch(() => undefined);
    } finally {
      setDeletingAssetId(null);
    }
  };
  return (
    <section className="panel-section">
      {replacement && snapshot.me.role === "GM" && onReplace && onRefresh && (
        <AssetReplacementDialog
          key={`${snapshot.campaign.id}:${snapshot.me.id}:${replacement.id}`}
          asset={replacement}
          onGetUsage={onGetUsage}
          onReplace={onReplace}
          onRefresh={onRefresh}
          onClose={() => setReplacementId(null)}
        />
      )}
      <div className="section-heading">
        <div>
          <span className="eyebrow">Хранилище</span>
          <h2>Файлы</h2>
        </div>
        <span className="revision">{snapshot.assets.length}</span>
      </div>
      <div className="upload-sections">
        {allowed.map((kind) => {
          const statusId = `${uploadStatusPrefix}-${kind.toLowerCase()}`;
          const status =
            uploading === kind
              ? "Файл загружается."
              : uploading !== null
                ? "Дождитесь завершения другой загрузки."
                : drafts[kind]
                  ? "Файл готов к загрузке."
                  : "Сначала выберите файл.";
          return (
            <section className="upload-section" key={kind}>
              {kind === "AUDIO" ? (
                <>
                  <label>
                    Назначение аудиофайла
                    <select
                      aria-label="Назначение аудиофайла"
                      value={audioUploadPurpose}
                      disabled={uploading !== null}
                      onChange={(event) =>
                        setAudioUploadPurpose(event.currentTarget.value as AudioPurpose | "")
                      }
                    >
                      <option value="">Выберите назначение</option>
                      <option value="MUSIC">Фоновая музыка</option>
                      <option value="SOUND_EFFECT">Звуковые эффекты</option>
                      <option value="BOTH">Музыка и звуковые эффекты</option>
                    </select>
                  </label>
                  <AudioUploadField
                    label={labels[kind]}
                    value={drafts[kind]}
                    hint="MP3 или OGG"
                    disabled={uploading !== null}
                    onUpdate={(file) =>
                      setDrafts((current) => ({ ...current, [kind]: file }))
                    }
                  />
                </>
              ) : (
                <ImageUploadField
                  label={labels[kind]}
                  value={drafts[kind]}
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  hint="PNG, JPEG или WebP"
                  disabled={uploading !== null}
                  onUpdate={(file) =>
                    setDrafts((current) => ({ ...current, [kind]: file }))
                  }
                />
              )}
              <p className="muted">
                {uploadPurposes[kind]} Загрузка не прикрепляет файл
                автоматически.
              </p>
              <Button
                view="action"
                disabled={!drafts[kind] || uploading !== null || (kind === "AUDIO" && !audioUploadPurpose)}
                loading={uploading === kind}
                aria-describedby={statusId}
                onClick={() => void upload(kind)}
              >
                Загрузить
              </Button>
              <p className="muted" id={statusId}>
                {status}
              </p>
            </section>
          );
        })}
      </div>
      {snapshot.me.role === "GM" && (
        <>
          <StickerPackManager snapshot={snapshot} />
          <GlobalStickerPackManager />
        </>
      )}
      {error && <div className="field-error">{error}</div>}
      <label>
        Тип файлов
        <select
          aria-label="Фильтр файлов по типу"
          value={kindFilter}
          onChange={(event) =>
            setKindFilter(event.currentTarget.value as AssetKind | "ALL")
          }
        >
          <option value="ALL">Все типы</option>
          {kindOrder.map((kind) => (
            <option key={kind} value={kind}>
              {labels[kind]}
            </option>
          ))}
        </select>
      </label>
      {(kindFilter === "ALL" || kindFilter === "AUDIO") &&
        snapshot.assets.some((asset) => asset.kind === "AUDIO") && (
          <label>
            Аудио по назначению
            <select
              aria-label="Фильтр аудио по назначению"
              value={audioPurposeFilter}
              onChange={(event) =>
                setAudioPurposeFilter(event.currentTarget.value as typeof audioPurposeFilter)
              }
            >
              <option value="ALL">Фоновая музыка и звуковые эффекты</option>
              <option value="MUSIC">Фоновая музыка</option>
              <option value="SOUND_EFFECT">Звуковые эффекты</option>
            </select>
          </label>
        )}
      <div className="asset-list">
        {snapshot.assets.length === 0 ||
        (kindFilter !== "ALL" &&
          !snapshot.assets.some((asset) => asset.kind === kindFilter)) ? (
          <p className="muted">
            {kindFilter === "ALL"
              ? "Файлов пока нет."
              : `Нет файлов типа «${labels[kindFilter]}».`}
          </p>
        ) : (
          filteredKinds.map((kind) => {
            const assets = snapshot.assets.filter(
              (asset) => asset.kind === kind,
            );
            if (assets.length === 0) return null;
            const audioGroups = kind === "AUDIO"
              ? ([
                  { key: "MUSIC", label: "Фоновая музыка", includes: (purpose: AudioPurpose) => purpose !== "SOUND_EFFECT" },
                  { key: "SOUND_EFFECT", label: "Звуковые эффекты", includes: (purpose: AudioPurpose) => purpose !== "MUSIC" },
                ] as const).filter((group) => audioPurposeFilter === "ALL" || group.key === audioPurposeFilter)
              : null;
            const groups = audioGroups
              ? audioGroups.map((group) => ({
                  key: group.key,
                  label: group.label,
                  assets: assets.filter((asset) => group.includes(asset.audioPurpose ?? "MUSIC")),
                }))
              : [{ key: kind, label: labels[kind], assets }];
            return groups.map((group) => group.assets.length === 0 ? null : (
              <section aria-label={`Файлы: ${group.label}`} key={`${kind}:${group.key}`}>
                <h3>
                  {group.label}{" "}
                  <span className="revision">{group.assets.length}</span>
                </h3>
                {group.assets.map((asset) => {
                  const usage = usageByAsset[asset.id];
                  return (
                    <div className="asset-row" key={asset.id}>
                      {asset.kind !== "AUDIO" ? (
                        <img
                          className="asset-thumbnail"
                          src={asset.url}
                          alt={`Превью: ${asset.name}`}
                        />
                      ) : (
                        <span aria-label={ASSET_KIND_LABELS.AUDIO}>
                          {ASSET_KIND_LABELS.AUDIO}
                        </span>
                      )}
                      <div>
                        <strong>{asset.name}</strong>
                        <small>
                          {asset.kind === "AUDIO" ? group.label : ASSET_KIND_LABELS[asset.kind]} ·{" "}
                          {(asset.sizeBytes / 1024 / 1024).toFixed(1)} МБ
                        </small>
                        {asset.kind === "AUDIO" && (
                          <>
                            {snapshot.me.role === "GM" && (
                              <label>
                                Назначение аудио
                                <select
                                  aria-label={`Назначение аудио: ${asset.name}`}
                                  value={asset.audioPurpose ?? "MUSIC"}
                                  disabled={!onRefresh || updatingAudioPurposeId !== null}
                                  onChange={(event) =>
                                    void changeAudioPurpose(asset.id, event.currentTarget.value as AudioPurpose)
                                  }
                                >
                                  <option value="MUSIC">Фоновая музыка</option>
                                  <option value="SOUND_EFFECT">Звуковые эффекты</option>
                                  <option value="BOTH">Музыка и звуковые эффекты</option>
                                </select>
                              </label>
                            )}
                            <Button
                              aria-expanded={previewId === asset.id}
                              onClick={() =>
                                setPreviewId(
                                  previewId === asset.id ? null : asset.id,
                                )
                              }
                            >
                              {previewId === asset.id
                                ? "Закрыть превью"
                                : "Прослушать"}
                            </Button>
                            {previewId === asset.id && (
                              <AssetAudioPreview
                                key={`${snapshot.campaign.id}:${snapshot.me.id}:${asset.url}`}
                                url={asset.url}
                                name={asset.name}
                              />
                            )}
                          </>
                        )}
                        {snapshot.me.role === "GM" && (
                          <div>
                            <Button
                              loading={checkingAssetId === asset.id}
                              disabled={
                                checkingAssetId !== null ||
                                deletingAssetId !== null
                              }
                              onClick={() => void checkUsage(asset.id)}
                            >
                              {usage
                                ? "Обновить использование"
                                : "Проверить использование"}
                            </Button>
                            {onReplace && onRefresh && (
                              <Button
                                disabled={
                                  checkingAssetId !== null ||
                                  deletingAssetId !== null ||
                                  uploading !== null
                                }
                                onClick={() => setReplacementId(asset.id)}
                              >
                                Заменить файл
                              </Button>
                            )}
                            {usage && (
                              <div aria-live="polite">
                                <small>
                                  {usage.inUse
                                    ? `Используется: ${usage.usages.length}`
                                    : "Не используется"}
                                </small>
                                {usage.usages.length > 0 && (
                                  <ul>
                                    {usage.usages.map((item) => (
                                      <li key={`${item.kind}:${item.entityId}`}>
                                        {item.label} · {item.location}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {usage.canDelete ? (
                                  <Button
                                    view="flat-danger"
                                    loading={deletingAssetId === asset.id}
                                    disabled={deletingAssetId !== null}
                                    onClick={() =>
                                      void remove(asset.id, asset.name)
                                    }
                                  >
                                    Удалить файл
                                  </Button>
                                ) : (
                                  <small>
                                    Удаление заблокировано: файл используется.
                                  </small>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>
            ));
          })
        )}
      </div>
    </section>
  );
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
