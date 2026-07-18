import { useEffect, useState } from "react";
import { Button, Select, TextArea, TextInput } from "@gravity-ui/uikit";
import { api } from "./api";
import { createFeedbackDiagnostics } from "./feedback-diagnostics";
import { ArkenDialog } from "./ui/ArkenDialog";
import { ImageUploadField } from "./ui/ImageUploadField";
import { notify } from "./ui/notifications";

type Props = {
  buildVersion: string;
  buildRevision?: string;
  connection: string;
};

const initialDraft = {
  category: "BUG",
  title: "",
  description: "",
  reproduction: "",
};

async function captureVisibleInterface(): Promise<File> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "browser" },
    audio: false,
    preferCurrentTab: true,
  } as DisplayMediaStreamOptions);
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    if (!video.videoWidth)
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
      });
    document.documentElement.classList.add("feedback-capture-mode");
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (next) =>
          next ? resolve(next) : reject(new Error("SCREENSHOT_FAILED")),
        "image/png",
      ),
    );
    return new File([blob], `arken-space-${Date.now()}.png`, {
      type: "image/png",
    });
  } finally {
    document.documentElement.classList.remove("feedback-capture-mode");
    stream.getTracks().forEach((track) => track.stop());
  }
}

export function FeedbackReporter(props: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [screenshot, setScreenshot] = useState<File>();
  const [screenshotPreview, setScreenshotPreview] = useState<string>();
  const [attachment, setAttachment] = useState<File>();
  const [capturing, setCapturing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) {
      setDraft(initialDraft);
      setScreenshot(undefined);
      setScreenshotPreview(undefined);
      setAttachment(undefined);
      setError(undefined);
    }
  }, [open]);

  useEffect(
    () => () => {
      if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    },
    [screenshotPreview],
  );

  const updateScreenshot = (file?: File) => {
    setScreenshot(file);
    setScreenshotPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return file ? URL.createObjectURL(file) : undefined;
    });
  };

  const submit = async () => {
    if (!draft.title.trim() || !draft.description.trim()) {
      setError("Заполните название и описание.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const form = new FormData();
      form.append("kind", draft.category);
      form.append("title", draft.title.trim());
      form.append(
        "description",
        [
          draft.description.trim(),
          draft.reproduction.trim()
            ? `Как повторить:\n${draft.reproduction.trim()}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
      form.append(
        "diagnostics",
        JSON.stringify(createFeedbackDiagnostics(props)),
      );
      if (screenshot) form.append("screenshot", screenshot);
      if (attachment) form.append("image", attachment);
      await api("/api/feedback/reports", { method: "POST", body: form });
      setOpen(false);
      notify({ title: "Спасибо! Сообщение отправлено", tone: "success" });
    } catch {
      setError("Не удалось отправить сообщение. Попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button size="s" view="flat" onClick={() => setOpen(true)}>
        Сообщить
      </Button>
      <ArkenDialog
        open={open}
        title="Сообщить о проблеме или идее"
        applyLabel="Отправить"
        loading={submitting}
        error={error}
        onApply={() => void submit()}
        onClose={() => !submitting && setOpen(false)}
      >
        <div className="feedback-report-form">
          <Select
            label="Тип сообщения"
            value={[draft.category]}
            options={[
              { value: "BUG", content: "Ошибка" },
              { value: "IDEA", content: "Идея" },
            ]}
            onUpdate={(value) =>
              setDraft((current) => ({
                ...current,
                category: value[0] ?? "BUG",
              }))
            }
          />
          <TextInput
            label="Короткое название"
            value={draft.title}
            onUpdate={(title) =>
              setDraft((current) => ({
                ...current,
                title: title.slice(0, 120),
              }))
            }
          />
          <label className="feedback-field">
            <span>Описание</span>
            <TextArea
              placeholder="Что произошло или что вы предлагаете?"
              value={draft.description}
              minRows={4}
              onUpdate={(description) =>
                setDraft((current) => ({
                  ...current,
                  description: description.slice(0, 4000),
                }))
              }
            />
          </label>
          <label className="feedback-field">
            <span>Как повторить (необязательно)</span>
            <TextArea
              placeholder="Последовательность действий перед проблемой"
              value={draft.reproduction}
              minRows={3}
              onUpdate={(reproduction) =>
                setDraft((current) => ({
                  ...current,
                  reproduction: reproduction.slice(0, 2000),
                }))
              }
            />
          </label>
          <div className="feedback-capture">
            <Button
              loading={capturing}
              disabled={capturing}
              onClick={() => {
                setCapturing(true);
                void captureVisibleInterface()
                  .then(updateScreenshot)
                  .catch(() =>
                    setError(
                      "Скриншот не сделан. Разрешите захват текущей вкладки.",
                    ),
                  )
                  .finally(() => setCapturing(false));
              }}
            >
              {screenshot ? "Переснять интерфейс" : "Сделать скрин интерфейса"}
            </Button>
            <span>
              {screenshot
                ? "Скриншот приложен"
                : "Вы сами выбираете вкладку для захвата"}
            </span>
          </div>
          {screenshotPreview ? (
            <figure className="feedback-screenshot-preview">
              <img
                src={screenshotPreview}
                alt="Предпросмотр снимка интерфейса"
              />
              <figcaption>
                <span>{screenshot?.name}</span>
                <Button view="flat" size="s" onClick={() => updateScreenshot()}>
                  Удалить снимок
                </Button>
              </figcaption>
            </figure>
          ) : null}
          <ImageUploadField
            label="Дополнительное изображение"
            hint="Необязательно; PNG, JPEG или WebP"
            value={attachment}
            disabled={submitting}
            onUpdate={setAttachment}
          />
          <p className="feedback-privacy-note">
            Вместе с сообщением отправятся только версия сборки, браузер, размер
            окна, состояние соединения и последние коды ошибок. Чат, карточки
            персонажей, cookies и содержимое localStorage не собираются.
          </p>
        </div>
      </ArkenDialog>
    </>
  );
}
