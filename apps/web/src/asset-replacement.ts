import type { AssetDto } from "@arken/contracts";
import { api, ApiError } from "./api";

export type AssetReplacementIntent = Readonly<{
  assetId: string;
  file: File;
  version: string;
  actionId: string;
}>;

export type AssetReplacementResult = {
  asset: AssetDto;
  version: string;
  replayed: boolean;
  oldBlobCleanupPending?: boolean;
};

/** Capture the reviewed version once. Never silently refresh it during commit. */
export async function prepareAssetReplacement(
  assetId: string,
  file: File,
  signal?: AbortSignal,
): Promise<AssetReplacementIntent> {
  let response: Response;
  try {
    response = await fetch(
      `/api/assets/${encodeURIComponent(assetId)}/content`,
      {
        method: "HEAD",
        credentials: "include",
        cache: "no-store",
        signal,
      },
    );
  } catch (reason) {
    if (
      signal?.aborted ||
      (reason instanceof Error && reason.name === "AbortError")
    )
      throw reason;
    throw new Error(
      "Не удалось проверить версию файла. Проверьте подключение и повторите попытку.",
      { cause: reason },
    );
  }
  // HEAD has no JSON error body. Do not render native/server diagnostic text.
  if (!response.ok) {
    const message =
      response.status === 401
        ? "Сессия завершена. Войдите снова."
        : response.status === 403
          ? "Нет доступа к этому файлу."
          : response.status === 404
            ? "Файл больше недоступен. Обновите медиатеку."
            : "Не удалось проверить версию файла. Повторите попытку.";
    throw new ApiError(response.status, "ASSET_VERSION_UNAVAILABLE", message);
  }
  const version = response.headers.get("etag");
  // Match the current strong, opaque server token; weak/missing versions cannot
  // safely authorize an overwrite. No storage key is exposed or inferred here.
  if (!version || !/^"[a-f0-9]{64}"$/.test(version)) {
    throw new Error(
      "Версия файла недоступна. Обновите медиатеку и повторите попытку.",
    );
  }
  if (signal?.aborted) throw signal.reason;
  return Object.freeze({
    assetId,
    file,
    version,
    actionId: crypto.randomUUID(),
  });
}

/** Explicit retries must reuse this intent; conflicts require a new review. */
export function commitAssetReplacement(
  intent: AssetReplacementIntent,
  signal?: AbortSignal,
): Promise<AssetReplacementResult> {
  const form = new FormData();
  form.append("file", intent.file);
  return api<AssetReplacementResult>(
    `/api/assets/${encodeURIComponent(intent.assetId)}/content`,
    {
      method: "PUT",
      headers: { "if-match": intent.version, "x-action-id": intent.actionId },
      body: form,
      signal,
    },
  );
}
