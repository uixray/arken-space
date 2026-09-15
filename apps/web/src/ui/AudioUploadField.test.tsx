// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderComponent,
  screen,
  userEvent,
} from "../test-support/render";
import { AudioUploadField } from "./AudioUploadField";

vi.mock("@gravity-ui/uikit", () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

const originalCreateObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);

afterEach(() => {
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
});

function ControlledField({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<File>();
  return (
    <AudioUploadField
      label="Аудиофайл"
      value={value}
      disabled={disabled}
      hint="MP3 или OGG; загрузится после сохранения."
      onUpdate={setValue}
    />
  );
}

describe("AudioUploadField", () => {
  it("открывает native picker кнопкой выбора", async () => {
    renderComponent(
      <AudioUploadField label="Аудиофайл" onUpdate={() => undefined} />,
    );
    const input = screen.getByLabelText("Аудиофайл");
    const click = vi.spyOn(input, "click");

    await userEvent.click(screen.getByRole("button", { name: "Выбрать файл" }));

    expect(click).toHaveBeenCalledOnce();
  });

  it.each([
    ["audio/mpeg", "scene.mp3"],
    ["audio/ogg", "scene.ogg"],
    ["application/ogg", "scene.ogg"],
    ["", "SCENE.MP3"],
    ["", "scene.ogg"],
  ])(
    "принимает допустимый кандидат %s %s и сбрасывает input",
    async (type, name) => {
      const onUpdate = vi.fn();
      renderComponent(
        <AudioUploadField label="Аудиофайл" onUpdate={onUpdate} />,
      );
      const input = screen.getByLabelText<HTMLInputElement>("Аудиофайл");
      const file = new File(["fixture"], name, { type });

      await userEvent.upload(input, file);

      expect(onUpdate).toHaveBeenCalledWith(file);
      expect(input).toHaveAttribute(
        "accept",
        ".mp3,.ogg,audio/mpeg,audio/ogg,application/ogg",
      );
      expect(input).toHaveValue("");
      expect(input.files).toHaveLength(0);
    },
  );

  it.each([
    ["audio/wav", "renamed.mp3"],
    ["image/png", "renamed.ogg"],
    ["", "unknown.wav"],
  ])(
    "отклоняет известный чужой MIME или неизвестное расширение",
    async (type, name) => {
      const user = userEvent.setup({ applyAccept: false });
      const onUpdate = vi.fn();
      renderComponent(
        <AudioUploadField label="Аудиофайл" onUpdate={onUpdate} />,
      );
      const input = screen.getByLabelText<HTMLInputElement>("Аудиофайл");

      await user.upload(input, new File(["fixture"], name, { type }));

      expect(onUpdate).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Поддерживаются только MP3 и OGG.",
      );
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAccessibleDescription(
        "Поддерживаются только MP3 и OGG.",
      );
    },
  );

  it("сохраняет controlled файл при cancel и недопустимом выборе", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderComponent(<ControlledField />);
    const input = screen.getByLabelText<HTMLInputElement>("Аудиофайл");
    await user.upload(
      input,
      new File(["mp3"], "kept.mp3", { type: "audio/mpeg" }),
    );

    fireEvent.change(input, { target: { files: [] } });
    await user.upload(
      input,
      new File(["wav"], "bad.wav", { type: "audio/wav" }),
    );

    expect(screen.getByText("kept.mp3")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("после удаления позволяет выбрать тот же File и очищает ошибку", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const updates = vi.fn();
    function Harness() {
      const [value, setValue] = useState<File>();
      return (
        <AudioUploadField
          label="Аудиофайл"
          value={value}
          onUpdate={(file) => {
            updates(file);
            setValue(file);
          }}
        />
      );
    }
    renderComponent(<Harness />);
    const input = screen.getByLabelText<HTMLInputElement>("Аудиофайл");
    const file = new File(["mp3"], "same.mp3", { type: "audio/mpeg" });
    await user.upload(input, file);
    await user.upload(
      input,
      new File(["wav"], "bad.wav", { type: "audio/wav" }),
    );
    await user.click(screen.getByRole("button", { name: "Удалить same.mp3" }));
    await user.upload(input, file);

    expect(updates).toHaveBeenNthCalledWith(1, file);
    expect(updates).toHaveBeenNthCalledWith(2, undefined);
    expect(updates).toHaveBeenNthCalledWith(3, file);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("guard-ит change и удаление в disabled состоянии", () => {
    const file = new File(["mp3"], "kept.mp3", { type: "audio/mpeg" });
    const onUpdate = vi.fn();
    renderComponent(
      <AudioUploadField
        label="Аудиофайл"
        value={file}
        disabled
        onUpdate={onUpdate}
      />,
    );
    fireEvent.change(screen.getByLabelText("Аудиофайл"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Удалить kept.mp3" }));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("показывает только имя и размер без media preview или object URL", async () => {
    const createObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    renderComponent(<ControlledField />);
    await userEvent.upload(
      screen.getByLabelText("Аудиофайл"),
      new File(["1234"], "voice.ogg", { type: "audio/ogg" }),
    );

    expect(screen.getByText("voice.ogg")).toBeInTheDocument();
    expect(screen.getByText("1 КБ")).toBeInTheDocument();
    expect(document.querySelector("img, audio")).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("связывает hint и ошибку с native input", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderComponent(<ControlledField />);
    const input = screen.getByLabelText("Аудиофайл");
    expect(input).toHaveAccessibleDescription(
      "MP3 или OGG; загрузится после сохранения.",
    );

    await user.upload(
      input,
      new File(["wav"], "bad.wav", { type: "audio/wav" }),
    );

    expect(input).toHaveAccessibleDescription(
      "MP3 или OGG; загрузится после сохранения. Поддерживаются только MP3 и OGG.",
    );
  });
});
