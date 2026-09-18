import { useEffect, useRef, useState } from "react";
import { Button } from "@gravity-ui/uikit";
import type { AssetDto, AssetUsageResponseDto } from "@arken/contracts";
import { ApiError, formatApiError } from "../api";
import {
  prepareAssetReplacement,
  type AssetReplacementIntent,
  type AssetReplacementResult,
} from "../asset-replacement";
import { ArkenDialog } from "../ui/ArkenDialog";
import { ImageUploadField } from "../ui/ImageUploadField";
import { AudioUploadField } from "../ui/AudioUploadField";

export function AssetReplacementDialog({
  asset,
  onGetUsage,
  onReplace,
  onRefresh,
  onClose,
}: {
  asset: AssetDto;
  onGetUsage: (id: string) => Promise<AssetUsageResponseDto>;
  onReplace: (
    intent: AssetReplacementIntent,
  ) => Promise<AssetReplacementResult>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [intent, setIntent] = useState<AssetReplacementIntent>();
  const [usage, setUsage] = useState<AssetUsageResponseDto>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AssetReplacementResult>();
  const [refreshError, setRefreshError] = useState(false);
  const live = useRef(true);
  const preparation = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      preparation.current?.abort();
    };
  }, []);
  const review = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    preparation.current = controller;
    try {
      const [next, places] = await Promise.all([
        prepareAssetReplacement(asset.id, file, controller.signal),
        onGetUsage(asset.id),
      ]);
      if (!live.current) return;
      setIntent(next);
      setUsage(places);
    } catch (reason) {
      if (live.current)
        setError(formatApiError(reason, "Не удалось проверить файл."));
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const replace = async () => {
    if (!intent || busy) return;
    setBusy(true);
    setError("");
    try {
      const committed = await onReplace(intent);
      if (!live.current) return;
      setResult(committed);
      setIntent(undefined);
      // Commit is already acknowledged. A refresh failure must not offer PUT again.
      try {
        await onRefresh();
      } catch {
        if (live.current) setRefreshError(true);
      }
    } catch (reason) {
      if (!live.current) return;
      if (
        reason instanceof ApiError &&
        reason.code === "ASSET_VERSION_CONFLICT"
      ) {
        setIntent(undefined);
        setUsage(undefined);
        setError(
          "Файл уже изменён. Проверьте использование ещё раз перед новой заменой.",
        );
      } else
        setError(
          formatApiError(
            reason,
            "Не удалось подтвердить замену. Повторите ту же попытку.",
          ),
        );
    } finally {
      if (live.current) setBusy(false);
    }
  };
  return (
    <ArkenDialog
      open
      title={`Заменить файл «${asset.name}»`}
      footer={false}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="panel-section" aria-busy={busy}>
        {result ? (
          <div role="status">
            <p>Файл заменён. Существующие ссылки сохранены.</p>
            {result.oldBlobCleanupPending && (
              <p>
                Очистка старой копии на сервере ещё не завершена. Повторять
                замену не нужно.
              </p>
            )}
            {refreshError && (
              <p>
                Не удалось обновить каталог. Обновите страницу; файл уже
                заменён.
              </p>
            )}
          </div>
        ) : (
          <>
            <p>
              Название и ссылки останутся прежними. Новое содержимое появится во
              всех местах использования. Отменить замену здесь нельзя.
            </p>
            {asset.kind === "AUDIO" ? (
              <AudioUploadField
                label="Новый аудиофайл"
                value={file}
                disabled={busy || Boolean(intent)}
                onUpdate={setFile}
                hint="MP3 или OGG"
              />
            ) : (
              <ImageUploadField
                label="Новое изображение"
                value={file}
                disabled={busy || Boolean(intent)}
                onUpdate={setFile}
                hint="PNG, JPEG или WebP"
              />
            )}
            {usage && (
              <section aria-label="Места использования заменяемого файла">
                <p>
                  {usage.inUse
                    ? `Используется: ${usage.usages.length}`
                    : "Файл пока не используется."}
                </p>
                <ul>
                  {usage.usages.map((item) => (
                    <li key={`${item.kind}:${item.entityId}`}>
                      {item.label} · {item.location}
                    </li>
                  ))}
                </ul>
                {usage.hiddenUsageCount > 0 && (
                  <p>
                    Также используется в недоступных для просмотра местах:{" "}
                    {usage.hiddenUsageCount}.
                  </p>
                )}
              </section>
            )}
          </>
        )}
        {error && (
          <div className="field-error" role="alert">
            {error}
          </div>
        )}
        <div className="inline-fields">
          <Button disabled={busy} onClick={onClose}>
            {result ? "Закрыть" : "Отмена"}
          </Button>
          {!result &&
            (intent ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setIntent(undefined);
                    setUsage(undefined);
                    setError("");
                  }}
                >
                  Изменить выбор
                </Button>
                <Button
                  view="action"
                  loading={busy}
                  disabled={busy}
                  onClick={() => void replace()}
                >
                  {error ? "Повторить замену" : "Подтвердить замену"}
                </Button>
              </>
            ) : (
              <Button
                view="action"
                loading={busy}
                disabled={!file || busy}
                onClick={() => void review()}
              >
                Проверить замену
              </Button>
            ))}
        </div>
      </div>
    </ArkenDialog>
  );
}
