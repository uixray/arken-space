import { useEffect, useMemo, useRef, useState } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { Button } from "./design-system/Button";
import { ApiError, formatApiError } from "./api";
import "./StickerPackManager.css";
import {
  createStickerPack,
  getStickerPack,
  listStickerPacks,
  publishStickerPack,
  uploadSticker,
  type CreateStickerPackInput,
  type StickerPackAudience,
  type StickerPackAdminDetail,
  type StickerPackAdminSummary,
  type StickerPackMutationResult,
  type StickerPackSendPolicy,
  type StickerPackSubject,
  type StickerProvenance,
  type StickerUploadMetadata,
} from "./sticker-pack-api";

type FileStatus =
  "pending" | "uploading" | "uploaded" | "failed" | "blocked" | "uncertain";
interface StickerDraft extends StickerUploadMetadata {
  key: string;
  file: File | null;
  fileLabel: string;
  status: FileStatus;
  error: string;
}

const provenanceOptions: Array<[StickerProvenance, string]> = [
  ["IMPORTED", "Импортированный"],
  ["ORIGINAL", "Собственный оригинал"],
  ["COMMISSIONED", "Создан по заказу"],
];

function hasImportedProvenance(item: StickerDraft) {
  return (
    item.provenanceType !== "IMPORTED" ||
    (!!item.sourceReference?.trim() &&
      !!item.authorCredit?.trim() &&
      !!item.licenseNote?.trim())
  );
}

function hasUncertainMutationOutcome(reason: unknown) {
  return !(reason instanceof ApiError) || reason.status >= 500;
}

function lifecycleLabel(lifecycle: StickerPackMutationResult["lifecycle"]) {
  return {
    DRAFT: "Черновик",
    ACTIVE: "Опубликованный пак",
    DEPRECATED: "Устаревший пак",
    ARCHIVED: "Архивный пак",
  }[lifecycle];
}

function formatStickerApiFailure(reason: unknown, fallback: string) {
  if (!(reason instanceof ApiError)) return formatApiError(reason, fallback);
  const explanations: Record<string, string> = {
    LIKENESS_CONSENT_REQUIRED:
      "Игрок должен сам дать согласие на использование своего образа; после этого можно повторить публикацию.",
    STICKER_PACK_EMPTY: "Добавьте хотя бы один стикер перед публикацией.",
    MEDIA_QUOTA_EXCEEDED:
      "Превышена общая квота хранения кампании; освободите место или уменьшите файл.",
    UNSUPPORTED_IMAGE_TYPE: "Формат изображения не поддерживается.",
    IMAGE_TOO_LARGE: "Исходный файл превышает лимит размера.",
    IMAGE_DIMENSIONS_TOO_LARGE:
      "Размеры изображения превышают допустимый лимит обработки.",
    LOW_DISK_SPACE: "На сервере недостаточно свободного места.",
  };
  const explanation = explanations[reason.code];
  return explanation
    ? `${explanation} (${reason.code})`
    : `${reason.message} (${reason.code})`;
}

export function StickerPackManager({ snapshot }: { snapshot: GameSnapshot }) {
  if (snapshot.me.role !== "GM") return null;
  return (
    <StickerPackManagerSession
      key={`${snapshot.campaign.id}:${snapshot.me.id}`}
      snapshot={snapshot}
    />
  );
}

