import { useMemo, useState } from "react";
import type {
  AssetKind,
  AssetUsageResponseDto,
  GameSnapshot,
} from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import { ApiError, formatApiError } from "../api";
import { ImageUploadField } from "../ui/ImageUploadField";
import type { AssetActions } from "../use-asset-actions";

export function MediaPanel({
  snapshot,
  onUpload,
  onGetUsage,
  onDelete,
}: {
  snapshot: GameSnapshot;
  onUpload: AssetActions["uploadAsset"];
  onGetUsage: AssetActions["getAssetUsage"];
  onDelete: AssetActions["deleteAsset"];
}) {
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
  const upload = async (kind: AssetKind) => {
    const file = drafts[kind];
    if (!file) return;
    setUploading(kind);
    setError("");
    try {
      await onUpload(file, kind);
      setDrafts((current) => ({ ...current, [kind]: undefined }));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось загрузить файл.",
      );
    } finally {
      setUploading(null);
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
    if (!window.confirm(`Удалить файл «${assetName}» без возможности отмены?`))
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
      <div className="section-heading">
        <div>
          <span className="eyebrow">Хранилище</span>
          <h2>Файлы</h2>
        </div>
        <span className="revision">{snapshot.assets.length}</span>
      </div>
      <div className="upload-sections">
        {allowed.map((kind) => (
          <section className="upload-section" key={kind}>
            <ImageUploadField
              label={labels[kind]}
              value={drafts[kind]}
              accept={
                kind === "AUDIO"
                  ? ".mp3,.ogg,audio/mpeg,audio/ogg"
                  : ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              }
              hint={kind === "AUDIO" ? "MP3 или OGG" : "PNG, JPEG или WebP"}
              disabled={uploading !== null}
              onUpdate={(file) =>
                setDrafts((current) => ({ ...current, [kind]: file }))
              }
            />
            <Button
              view="action"
              disabled={!drafts[kind] || uploading !== null}
              loading={uploading === kind}
              onClick={() => void upload(kind)}
            >
              Загрузить
            </Button>
          </section>
        ))}
      </div>
      {error && <div className="field-error">{error}</div>}
      <div className="asset-list">
        {snapshot.assets.map((asset) => {
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
                <span aria-label="Аудиофайл">AUDIO</span>
              )}
              <div>
                <strong>{asset.name}</strong>
                <small>
                  {asset.kind} · {(asset.sizeBytes / 1024 / 1024).toFixed(1)} МБ
                </small>
                {snapshot.me.role === "GM" && (
                  <div>
                    <Button
                      loading={checkingAssetId === asset.id}
                      disabled={
                        checkingAssetId !== null || deletingAssetId !== null
                      }
                      onClick={() => void checkUsage(asset.id)}
                    >
                      {usage
                        ? "Обновить использование"
                        : "Проверить использование"}
                    </Button>
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
                            view="outlined-danger"
                            loading={deletingAssetId === asset.id}
                            disabled={deletingAssetId !== null}
                            onClick={() => void remove(asset.id, asset.name)}
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
