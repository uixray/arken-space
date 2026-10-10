import { useEffect, useRef, useState } from "react";
import { ApiError, api, formatApiError } from "./api";
import { Button } from "./design-system/Button";

interface GlobalPackRow {
  id: string;
  name: string;
  lifecycle: "DRAFT" | "ACTIVE" | "DEPRECATED";
  revision: number;
}
interface GlobalPackDetail extends GlobalPackRow {
  stickers: Array<{ id: string; actionId: string; sha256: string }>;
}

const CREATE_INTENT_KEY = "arken.global-sticker-create-intent";
const UPLOAD_INTENT_KEY = "arken.global-sticker-upload-intent";

function readStoredIntent<T>(
  key: string,
  isValid: (value: unknown) => value is T,
): T | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return isValid(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredIntent(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* in-memory retry remains available */
  }
}

function clearStoredIntent(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* nothing persisted */
  }
}

/** Separate creator-owned catalog controls; campaign pack ACLs remain elsewhere. */
export function GlobalStickerPackManager() {
  const ownsHeldEscape = useRef(false);
  const [packs, setPacks] = useState<GlobalPackRow[]>([]);
  const [detail, setDetail] = useState<GlobalPackDetail | null>(null);
  const [name, setName] = useState("");
  const [draftName, setDraftName] = useState("");
  const [altText, setAltText] = useState("");
  const [authorCredit, setAuthorCredit] = useState("");
  const [licenseNote, setLicenseNote] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [selectedPackId, setSelectedPackId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const storedCreateIntent = readStoredIntent(
    CREATE_INTENT_KEY,
    (value): value is { actionId: string; name: string } =>
      !!value &&
      typeof value === "object" &&
      typeof (value as { actionId?: unknown }).actionId === "string" &&
      typeof (value as { name?: unknown }).name === "string",
  );
  const storedUploadIntent = readStoredIntent(
    UPLOAD_INTENT_KEY,
    (value): value is { packId: string; actionId: string; sha256: string } =>
      !!value &&
      typeof value === "object" &&
      typeof (value as { packId?: unknown }).packId === "string" &&
      typeof (value as { actionId?: unknown }).actionId === "string" &&
      /^[a-f0-9]{64}$/.test(
        String((value as { sha256?: unknown }).sha256 ?? ""),
      ),
  );
  const [uncertain, setUncertain] = useState<
    "create" | "upload" | "publish" | null
  >(storedCreateIntent ? "create" : storedUploadIntent ? "upload" : null);
  const createIntent = useRef<{ actionId: string; name: string } | null>(
    storedCreateIntent,
  );
  const uploadIntent = useRef<{
    packId: string;
    actionId: string;
    fileName?: string;
    fileSize?: number;
    fileLastModified?: number;
    sha256: string;
    altText?: string;
    authorCredit?: string;
    licenseNote?: string;
    sourceReference?: string;
  } | null>(storedUploadIntent);

  const refresh = async (preferredPackId?: string) => {
    try {
      const rows = await api<GlobalPackRow[]>("/api/gm/global-sticker-packs");
      setPacks(rows);
      setSelectedPackId((current) =>
        rows.some((row) => row.id === preferredPackId)
          ? preferredPackId!
          : rows.some((row) => row.id === current)
            ? current
            : (rows.find((row) => row.id === storedUploadIntent?.packId)?.id ??
              rows[0]?.id ??
              ""),
      );
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось загрузить общие паки."));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selectedPackId) {
      setDetail(null);
      return;
    }
    let active = true;
    void api<GlobalPackDetail>(`/api/gm/global-sticker-packs/${selectedPackId}`)
      .then((loaded) => {
        if (active) setDetail(loaded);
      })
      .catch((reason) => {
        if (active)
          setError(formatApiError(reason, "Не удалось проверить черновик."));
      });
    return () => {
      active = false;
    };
  }, [selectedPackId]);

  const run = async (
    action: () => Promise<unknown>,
    success: string,
    mutation?: "create" | "upload" | "publish",
  ): Promise<boolean> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setNotice(success);
      await refresh(typeof result === "string" ? result : undefined);
      return true;
    } catch (reason) {
      const isUncertain = !(reason instanceof ApiError) || reason.status >= 500;
      if (isUncertain && mutation) {
        setUncertain(mutation);
        await refresh();
      }
      setError(
        isUncertain
          ? "Ответ не подтверждён; действие могло сохраниться. Не повторяйте его вслепую. Обновите список и проверьте состояние пака."
          : formatApiError(reason, "Не удалось выполнить действие."),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    const retryName =
      uncertain === "create" ? createIntent.current?.name : name;
    if (!retryName?.trim()) return;
    const intent = createIntent.current ?? {
      actionId: crypto.randomUUID(),
      name: retryName.trim(),
    };
    createIntent.current = intent;
    writeStoredIntent(CREATE_INTENT_KEY, intent);
    void run(
      async () => {
        const created = await api<GlobalPackRow>(
          "/api/gm/global-sticker-packs",
          {
            method: "POST",
            body: JSON.stringify({
              actionId: intent.actionId,
              name: intent.name,
            }),
          },
        );
        createIntent.current = null;
        clearStoredIntent(CREATE_INTENT_KEY);
        setUncertain(null);
        setName("");
        return created.id;
      },
      "Создан черновик общего пака.",
      "create",
    );
  };

  const upload = async () => {
    if (!selectedPackId || !file || !altText.trim()) return;
    const normalized = {
      packId: selectedPackId,
      fileName: file.name,
      fileSize: file.size,
      fileLastModified: file.lastModified,
      altText: altText.trim(),
      authorCredit: authorCredit.trim(),
      licenseNote: licenseNote.trim(),
      sourceReference: sourceReference.trim(),
    };
    const sha256 = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const prior = uploadIntent.current;
    if (detail?.stickers.some((sticker) => sticker.sha256 === sha256)) {
      if (prior?.packId === normalized.packId && prior.sha256 === sha256) {
        uploadIntent.current = null;
        clearStoredIntent(UPLOAD_INTENT_KEY);
        setUncertain(null);
      }
      setNotice(
        "Это изображение уже есть в черновике; повторная загрузка не отправлена.",
      );
      setFile(null);
      return;
    }
    const priorMetadata = prior && "altText" in prior;
    if (
      prior &&
      uncertain === "upload" &&
      (prior.packId !== normalized.packId ||
        prior.sha256 !== sha256 ||
        (priorMetadata &&
          (prior.fileName !== normalized.fileName ||
            prior.fileSize !== normalized.fileSize ||
            prior.fileLastModified !== normalized.fileLastModified ||
            prior.altText !== normalized.altText ||
            prior.authorCredit !== normalized.authorCredit ||
            prior.licenseNote !== normalized.licenseNote ||
            prior.sourceReference !== normalized.sourceReference)))
    ) {
      setError(
        "Для безопасного повтора выберите тот же файл и не меняйте метаданные.",
      );
      return;
    }
    const actionId = prior?.actionId ?? crypto.randomUUID();
    uploadIntent.current = { ...normalized, sha256, actionId };
    writeStoredIntent(UPLOAD_INTENT_KEY, {
      packId: selectedPackId,
      actionId,
      sha256,
    });
    const existing = detail?.stickers.find(
      (sticker) => sticker.actionId === actionId,
    );
    if (existing) {
      if (existing.sha256 !== sha256) {
        setError(
          "Источник не совпал с сохранённой загрузкой; повтор заблокирован.",
        );
        return;
      }
      uploadIntent.current = null;
      clearStoredIntent(UPLOAD_INTENT_KEY);
      setUncertain(null);
      setNotice("Загрузка уже подтверждена в черновике.");
      setFile(null);
      return;
    }
    const query = new URLSearchParams({
      actionId,
      sourceSha256: sha256,
      name: `Стикер ${detail?.stickers.length ? detail.stickers.length + 1 : 1}`,
      altText: normalized.altText,
      authorCredit: normalized.authorCredit,
      licenseNote: normalized.licenseNote,
      sourceReference: normalized.sourceReference,
    });
    const body = new FormData();
    body.append("file", file);
    const succeeded = await run(
      () =>
        api(
          `/api/gm/global-sticker-packs/${selectedPackId}/stickers?${query}`,
          { method: "POST", body },
        ),
      "Изображение добавлено в черновик.",
      "upload",
    );
    if (succeeded) {
      uploadIntent.current = null;
      clearStoredIntent(UPLOAD_INTENT_KEY);
      setUncertain(null);
      try {
        setDetail(
          await api<GlobalPackDetail>(
            `/api/gm/global-sticker-packs/${selectedPackId}`,
          ),
        );
      } catch {
        /* the server-side success remains recorded; detail can be reloaded later */
      }
      setFile(null);
      setAltText("");
      setAuthorCredit("");
      setLicenseNote("");
      setSourceReference("");
    } else {
      try {
        const latest = await api<GlobalPackDetail>(
          `/api/gm/global-sticker-packs/${selectedPackId}`,
        );
        setDetail(latest);
        if (
          latest.stickers.some(
            (sticker) =>
              sticker.actionId === actionId && sticker.sha256 === sha256,
          )
        ) {
          uploadIntent.current = null;
          clearStoredIntent(UPLOAD_INTENT_KEY);
          setUncertain(null);
          setNotice(
            "Загрузка подтверждена по сохранённой записи; повтор не требуется.",
          );
          setFile(null);
        }
      } catch {
        /* keep the actionId and exact source in memory for a safe replay */
      }
    }
  };

  const selected = packs.find((pack) => pack.id === selectedPackId);
  return (
    <details className="global-sticker-manager">
      <summary
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          const details = event.currentTarget.parentElement;
          if (!(details instanceof HTMLDetailsElement)) return;
          // A held Escape can emit repeat keydowns after this disclosure closes.
          // Only suppress repeats when this summary owned the initial keydown.
          if (!details.open) {
            if (!ownsHeldEscape.current) return;
            if (!event.repeat) {
              ownsHeldEscape.current = false;
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          ownsHeldEscape.current = true;
          details.open = false;
          event.currentTarget.focus();
        }}
        onKeyUp={(event) => {
          if (event.key === "Escape") ownsHeldEscape.current = false;
        }}
      >
        Общие паки
      </summary>
      <section aria-label="Управление общими паками">
        <p className="muted">
          Общие паки видны авторизованным участникам. Управлять ими может только
          создавший их GM. Названия отдельных стикеров не показываются.
        </p>
        <label>
          Название нового общего пака
          <input
            value={
              uncertain === "create"
                ? (createIntent.current?.name ?? name)
                : name
            }
            maxLength={120}
            disabled={uncertain === "create"}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <Button
          disabled={
            busy ||
            !(
              uncertain === "create"
                ? (createIntent.current?.name ?? name)
                : name
            ).trim()
          }
          onClick={create}
        >
          {uncertain === "create"
            ? "Безопасно повторить создание"
            : "Создать общий пак"}
        </Button>
        {packs.length > 0 && (
          <label>
            Мои общие паки
            <select
              value={selectedPackId}
              onChange={(event) => {
                setSelectedPackId(event.currentTarget.value);
                setDraftName("");
              }}
            >
              {packs.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.name} — {pack.lifecycle}
                </option>
              ))}
            </select>
          </label>
        )}
        {selected?.lifecycle === "DRAFT" && (
          <>
            <label>
              Название пака
              <input
                value={draftName || selected.name}
                onChange={(event) => setDraftName(event.currentTarget.value)}
              />
            </label>
            <Button
              disabled={
                busy || !draftName.trim() || draftName.trim() === selected.name
              }
              onClick={() =>
                void run(
                  () =>
                    api(`/api/gm/global-sticker-packs/${selected.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        revision: selected.revision,
                        name: draftName.trim(),
                      }),
                    }),
                  "Название черновика обновлено.",
                )
              }
            >
              Сохранить название
            </Button>
            <label>
              Alt-текст
              <input
                value={altText}
                onChange={(event) => setAltText(event.currentTarget.value)}
              />
            </label>
            <label>
              Авторство
              <input
                value={authorCredit}
                onChange={(event) => setAuthorCredit(event.currentTarget.value)}
              />
            </label>
            <label>
              Лицензия
              <input
                value={licenseNote}
                onChange={(event) => setLicenseNote(event.currentTarget.value)}
              />
            </label>
            <label>
              Источник
              <input
                value={sourceReference}
                onChange={(event) =>
                  setSourceReference(event.currentTarget.value)
                }
              />
            </label>
            <label>
              Изображение
              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setFile(event.currentTarget.files?.[0] ?? null)
                }
              />
            </label>
            <p className="muted">
              Загружено файлов: {detail?.stickers.length ?? "проверка…"}
            </p>
            <Button
              disabled={busy || !file || !altText.trim()}
              onClick={upload}
            >
              {uncertain === "upload"
                ? "Проверить / безопасно повторить загрузку"
                : "Добавить стикер"}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api(`/api/gm/global-sticker-packs/${selected.id}/publish`, {
                      method: "POST",
                      body: JSON.stringify({ revision: selected.revision }),
                    }),
                  "Пак опубликован для авторизованных участников.",
                  "publish",
                )
              }
            >
              Опубликовать общий пак
            </Button>
          </>
        )}
        {selected?.lifecycle === "ACTIVE" && (
          <Button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  api(`/api/gm/global-sticker-packs/${selected.id}/deprecate`, {
                    method: "POST",
                  }),
                "Пак помечен устаревшим.",
              )
            }
          >
            Снять пак с публикации
          </Button>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </section>
    </details>
  );
}
