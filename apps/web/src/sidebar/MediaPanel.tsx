import { useMemo, useState } from "react";
import type { AssetKind, GameSnapshot } from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import { ImageUploadField } from "../ui/ImageUploadField";
import type { Props } from "../Sidebar";

export function MediaPanel({
  snapshot,
  onUpload,
}: {
  snapshot: GameSnapshot;
  onUpload: Props["onUpload"];
}) {
  const [drafts, setDrafts] = useState<Partial<Record<AssetKind, File>>>({});
  const [uploading, setUploading] = useState<AssetKind | null>(null);
  const [error, setError] = useState("");
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
        {snapshot.assets.map((asset) => (
          <div className="asset-row" key={asset.id}>
            {asset.kind !== "AUDIO" ? (
              <img className="asset-thumbnail" src={asset.url} alt="" />
            ) : (
              <span>{asset.kind}</span>
            )}
            <div>
              <strong>{asset.name}</strong>
              <small>{(asset.sizeBytes / 1024 / 1024).toFixed(1)} МБ</small>
            </div>
          </div>
        ))}
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
