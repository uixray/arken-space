import { useState } from "react";
import { Button, Select, TextArea, TextInput } from "@gravity-ui/uikit";
import { ArkenDialog } from "./ArkenDialog";
import { ImageUploadField } from "./ImageUploadField";
import { NumberStepper } from "./NumberStepper";

type FutureDialog = "token" | "files" | "scene" | "music";

const dialogTitles: Record<FutureDialog, string> = {
  token: "Настройка токена",
  files: "Загрузка файлов",
  scene: "Настройка сцены",
  music: "Музыкальная библиотека",
};

export function FuturePoolDialogs() {
  const [dialog, setDialog] = useState<FutureDialog>();
  const [image, setImage] = useState<File>();
  const [size, setSize] = useState(1);

  return (
    <>
      <div className="gravity-preview__actions">
        {(Object.keys(dialogTitles) as FutureDialog[]).map((key) => (
          <Button
            key={key}
            view="normal"
            size="l"
            onClick={() => setDialog(key)}
          >
            {dialogTitles[key]}
          </Button>
        ))}
      </div>
      <ArkenDialog
        open={Boolean(dialog)}
        title={dialog ? dialogTitles[dialog] : ""}
        onClose={() => setDialog(undefined)}
      >
        {dialog === "token" ? (
          <div className="gravity-preview__dialog-fields">
            <TextInput label="Название" size="l" />
            <Select
              label="Слой"
              size="l"
              defaultValue={["players"]}
              options={[
                { value: "map", content: "Карта" },
                { value: "gm", content: "Мастер" },
                { value: "players", content: "Игроки" },
              ]}
            />
            <NumberStepper
              label="Размер"
              value={size}
              min={0.25}
              max={8}
              step={0.25}
              onUpdate={setSize}
            />
            <ImageUploadField
              label="Изображение токена"
              value={image}
              onUpdate={setImage}
            />
          </div>
        ) : null}
        {dialog === "files" ? (
          <ImageUploadField
            label="Изображение"
            value={image}
            hint="PNG, JPEG или WebP"
            onUpdate={setImage}
          />
        ) : null}
        {dialog === "scene" ? (
          <div className="gravity-preview__dialog-fields">
            <TextInput label="Название сцены" size="l" />
            <NumberStepper
              label="Ширина игровой области"
              value={1600}
              min={320}
              onUpdate={() => undefined}
            />
            <NumberStepper
              label="Высота игровой области"
              value={900}
              min={240}
              onUpdate={() => undefined}
            />
          </div>
        ) : null}
        {dialog === "music" ? (
          <div className="gravity-preview__dialog-fields">
            <TextInput label="Название композиции" size="l" />
            <TextArea placeholder="Заметка мастера" minRows={3} />
            <div className="arken-upload-field__empty">
              Здесь появится список загруженных аудиофайлов
            </div>
          </div>
        ) : null}
      </ArkenDialog>
    </>
  );
}
