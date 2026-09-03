// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, renderComponent, screen } from "../test-support/render";
import { ImageUploadField } from "./ImageUploadField";

vi.mock("@gravity-ui/uikit", () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  Icon: () => null,
}));
vi.mock("@gravity-ui/icons", () => ({ TrashBin: {} }));

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

describe("UIX-612 — единый intake изображения", () => {
  it("проводит picker через тот же validation/update путь", () => {
    const { onUpdate } = setup();
    const file = new File(["image"], "picker.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Исходник"), {
      target: { files: [file] },
    });
    expect(onUpdate).toHaveBeenCalledWith(file);
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
});
