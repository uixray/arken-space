import { useEffect, useId, useState } from "react";
import { Button, FilePreview, Icon } from "@gravity-ui/uikit";
import { TrashBin } from "@gravity-ui/icons";

export interface ImageUploadFieldProps {
  label: string;
  value?: File;
  accept?: string;
  disabled?: boolean;
  hint?: string;
  onUpdate: (file?: File) => void;
}

export function ImageUploadField({
  label,
  value,
  accept = "image/png,image/jpeg,image/webp",
  disabled,
  hint,
  onUpdate,
}: ImageUploadFieldProps) {
  const inputId = useId();
  const [previewUrl, setPreviewUrl] = useState<string>();

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
    <div className="arken-upload-field">
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
      <input
        id={inputId}
        className="arken-visually-hidden"
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => onUpdate(event.currentTarget.files?.[0])}
      />
      {value ? (
        <FilePreview
          file={value}
          imageSrc={previewUrl}
          description={`${Math.ceil(value.size / 1024)} КБ`}
          actions={[
            {
              title: "Удалить",
              icon: <Icon data={TrashBin} size={16} />,
              onClick: () => onUpdate(undefined),
            },
          ]}
        />
      ) : (
        <div className="arken-upload-field__empty">
          Предпросмотр появится после выбора файла
        </div>
      )}
    </div>
  );
}
