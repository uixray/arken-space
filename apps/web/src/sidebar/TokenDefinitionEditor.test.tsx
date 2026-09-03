// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AssetDto, GameSnapshot } from "@arken/contracts";
import { renderComponent, screen, userEvent } from "../test-support/render";

vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    children,
    ...props
  }: {
    children?: ReactNode;
    [key: string]: unknown;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("../ui/ArkenDialog", () => ({
  ArkenDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../ui/GravityFormControls", () => ({
  FormInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  FormSelect: ({
    children,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props}>{children}</select>
  ),
}));
vi.mock("../ui/AssetPicker", () => ({
  AssetPicker: ({
    assets,
    onChange,
  }: {
    assets: AssetDto[];
    onChange: (id: string) => void;
  }) => (
    <div>
      <div data-testid="ready-assets">
        {assets.map((asset) => asset.id).join(",")}
      </div>
      <button type="button" onClick={() => onChange(assets[0]!.id)}>
        Выбрать готовый TOKEN
      </button>
    </div>
  ),
}));
vi.mock("../ui/ImageUploadField", () => ({
  ImageUploadField: ({ onUpdate }: { onUpdate: (file: File) => void }) => (
    <button
      type="button"
      onClick={() => onUpdate(new File(["portrait"], "portrait.png"))}
    >
      Загрузить портрет
    </button>
  ),
}));
vi.mock("../TokenImageGenerator", () => ({
  TokenImageGenerator: ({
    onGenerated,
  }: {
    onGenerated: (asset: AssetDto) => void;
  }) => (
    <button type="button" onClick={() => onGenerated(asset("token", "TOKEN"))}>
      Создать TOKEN
    </button>
  ),
}));

const { TokenDefinitionEditor } = await import("./TokenPalette");

function asset(id: string, kind: AssetDto["kind"]): AssetDto {
  return {
    id,
    kind,
    name: id,
    mimeType: "image/webp",
    sizeBytes: 10,
    width: kind === "IMAGE" ? 800 : 256,
    height: kind === "IMAGE" ? 1200 : 256,
    durationSeconds: null,
    url: `/assets/${id}`,
    createdAt: "2026-09-03T00:00:00.000Z",
  };
}

const snapshot = {
  assets: [asset("source", "IMAGE"), asset("ready", "TOKEN")],
  scenes: [],
  characters: [],
  members: [],
} as unknown as GameSnapshot;

function setup(upload = vi.fn().mockResolvedValue(asset("uploaded", "IMAGE"))) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  renderComponent(
    <TokenDefinitionEditor
      snapshot={snapshot}
      onUpload={upload}
      onGenerateTokenImage={vi.fn()}
      onCancel={vi.fn()}
      onCreate={onCreate}
      onPatch={vi.fn()}
      onReplaceControllers={vi.fn()}
      onOpenCharacters={vi.fn()}
      onOpenMedia={vi.fn()}
    />,
  );
  return onCreate;
}

describe("UIX-611 — IMAGE служит только исходником TOKEN", () => {
  it("не предлагает IMAGE как готовое изображение определения", () => {
    setup();
    expect(screen.getByTestId("ready-assets")).toHaveTextContent("ready");
    expect(screen.getByTestId("ready-assets")).not.toHaveTextContent("source");
  });

  it("не сохраняет загруженный портрет без производного TOKEN", async () => {
    const onCreate = setup();
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(
      screen.getByRole("button", { name: "Загрузить портрет" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(
      await screen.findByText(
        "Обрежьте исходное изображение и создайте TOKEN.",
      ),
    ).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("сохраняет id созданного производного TOKEN", async () => {
    const onCreate = setup();
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(
      screen.getByRole("button", { name: "Загрузить портрет" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Создать TOKEN" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ defaultAssetId: "token" }),
    );
  });

  it("по-прежнему сохраняет уже готовый квадратный TOKEN", async () => {
    const onCreate = setup();
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(screen.getByText("Выбрать готовый TOKEN"));
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ defaultAssetId: "ready" }),
    );
  });

  it("не создаёт определение, если загрузка исходника не удалась", async () => {
    const onCreate = setup(
      vi.fn().mockRejectedValue(new Error("Сбой загрузки")),
    );
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(
      screen.getByRole("button", { name: "Загрузить портрет" }),
    );
    expect(await screen.findByText("Сбой загрузки")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });
});
