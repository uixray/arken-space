import {
  useEffect,
  useId,
  useState,
  type DragEvent,
  type ClipboardEvent,
} from "react";
import { Button, Icon } from "@gravity-ui/uikit";
import { TrashBin } from "@gravity-ui/icons";

export interface ImageUploadFieldProps {
  label: string;
  value?: File;
  accept?: string;
  disabled?: boolean;
  hint?: string;
  unifiedIntake?: boolean;
  onUpdate: (file?: File) => void;
}

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function validateImageUploadFile(file: File) {
  return SUPPORTED_IMAGE_TYPES.has(file.type)
    ? null
    : "Поддерживаются только PNG, JPEG и WebP.";
}

function firstTransferredFile(
  items: DataTransferItemList | null,
  files: FileList | null,
) {
  const item = items
    ? Array.from(items).find((candidate) => candidate.kind === "file")
    : undefined;
  return item?.getAsFile() ?? files?.[0] ?? null;
}

export function ImageUploadField({
  label,
  value,
  accept = "image/png,image/jpeg,image/webp",
  disabled,
  hint,
  unifiedIntake = false,
  onUpdate,
}: ImageUploadFieldProps) {
  const inputId = useId();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [intakeError, setIntakeError] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);

  const acceptFile = (file?: File | null) => {
    if (!file) return;
    const nextError = validateImageUploadFile(file);
    setIntakeError(nextError ?? "");
    if (!nextError) onUpdate(file);
  };

  const acceptDrop = (event: DragEvent<HTMLDivElement>) => {
    setIsDragOver(false);
    if (!unifiedIntake || disabled) return;
    event.preventDefault();
    acceptFile(
      firstTransferredFile(event.dataTransfer.items, event.dataTransfer.files),
    );
  };

  const acceptPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!unifiedIntake || disabled) return;
    const file = firstTransferredFile(
      event.clipboardData.items,
      event.clipboardData.files,
    );
    if (!file) return;
    event.preventDefault();
    acceptFile(file);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!unifiedIntake || disabled) return;
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!unifiedIntake || disabled) return;
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!unifiedIntake || disabled) return;
    if (event.currentTarget.contains(event.relatedTarget as Node | null))
      return;
    event.preventDefault();
    setIsDragOver(false);
  };

  useEffect(() => {
    if (!value) {
      setPreviewUrl(undefined);
      return;
    }
    const nextUrl = URL.createObjectURL(value);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [value]);

  return (
    <div
      className={`arken-upload-field ${unifiedIntake && !disabled ? "arken-upload-field--interactive" : ""}`}
      data-dragover={isDragOver ? "true" : undefined}
      onPaste={acceptPaste}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={acceptDrop}
    >
      <div className="arken-upload-field__heading">
        <div>
          <strong>{label}</strong>
          {hint ? <span>{hint}</span> : null}
        </div>
        <Button
          view="normal"
          disabled={disabled}
          onClick={() => document.getElementById(inputId)?.click()}
        >
          {value ? "Заменить" : "Выбрать файл"}
        </Button>
      </div>
      {/* UIX-532: поле выбора файла спрятано визуально, но существует для
          программ чтения с экрана и обязано называть себя. Заголовок рядом
          его не подписывает: он не `<label>` и ни на что не ссылается. */}
      <input
        id={inputId}
        aria-label={label}
        className="arken-visually-hidden"
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => acceptFile(event.currentTarget.files?.[0])}
      />
      {value ? (
        <figure className="arken-upload-field__preview">
          {previewUrl ? (
            <img src={previewUrl} alt={`Предпросмотр ${value.name}`} />
          ) : null}
          <figcaption>
            <span>
              <strong>{value.name}</strong>
              <small>{Math.ceil(value.size / 1024)} КБ</small>
            </span>
            <Button
              view="flat-danger"
              aria-label={`Удалить ${value.name}`}
              disabled={disabled}
              onClick={() => onUpdate(undefined)}
            >
              <Icon data={TrashBin} size={16} />
            </Button>
          </figcaption>
        </figure>
      ) : (
        <div
          className={`arken-upload-field__empty ${unifiedIntake && !disabled ? "arken-upload-field__empty--interactive" : ""}`}
          role={unifiedIntake && !disabled ? "button" : undefined}
          tabIndex={unifiedIntake && !disabled ? 0 : undefined}
          aria-label={
            unifiedIntake && !disabled
              ? "Выбрать, вставить или перетащить файл"
              : undefined
          }
          onClick={() => {
            if (unifiedIntake && !disabled) {
              document.getElementById(inputId)?.click();
            }
          }}
          onKeyDown={(event) => {
            if (
              unifiedIntake &&
              !disabled &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              document.getElementById(inputId)?.click();
            }
          }}
        >
          {unifiedIntake
            ? "Выберите, вставьте или перетащите изображение сюда"
            : "Предпросмотр появится после выбора файла"}
        </div>
      )}
      {intakeError ? (
        <div className="field-error" role="alert">
          {intakeError}
        </div>
      ) : null}
    </div>
  );
}
