import { useId, useRef, useState } from "react";
import { Button } from "../design-system/Button";
import { AppIcon } from "./AppIcon";
import { DeleteIcon } from "./icons";

export interface AudioUploadFieldProps {
  label: string;
  value?: File;
  disabled?: boolean;
  hint?: string;
  onUpdate: (file?: File) => void;
}

const AUDIO_ACCEPT = ".mp3,.ogg,audio/mpeg,audio/ogg,application/ogg";
const SUPPORTED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/ogg",
  "application/ogg",
]);

function validateAudioFile(file: File) {
  const type = file.type.trim().toLowerCase();
  if (type) {
    return SUPPORTED_AUDIO_TYPES.has(type)
      ? null
      : "Поддерживаются только MP3 и OGG.";
  }
  return /\.(mp3|ogg)$/i.test(file.name)
    ? null
    : "Поддерживаются только MP3 и OGG.";
}

export function AudioUploadField({
  label,
  value,
  disabled,
  hint,
  onUpdate,
}: AudioUploadFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");

  const acceptFile = (file?: File) => {
    if (disabled || !file) return;
    const nextError = validateAudioFile(file);
    setError(nextError ?? "");
    if (!nextError) onUpdate(file);
  };

  const removeFile = () => {
    if (disabled) return;
    // Move focus before the focused remove button disappears with the draft.
    pickerRef.current?.focus();
    setError("");
    onUpdate(undefined);
  };

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="arken-upload-field">
      <div className="arken-upload-field__heading">
        <div>
          <strong>{label}</strong>
          {hint ? <span id={hintId}>{hint}</span> : null}
        </div>
        <Button
          ref={pickerRef}
          view="normal"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {value ? "Заменить" : "Выбрать файл"}
        </Button>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="arken-visually-hidden"
        type="file"
        accept={AUDIO_ACCEPT}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          acceptFile(file);
        }}
      />
      {value ? (
        <figure className="arken-upload-field__preview">
          <figcaption>
            <span>
              <strong>{value.name}</strong>
              <small>{Math.ceil(value.size / 1024)} КБ</small>
            </span>
            <Button
              view="flat-danger"
              disabled={disabled}
              aria-label={`Удалить ${value.name}`}
              onClick={removeFile}
            >
              <AppIcon icon={DeleteIcon} />
            </Button>
          </figcaption>
        </figure>
      ) : (
        <div className="arken-upload-field__empty">Выберите MP3 или OGG.</div>
      )}
      {error ? (
        <div id={errorId} className="field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
