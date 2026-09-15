// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderComponent,
  screen,
  userEvent,
} from "../test-support/render";
import { ImageUploadField } from "./ImageUploadField";

vi.mock("@gravity-ui/uikit", () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

function transfer(file: File) {
  return {
    files: [file],
    items: [{ kind: "file", getAsFile: () => file }],
  };
}

function setup(disabled = false) {
  const onUpdate = vi.fn();
  const result = renderComponent(
    <ImageUploadField
      label="Исходник"
      unifiedIntake
      disabled={disabled}
      onUpdate={onUpdate}
    />,
  );
  return { onUpdate, root: result.container.firstElementChild! };
}

function ControlledField({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<File>();
  return (
    <ImageUploadField
      label="Исходник"
      value={value}
      unifiedIntake
      disabled={disabled}
      onUpdate={setValue}
    />
  );
}

const originalCreateUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const originalRevokeUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);

afterAll(() => {
  for (const [key, descriptor] of [
    ["createObjectURL", originalCreateUrl],
    ["revokeObjectURL", originalRevokeUrl],
  ] as const) {
    if (descriptor) Object.defineProperty(URL, key, descriptor);
    else Reflect.deleteProperty(URL, key);
  }
});

beforeEach(() => {
  let nextUrl = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => `blob:intake-preview-${++nextUrl}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

describe("UIX-612 — единый intake изображения", () => {
  it("keeps a named decorative delete icon and the controlled removal callback", () => {
    let view: ReturnType<typeof renderComponent> | undefined;
    try {
      const onUpdate = vi.fn();
      view = renderComponent(
        <ImageUploadField
          label="Исходник"
          value={new File(["image"], "portrait.png", { type: "image/png" })}
          onUpdate={onUpdate}
        />,
      );
      const remove = screen.getByRole("button", {
        name: "Удалить portrait.png",
      });
      expect(
        remove.querySelector("svg.arken-icon"),
        "UIX645_UPLOAD_DELETE_ICON",
      ).toHaveAttribute("aria-hidden", "true");
      fireEvent.click(remove);
      expect(onUpdate).toHaveBeenCalledExactlyOnceWith(undefined);
    } finally {
      view?.unmount();
    }
  });

  it("проводит picker через тот же validation/update путь и очищает native input", async () => {
    const { onUpdate } = setup();
    const file = new File(["image"], "picker.png", { type: "image/png" });
    const input = screen.getByLabelText<HTMLInputElement>("Исходник");
    await userEvent.upload(input, file);
    expect(onUpdate).toHaveBeenCalledWith(file);
    expect(input).toHaveValue("");
    expect(input.files).toHaveLength(0);
  });

  it("после удаления позволяет выбрать тот же File повторно", async () => {
    const onUpdate = vi.fn();
    function Harness() {
      const [value, setValue] = useState<File>();
      return (
        <ImageUploadField
          label="Исходник"
          value={value}
          onUpdate={(file) => {
            onUpdate(file);
            setValue(file);
          }}
        />
      );
    }
    renderComponent(<Harness />);
    const file = new File(["image"], "same.png", { type: "image/png" });
    const input = screen.getByLabelText<HTMLInputElement>("Исходник");

    await userEvent.upload(input, file);
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить same.png" }),
    );
    await userEvent.upload(input, file);

    expect(onUpdate).toHaveBeenNthCalledWith(1, file);
    expect(onUpdate).toHaveBeenNthCalledWith(2, undefined);
    expect(onUpdate).toHaveBeenNthCalledWith(3, file);
  });

  it("позволяет повторно выбрать тот же отклонённый файл", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { onUpdate } = setup();
    const file = new File(["vector"], "same.svg", { type: "image/svg+xml" });
    const input = screen.getByLabelText<HTMLInputElement>("Исходник");
    const change = vi.fn();
    input.addEventListener("change", change);

    await user.upload(input, file);
    await user.upload(input, file);

    expect(change).toHaveBeenCalledTimes(2);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Поддерживаются только PNG, JPEG и WebP.",
    );
    expect(input.files).toHaveLength(0);
  });

  it("cancel сохраняет controlled файл", async () => {
    renderComponent(<ControlledField />);
    const file = new File(["image"], "kept.png", { type: "image/png" });
    const input = screen.getByLabelText<HTMLInputElement>("Исходник");
    await userEvent.upload(input, file);

    fireEvent.change(input, { target: { files: [] } });

    expect(screen.getByText("kept.png")).toBeInTheDocument();
  });

  it("отклоняет change на disabled input на уровне обработчика", () => {
    const { onUpdate } = setup(true);
    const file = new File(["image"], "blocked.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Исходник"), {
      target: { files: [file] },
    });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("удаление очищает ошибку intake и controlled файл", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderComponent(<ControlledField />);
    const input = screen.getByLabelText<HTMLInputElement>("Исходник");
    await user.upload(
      input,
      new File(["image"], "kept.png", { type: "image/png" }),
    );
    await user.upload(
      input,
      new File(["vector"], "bad.svg", { type: "image/svg+xml" }),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Удалить kept.png" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("kept.png")).not.toBeInTheDocument();
  });

  it("балансирует object URL при замене и размонтировании", async () => {
    const result = renderComponent(<ControlledField />);
    const input = screen.getByLabelText<HTMLInputElement>("Исходник");
    await userEvent.upload(
      input,
      new File(["a"], "a.png", { type: "image/png" }),
    );
    await userEvent.upload(
      input,
      new File(["b"], "b.png", { type: "image/png" }),
    );
    result.unmount();

    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenNthCalledWith(
      1,
      "blob:intake-preview-1",
    );
    expect(URL.revokeObjectURL).toHaveBeenNthCalledWith(
      2,
      "blob:intake-preview-2",
    );
  });

  it.each([
    ["image/png", "portrait.png"],
    ["image/jpeg", "portrait.jpg"],
    ["image/webp", "portrait.webp"],
  ])("принимает %s через drop", (type, name) => {
    const { onUpdate, root } = setup();
    const file = new File(["image"], name, { type });
    fireEvent.drop(root, { dataTransfer: transfer(file) });
    expect(onUpdate).toHaveBeenCalledWith(file);
  });

  it("передаёт вставленный файл в тот же onUpdate", () => {
    const { onUpdate, root } = setup();
    const file = new File(["image"], "clipboard.png", { type: "image/png" });
    fireEvent.paste(root, { clipboardData: transfer(file) });
    expect(onUpdate).toHaveBeenCalledWith(file);
  });

  it("отклоняет неподдерживаемый файл до onUpdate", () => {
    const { onUpdate, root } = setup();
    const file = new File(["vector"], "token.svg", { type: "image/svg+xml" });
    fireEvent.drop(root, { dataTransfer: transfer(file) });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Поддерживаются только PNG, JPEG и WebP.",
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("не перехватывает drop и paste в disabled состоянии", () => {
    const { onUpdate, root } = setup(true);
    const file = new File(["image"], "portrait.png", { type: "image/png" });
    expect(fireEvent.drop(root, { dataTransfer: transfer(file) })).toBe(true);
    expect(fireEvent.paste(root, { clipboardData: transfer(file) })).toBe(true);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("устанавливает data-dragover при dragenter и снимает при dragleave", () => {
    const { root } = setup();
    expect(root).not.toHaveAttribute("data-dragover");

    fireEvent.dragEnter(root, {
      dataTransfer: transfer(new File([], "a.png")),
    });
    expect(root).toHaveAttribute("data-dragover", "true");

    fireEvent.dragLeave(root, { relatedTarget: document.body });
    expect(root).not.toHaveAttribute("data-dragover");
  });

  it("открывает выбор файла по клику и клавиатуре на интерактивной дропзоне", () => {
    setup();
    const input = screen.getByLabelText("Исходник");
    const clickSpy = vi.spyOn(input, "click");
    const dropzone = screen.getByRole("button", {
      name: "Выбрать, вставить или перетащить файл",
    });

    fireEvent.click(dropzone);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(dropzone, { key: "Enter" });
    expect(clickSpy).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(dropzone, { key: " " });
    expect(clickSpy).toHaveBeenCalledTimes(3);

    clickSpy.mockRestore();
  });
});
