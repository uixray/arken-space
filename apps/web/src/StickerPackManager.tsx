import { useMemo, useRef, useState } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { Button } from "./design-system/Button";
import { ApiError, formatApiError } from "./api";
import "./StickerPackManager.css";
import {
  createStickerPack,
  publishStickerPack,
  uploadSticker,
  type CreateStickerPackInput,
  type StickerPackAudience,
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
  file: File;
  nameReviewed: boolean;
  status: FileStatus;
  error: string;
}

const provenanceOptions: Array<[StickerProvenance, string]> = [
  ["IMPORTED", "Импортированный"],
  ["ORIGINAL", "Собственный оригинал"],
  ["COMMISSIONED", "Создан по заказу"],
];

function filenameLabel(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .trim()
    .slice(0, 80);
}

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
      setPack(created);
      setNotice(
        `Создан черновик «${created.name}». Он доступен только в этой вкладке; список черновиков на сервере не поддерживается.`,
      );
    } catch (reason) {
      if (hasUncertainMutationOutcome(reason)) {
        setCreationUncertain(true);
        setError(
          "Нет подтверждения ответа: черновик мог сохраниться. Не создавайте повторный пак вслепую — сервер пока не умеет показывать список черновиков.",
        );
      } else {
        setError(
          formatStickerApiFailure(reason, "Не удалось создать черновик."),
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    const additions: StickerDraft[] = [];
    for (const file of Array.from(selected)) {
      const identity = `${file.name}:${file.size}:${file.lastModified}`;
      if (
        files.some(
          (existing) =>
            `${existing.file.name}:${existing.file.size}:${existing.file.lastModified}` ===
            identity,
        ) ||
        additions.some(
          (existing) =>
            `${existing.file.name}:${existing.file.size}:${existing.file.lastModified}` ===
            identity,
        )
      )
        continue;
      additions.push({
        key: `${nextKey.current++}-${identity}`,
        file,
        name: filenameLabel(file.name),
        nameReviewed: false,
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
    if (additions.length < selected.length)
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
      if (
        !item.name.trim() ||
        !item.nameReviewed ||
        !item.altText.trim() ||
        !hasImportedProvenance(item)
      ) {
        updateFile(item.key, {
          status: "failed",
          error:
            "Проверьте название, заполните alt-текст и обязательные сведения об источнике.",
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
        updateFile(item.key, { status: "uploaded", error: "" });
      } catch (reason) {
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
    setNotice(
      "Загрузка завершена. Проверьте результаты и отдельно опубликуйте пак.",
    );
    setBusy(null);
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
      setPack(published);
      setNotice(`Пак «${published.name}» опубликован.`);
    } catch (reason) {
      if (hasUncertainMutationOutcome(reason)) {
        setPublishUncertain(true);
        setError(
          "Нет подтверждения ответа. Пак мог перейти в ACTIVE; не повторяйте публикацию. Сверка состояния черновика требует GM-запроса, которого пока нет.",
        );
      } else {
        setError(
          formatStickerApiFailure(
            reason,
            "Не удалось опубликовать пак. Черновик и загруженные стикеры сохранены.",
          ),
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setPack(null);
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
        Здесь создаётся новый черновик в текущей кампании. Список и
        восстановление черновиков после перезагрузки пока недоступны.
      </p>
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
          aria-label={`Черновик ${pack.name}`}
        >
          <p>
            <strong>{pack.name}</strong> · {pack.lifecycle}
          </p>
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
                  <legend>{file.file.name}</legend>
                  <p className="muted">
                    Имя из файла — только черновая подсказка; проверьте название
                    перед загрузкой.
                  </p>
                  <label>
                    Название стикера
                    <input
                      value={file.name}
                      maxLength={80}
                      disabled={
                        file.status === "uploaded" ||
                        file.status === "blocked" ||
                        file.status === "uncertain" ||
                        busy !== null
                      }
                      onChange={(event) =>
                        updateFile(file.key, {
                          name: event.currentTarget.value,
                          nameReviewed: false,
                        })
                      }
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={file.nameReviewed}
                      disabled={
                        file.status === "uploaded" ||
                        file.status === "blocked" ||
                        file.status === "uncertain" ||
                        busy !== null
                      }
                      onChange={(event) =>
                        updateFile(file.key, {
                          nameReviewed: event.currentTarget.checked,
                        })
                      }
                    />
                    Название проверено человеком
                  </label>
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
          {pack.lifecycle === "ACTIVE" && (
            <Button view="outlined" onClick={reset}>
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