function StickerPackManagerSession({ snapshot }: { snapshot: GameSnapshot }) {
  const isGm = snapshot.me.role === "GM";
  const [packName, setPackName] = useState("");
  const [subject, setSubject] = useState<StickerPackSubject>("CHARACTER");
  const [characterId, setCharacterId] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [subjectLabel, setSubjectLabel] = useState("");
  const [audience, setAudience] = useState<StickerPackAudience>("GM_ONLY");
  const [sendPolicy, setSendPolicy] =
    useState<StickerPackSendPolicy>("GM_ONLY");
  const [pack, setPack] = useState<StickerPackMutationResult | null>(null);
  const [packDetail, setPackDetail] = useState<StickerPackAdminDetail | null>(
    null,
  );
  const [serverPacks, setServerPacks] = useState<StickerPackAdminSummary[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [files, setFiles] = useState<StickerDraft[]>([]);
  const [busy, setBusy] = useState<"create" | "upload" | "publish" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [publishUncertain, setPublishUncertain] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const sessionActive = useRef(true);

  useEffect(() => {
    sessionActive.current = true;
    return () => {
      sessionActive.current = false;
    };
  }, []);

  const refreshPackList = async () => {
    setListBusy(true);
    try {
      const listed = await listStickerPacks();
      if (!sessionActive.current) return;
      setServerPacks(listed);
      setListLoaded(true);
      return listed;
    } catch (reason) {
      if (sessionActive.current)
        setError(formatApiError(reason, "Не удалось обновить список паков."));
      return undefined;
    } finally {
      if (sessionActive.current) setListBusy(false);
    }
  };

  useEffect(() => {
    void refreshPackList();
  }, []);

  const resumePack = async (packId: string) => {
    setBusy("create");
    setError("");
    setNotice("");
    try {
      const detail = await getStickerPack(packId);
      if (!sessionActive.current) return;
      setPack(detail);
      setPackDetail(detail);
      setAudience(detail.audience);
      setSendPolicy(detail.sendPolicy);
      setFiles(
        detail.stickers.map((sticker, index) => ({
          key: `server-${sticker.id}`,
          file: null,
          fileLabel: `Изображение ${index + 1}`,
          name: sticker.name,
          altText: sticker.altText,
          provenanceType: sticker.provenanceType,
          sourceReference: sticker.sourceReference ?? "",
          authorCredit: sticker.authorCredit ?? "",
          licenseNote: sticker.licenseNote ?? "",
          status: "uploaded",
          error: "",
        })),
      );
      setNotice(
        detail.lifecycle === "DRAFT"
          ? `Черновик «${detail.name}» восстановлен. Загруженные файлы уже отмечены; ожидающие байты нужно выбрать повторно.`
          : detail.lifecycle === "ACTIVE"
            ? `Пак «${detail.name}» уже опубликован. Текущее состояние загружено с сервера.`
            : detail.lifecycle === "DEPRECATED"
              ? `Пак «${detail.name}» устарел и доступен только для просмотра. Создайте новый пак, чтобы продолжить.`
              : `Пак «${detail.name}» архивирован и доступен только для просмотра. Создайте новый пак, чтобы продолжить.`,
      );
    } catch (reason) {
      if (sessionActive.current)
        setError(formatApiError(reason, "Не удалось открыть пак."));
    } finally {
      if (sessionActive.current) setBusy(null);
    }
  };

  const activeCharacters = useMemo(
    () =>
      snapshot.characters.filter(
        (character) => character.lifecycle === "ACTIVE",
      ),
    [snapshot.characters],
  );
  const playerMembers = useMemo(
    () => snapshot.members.filter((member) => member.role === "PLAYER"),
    [snapshot.members],
  );
  const subjectValid =
    (subject === "CHARACTER" &&
      activeCharacters.some((x) => x.id === characterId)) ||
    (subject === "PLAYER" &&
      playerMembers.some((x) => x.id === membershipId)) ||
    ((subject === "NPC" || subject === "CREATURE") &&
      subjectLabel.trim().length > 0 &&
      subjectLabel.trim().length <= 80);
  const packInputValid =
    packName.trim().length > 0 && packName.trim().length <= 120 && subjectValid;
  const allFilesUploaded =
    files.length > 0 && files.every((file) => file.status === "uploaded");

  if (!isGm) return null;

  const changeSubject = (value: StickerPackSubject) => {
    setSubject(value);
    setCharacterId("");
    setMembershipId("");
    setSubjectLabel("");
  };

  const createDraft = async () => {
    if (!packInputValid || busy || creationUncertain) return;
    const input: CreateStickerPackInput = {
      name: packName.trim(),
      subject,
      subjectCharacterId: subject === "CHARACTER" ? characterId : null,
      subjectMembershipId: subject === "PLAYER" ? membershipId : null,
      subjectLabel:
        subject === "NPC" || subject === "CREATURE"
          ? subjectLabel.trim()
          : null,
      audience,
      sendPolicy,
    };
    setBusy("create");
    setError("");
    setNotice("");
    try {
      const created = await createStickerPack(input);
      if (!sessionActive.current) return;
      setPack(created);
      setPackDetail(null);
      setNotice(
        `Создан черновик «${created.name}». Можно восстановить его из списка паков после перезагрузки.`,
      );
      void refreshPackList();
    } catch (reason) {
      if (!sessionActive.current) return;
      if (hasUncertainMutationOutcome(reason)) {
        setCreationUncertain(true);
        setError(
          "Нет подтверждения ответа: черновик мог сохраниться. Не повторяйте создание вслепую; обновите список и вручную выберите соответствующий пак.",
        );
        void refreshPackList();
      } else {
        setError(
          formatStickerApiFailure(reason, "Не удалось создать черновик."),
        );
      }
    } finally {
      if (sessionActive.current) setBusy(null);
    }
  };

  const addFiles = async (selected: FileList | null) => {
    if (!selected) return;
    const additions: StickerDraft[] = [];
    let matchedExisting = 0;
    for (const file of Array.from(selected)) {
      let sha256: string | undefined;
      if (packDetail?.stickers.length) {
        if (!globalThis.crypto?.subtle) {
          setError(
            "Не удалось сверить файл с серверными стикерами: браузер не поддерживает локальный SHA-256.",
          );
          return;
        }
        const digest = await globalThis.crypto.subtle.digest(
          "SHA-256",
          await file.arrayBuffer(),
        );
        sha256 = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (packDetail.stickers.some((sticker) => sticker.sha256 === sha256)) {
          matchedExisting += 1;
          continue;
        }
      }
      const identity = `${file.name}:${file.size}:${file.lastModified}`;
      if (
        files.some(
          (existing) =>
            existing.file !== null &&
            `${existing.file.name}:${existing.file.size}:${existing.file.lastModified}` ===
              identity,
        ) ||
        additions.some(
          (existing) =>
            existing.file !== null &&
            `${existing.file.name}:${existing.file.size}:${existing.file.lastModified}` ===
              identity,
        )
      )
        continue;
      const fallbackName = `Стикер ${nextKey.current + 1}`;
      additions.push({
        key: `${nextKey.current++}-${identity}`,
        file,
        fileLabel: file.name,
        // The API requires a stable label, but filenames are not a public-facing
        // sticker name. Keep this implementation detail out of the UI.
        name: fallbackName,
        altText: "",
        provenanceType: "IMPORTED",
        sourceReference: "",
        authorCredit: "",
        licenseNote: "",
        status: "pending",
        error: "",
      });
    }
    setFiles((current) => [...current, ...additions]);
    setError("");
    if (matchedExisting > 0)
      setNotice(
        `${matchedExisting} повторно выбранный файл совпал по SHA-256 с уже загруженным стикером и не будет отправлен повторно.`,
      );
    if (additions.length < selected.length && matchedExisting === 0)
      setNotice("Повторно выбранные файлы не добавлены в список второй раз.");
    if (fileInput.current) fileInput.current.value = "";
  };

  const updateFile = (key: string, patch: Partial<StickerDraft>) =>
    setFiles((current) =>
      current.map((file) =>
        file.key === key &&
        file.status !== "uploaded" &&
        file.status !== "blocked" &&
        file.status !== "uncertain"
          ? { ...file, ...patch }
          : file,
      ),
    );

  const uploadPending = async () => {
    if (!pack || busy) return;
    const toUpload = files.filter(
      (item) => item.status === "pending" || item.status === "failed",
    );
    if (toUpload.length === 0) return;
    setBusy("upload");
    setError("");
    setNotice("");
    for (const item of toUpload) {
      if (!sessionActive.current) break;
      if (!item.file) continue;
      if (
        !item.altText.trim() ||
        !hasImportedProvenance(item)
      ) {
        updateFile(item.key, {
          status: "failed",
          error:
            "Заполните alt-текст и обязательные сведения об источнике.",
        });
        continue;
      }
      updateFile(item.key, { status: "uploading", error: "" });
      try {
        await uploadSticker(pack.id, item.file, {
          name: item.name.trim(),
          altText: item.altText.trim(),
          provenanceType: item.provenanceType,
          sourceReference: item.sourceReference?.trim() || undefined,
          authorCredit: item.authorCredit?.trim() || undefined,
          licenseNote: item.licenseNote?.trim() || undefined,
        });
        if (sessionActive.current)
          updateFile(item.key, { status: "uploaded", error: "" });
      } catch (reason) {
        if (!sessionActive.current) break;
        const uncertain = hasUncertainMutationOutcome(reason);
        const ambiguousUploadFailure =
          reason instanceof ApiError && reason.code === "UPLOAD_FAILED";
        updateFile(item.key, {
          status: uncertain
            ? "uncertain"
            : ambiguousUploadFailure
              ? "blocked"
              : "failed",
          error: uncertain
            ? "Ответ потерян: сервер мог принять файл. Не повторяйте и не удаляйте эту строку; из-за уникального SHA-256 повтор может выглядеть как дубль. Нужна отдельная проверка черновика."
            : ambiguousUploadFailure
              ? "Сервер отклонил файл с общей ошибкой загрузки: возможен дубль SHA-256 или другая причина. Не отправляйте файл снова вслепую; проверьте кампанию/черновик."
              : formatStickerApiFailure(reason, "Не удалось загрузить стикер."),
        });
      }
    }
    if (sessionActive.current) {
      setNotice(
        "Загрузка завершена. Проверьте результаты и отдельно опубликуйте пак.",
      );
      setBusy(null);
    }
  };

  const publish = async () => {
    if (!pack || !allFilesUploaded || busy || publishUncertain) return;
    if (
      !window.confirm(
        `Опубликовать «${pack.name}» для выбранной аудитории? Стикеры станут доступны согласно настройкам видимости и отправки.`,
      )
    )
      return;
    setBusy("publish");
    setError("");
    setNotice("");
    try {
      const published = await publishStickerPack(pack.id);
      if (!sessionActive.current) return;
      setPack(published);
      void refreshPackList();
      setNotice(`Пак «${published.name}» опубликован.`);
    } catch (reason) {
      if (!sessionActive.current) return;
      if (hasUncertainMutationOutcome(reason)) {
        setPublishUncertain(true);
        setError(
          "Нет подтверждения ответа. Пак мог перейти в ACTIVE; не повторяйте публикацию вслепую — обновите состояние пакета.",
        );
        void refreshPackList();
      } else {
        setError(
          formatStickerApiFailure(
            reason,
            "Не удалось опубликовать пак. Черновик и загруженные стикеры сохранены.",
          ),
        );
      }
    } finally {
      if (sessionActive.current) setBusy(null);
    }
  };

  const reset = () => {
    setPack(null);
    setPackDetail(null);
    setFiles([]);
    setPackName("");
    setNotice("");
    setError("");
    setCreationUncertain(false);
    setPublishUncertain(false);
  };

  return (
    <section
      className="sticker-pack-manager upload-section"
      aria-labelledby="sticker-pack-manager-title"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">Стикеры</span>
          <h3 id="sticker-pack-manager-title">Пак кампании</h3>
        </div>
        {pack && <span className="revision">{pack.lifecycle}</span>}
      </div>
      <p className="muted">
        Список паков загружается из текущей кампании только для мастера. После
        перезагрузки выберите пак вручную; локальные файлы нужно выбрать снова.
      </p>
      <div className="sticker-pack-server-list" aria-label="Паки кампании">
        <Button
          view="outlined"
          disabled={busy !== null || listBusy}
          loading={listBusy}
          onClick={() => void refreshPackList()}
        >
          Обновить список паков
        </Button>
        {!listLoaded ? (
          <p className="muted">Загрузка списка…</p>
        ) : serverPacks.length === 0 ? (
          <p className="muted">В этой кампании пока нет паков.</p>
        ) : (
          <ul>
            {serverPacks.map((serverPack) => (
              <li key={serverPack.id}>
                <Button
                  view="flat-secondary"
                  disabled={busy !== null}
                  onClick={() => void resumePack(serverPack.id)}
                >
                  Открыть «{serverPack.name}» · {serverPack.lifecycle} ·{" "}
                  {serverPack.stickerCount} стик.
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!pack ? (
        <div className="sticker-pack-fields">
          <label>
            Название пака
            <input
              value={packName}
              maxLength={120}
              onChange={(event) => setPackName(event.currentTarget.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Тип набора
            <select
              value={subject}
              onChange={(event) =>
                changeSubject(event.currentTarget.value as StickerPackSubject)
              }
            >
              <option value="CHARACTER">Персонаж</option>
              <option value="PLAYER">Игрок</option>
              <option value="NPC">NPC</option>
              <option value="CREATURE">Существо</option>
            </select>
          </label>
          {subject === "CHARACTER" && (
            <label>
              Персонаж
              <select
                value={characterId}
                onChange={(event) => setCharacterId(event.currentTarget.value)}
              >
                <option value="">Выберите активного персонажа</option>
                {activeCharacters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {subject === "PLAYER" && (
            <label>
              Игрок
              <select
                value={membershipId}
                onChange={(event) => setMembershipId(event.currentTarget.value)}
              >
                <option value="">Выберите участника кампании</option>
                {playerMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(subject === "NPC" || subject === "CREATURE") && (
            <label>
              Имя {subject === "NPC" ? "NPC" : "существа"}
              <input
                value={subjectLabel}
                maxLength={80}
                onChange={(event) => setSubjectLabel(event.currentTarget.value)}
                autoComplete="off"
              />
            </label>
          )}
          <label>
            Кто может видеть
            <select
              value={audience}
              onChange={(event) =>
                setAudience(event.currentTarget.value as StickerPackAudience)
              }
            >
              <option value="GM_ONLY">Только мастер</option>
              <option value="CAMPAIGN">Все участники кампании</option>
            </select>
          </label>
          <label>
            Кто может отправлять
            <select
              value={sendPolicy}
              onChange={(event) =>
                setSendPolicy(
                  event.currentTarget.value as StickerPackSendPolicy,
                )
              }
            >
              <option value="GM_ONLY">Только мастер</option>
              <option value="ALL_MEMBERS">Все участники кампании</option>
            </select>
          </label>
          <p className="muted">
            Режим доступа по персональным разрешениям здесь пока не
            настраивается. Выбор персонажа/игрока не заменяет согласие игрока на
            использование его образа.
          </p>
          {creationUncertain && (
            <p className="field-error" role="alert">
              Создание не подтверждено. Выберите возможный результат выше;
              повторное создание заблокировано до ручной сверки списка.
            </p>
          )}
          <Button
            view="action"
            disabled={!packInputValid || busy !== null || creationUncertain}
            loading={busy === "create"}
            onClick={() => void createDraft()}
          >
            Создать черновик
          </Button>
        </div>
      ) : (
        <div
          className="sticker-pack-draft"
          aria-label={`${lifecycleLabel(pack.lifecycle)} ${pack.name}`}
        >
          <p>
            <strong>{pack.name}</strong> · {lifecycleLabel(pack.lifecycle)}
          </p>
          <Button
            view="outlined"
            disabled={busy !== null}
            loading={busy === "create"}
            onClick={() => void resumePack(pack.id)}
          >
            Сверить состояние с сервером
          </Button>
          {packDetail?.subject === "PLAYER" && (
            <p className="muted">
              Согласие на образ: {packDetail.playerConsentStatus ?? "не дано"}.
              Сервер повторно проверит согласие при публикации.
            </p>
          )}
          <label>
            Добавить изображения
            <input
              ref={fileInput}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              multiple
              disabled={pack.lifecycle !== "DRAFT" || busy !== null}
              onChange={(event) => addFiles(event.currentTarget.files)}
            />
          </label>
          <p className="muted">
            Сервер принимает по одному PNG, JPEG или WebP за запрос и хранит
            обработанный результат как WebP; исходник — до 5 MiB и 4096×4096.
            Имена и alt-тексты проверьте вручную; успешные файлы повторно не
            отправляются.
          </p>
          {files.length === 0 ? (
            <p className="muted">
              Выберите одно или несколько статичных изображений.
            </p>
          ) : (
            <div className="sticker-pack-file-list">
              {files.map((file) => (
                <fieldset className="sticker-pack-file" key={file.key}>
                  <legend>{file.file?.name ?? file.fileLabel}</legend>
                  <label>
                    Alt-текст
                    <input
                      value={file.altText}
                      maxLength={240}
                      disabled={
                        file.status === "uploaded" ||
                        file.status === "blocked" ||
                        file.status === "uncertain" ||
                        busy !== null
                      }
                      onChange={(event) =>
                        updateFile(file.key, {
                          altText: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Происхождение
                    <select
                      value={file.provenanceType}
                      disabled={
                        file.status === "uploaded" ||
                        file.status === "blocked" ||
                        file.status === "uncertain" ||
                        busy !== null
                      }
                      onChange={(event) =>
                        updateFile(file.key, {
                          provenanceType: event.currentTarget
                            .value as StickerProvenance,
                        })
                      }
                    >
                      {provenanceOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {file.provenanceType === "IMPORTED" && (
                    <>
                      <label>
                        Источник (обязательно для импортированного)
                        <input
                          value={file.sourceReference ?? ""}
                          maxLength={1000}
                          disabled={
                            file.status === "uploaded" ||
                            file.status === "blocked" ||
                            file.status === "uncertain" ||
                            busy !== null
                          }
                          onChange={(event) =>
                            updateFile(file.key, {
                              sourceReference: event.currentTarget.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Авторство / указание автора
                        <input
                          value={file.authorCredit ?? ""}
                          maxLength={200}
                          disabled={
                            file.status === "uploaded" ||
                            file.status === "blocked" ||
                            file.status === "uncertain" ||
                            busy !== null
                          }
                          onChange={(event) =>
                            updateFile(file.key, {
                              authorCredit: event.currentTarget.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Лицензия / разрешение
                        <input
                          value={file.licenseNote ?? ""}
                          maxLength={1000}
                          disabled={
                            file.status === "uploaded" ||
                            file.status === "blocked" ||
                            file.status === "uncertain" ||
                            busy !== null
                          }
                          onChange={(event) =>
                            updateFile(file.key, {
                              licenseNote: event.currentTarget.value,
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                  <p className="muted" aria-live="polite">
                    {file.status === "uploaded"
                      ? "Загружен; повторно отправлен не будет."
                      : file.status === "uploading"
                        ? "Загрузка…"
                        : file.status === "uncertain"
                          ? `Состояние не подтверждено. ${file.error}`
                          : file.status === "blocked"
                            ? `Повторная отправка заблокирована до проверки. ${file.error}`
                            : file.error || "Ожидает загрузки."}
                  </p>
                  {file.status !== "uploaded" &&
                    file.status !== "uncertain" &&
                    busy === null && (
                      <Button
                        view="flat-secondary"
                        onClick={() =>
                          setFiles((current) =>
                            current.filter(
                              (candidate) => candidate.key !== file.key,
                            ),
                          )
                        }
                      >
                        {file.status === "blocked"
                          ? "Убрать не загруженный файл из очереди"
                          : "Убрать из списка"}
                      </Button>
                    )}
                </fieldset>
              ))}
            </div>
          )}
          {pack.lifecycle === "DRAFT" && (
            <>
              <Button
                view="action"
                disabled={
                  files.length === 0 ||
                  busy !== null ||
                  files.every(
                    (file) =>
                      file.status === "uploaded" ||
                      file.status === "blocked" ||
                      file.status === "uncertain",
                  )
                }
                loading={busy === "upload"}
                onClick={() => void uploadPending()}
              >
                {files.some((file) => file.status === "failed")
                  ? "Повторить неуспешные загрузки"
                  : "Загрузить ожидающие стикеры"}
              </Button>
              <Button
                view="action"
                disabled={
                  !allFilesUploaded || busy !== null || publishUncertain
                }
                loading={busy === "publish"}
                onClick={() => void publish()}
              >
                Опубликовать пак…
              </Button>
            </>
          )}
          {pack.lifecycle !== "DRAFT" && (
            <Button view="outlined" disabled={busy !== null} onClick={reset}>
              Создать ещё один пак
            </Button>
          )}
        </div>
      )}
      {error && (
        <div className="field-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
