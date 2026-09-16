// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  AssetDto,
  GameSnapshot,
  TokenDefinitionDto,
} from "@arken/contracts";
import {
  act,
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "../test-support/render";

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
    onDraftChange,
  }: {
    onDraftChange?: (draft: {
      sourceAssetId: string;
      cropX: number;
      cropY: number;
      zoom: number;
      frame: "NONE";
      name: string;
    }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onDraftChange?.({
          sourceAssetId: "uploaded",
          cropX: 0.5,
          cropY: 0.5,
          zoom: 1,
          frame: "NONE",
          name: "portrait",
        })
      }
    >
      Выбрать crop загруженного портрета
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

function setup(
  upload = vi.fn().mockResolvedValue(asset("uploaded", "IMAGE")),
  snapshotOverride = snapshot,
  createAndPlace = vi.fn().mockResolvedValue(undefined),
  onGenerateTokenImage = vi.fn().mockResolvedValue(asset("token", "TOKEN")),
  onCreate = vi.fn().mockResolvedValue(undefined),
  onCancel = vi.fn(),
  definition?: TokenDefinitionDto,
) {
  const onCreateAndPlace = createAndPlace;
  const onPatch = vi.fn().mockResolvedValue(undefined);
  const onReplaceControllers = vi.fn().mockResolvedValue(undefined);
  renderComponent(
    <TokenDefinitionEditor
      snapshot={snapshotOverride}
      definition={definition}
      onUpload={upload}
      onGenerateTokenImage={onGenerateTokenImage}
      onCancel={onCancel}
      onCreate={onCreate}
      onCreateAndPlace={onCreateAndPlace}
      onPatch={onPatch}
      onReplaceControllers={onReplaceControllers}
      onOpenCharacters={vi.fn()}
      onOpenMedia={vi.fn()}
    />,
  );
  return {
    onCreate,
    onCreateAndPlace,
    onGenerateTokenImage,
    onCancel,
    onPatch,
    onReplaceControllers,
  };
}

describe("UIX-611 — IMAGE служит только исходником TOKEN", () => {
  it("не предлагает IMAGE как готовое изображение определения", () => {
    setup();
    expect(screen.getByTestId("ready-assets")).toHaveTextContent("ready");
    expect(screen.getByTestId("ready-assets")).not.toHaveTextContent("source");
  });

  it("одним сохранением создаёт производный TOKEN и определение", async () => {
    const { onCreate, onGenerateTokenImage } = setup();
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(
      screen.getByRole("button", { name: "Загрузить портрет" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Выбрать crop загруженного портрета",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(onGenerateTokenImage).toHaveBeenCalledWith(
        {
          sourceAssetId: "uploaded",
          cropX: 0.5,
          cropY: 0.5,
          zoom: 1,
          frame: "NONE",
          name: "portrait",
        },
        { actionId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      ),
    );
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ defaultAssetId: "token" }),
    );
  });

  it("по-прежнему сохраняет уже готовый квадратный TOKEN", async () => {
    const { onCreate, onCreateAndPlace, onGenerateTokenImage } = setup();
    expect(
      screen.queryByRole("button", { name: "Создать и поставить" }),
    ).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(screen.getByText("Выбрать готовый TOKEN"));
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ defaultAssetId: "ready" }),
    );
    expect(onCreateAndPlace).not.toHaveBeenCalled();
    expect(onGenerateTokenImage).not.toHaveBeenCalled();
  });

  it("preserves an existing definition TOKEN on name-only Save", async () => {
    const definition: TokenDefinitionDto = {
      id: "existing-definition",
      name: "Старое имя",
      ownName: "Старое имя",
      characterId: null,
      defaultAssetId: "ready",
      defaultWidth: 64,
      defaultHeight: 64,
      controllerMembershipIds: [],
      revision: 3,
    };
    const { onPatch, onGenerateTokenImage, onCreate, onCreateAndPlace } = setup(
      undefined,
      snapshot,
      undefined,
      undefined,
      undefined,
      undefined,
      definition,
    );
    const name = screen.getByLabelText("Название");
    await userEvent.clear(name);
    await userEvent.type(name, "Новое имя");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith(
        definition.id,
        definition.revision,
        expect.objectContaining({
          name: "Новое имя",
          defaultAssetId: "ready",
          controllerMembershipIds: [],
        }),
        {
          actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          refresh: true,
          errorOwner: "caller",
        },
      ),
    );
    expect(onGenerateTokenImage).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
    expect(onCreateAndPlace).not.toHaveBeenCalled();
  });

  it("retries the same atomic edit command after a failed PATCH", async () => {
    const definition: TokenDefinitionDto = {
      id: "existing-definition",
      name: "Старое имя",
      ownName: "Старое имя",
      characterId: null,
      defaultAssetId: "ready",
      defaultWidth: 64,
      defaultHeight: 64,
      controllerMembershipIds: [],
      revision: 3,
    };
    const onPatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Сеть прервана"))
      .mockResolvedValueOnce(undefined);
    // The real editor's command remains mounted after a caller-owned error;
    // retry must replay its exact PATCH body/action id, not issue a second
    // controller PUT or advance a local revision.
    renderComponent(
      <TokenDefinitionEditor
        snapshot={snapshot}
        definition={definition}
        onUpload={vi.fn()}
        onGenerateTokenImage={vi.fn()}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
        onCreateAndPlace={vi.fn()}
        onPatch={onPatch}
        onReplaceControllers={vi.fn()}
        onOpenCharacters={vi.fn()}
        onOpenMedia={vi.fn()}
      />,
    );
    const name = screen.getByLabelText("Название");
    await userEvent.clear(name);
    await userEvent.type(name, "Новое имя");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сеть прервана");
    expect(screen.getByLabelText("Название")).toHaveValue("Новое имя");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(2));
    expect(onPatch.mock.calls[1]).toEqual(onPatch.mock.calls[0]);
  });

  it("does not close again after cancellation and a late atomic PATCH", async () => {
    const definition: TokenDefinitionDto = {
      id: "existing-definition",
      name: "Старое имя",
      ownName: "Старое имя",
      characterId: null,
      defaultAssetId: "ready",
      defaultWidth: 64,
      defaultHeight: 64,
      controllerMembershipIds: [],
      revision: 3,
    };
    let resolvePatch!: () => void;
    const onPatch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePatch = resolve;
        }),
    );
    const onCancel = vi.fn();
    renderComponent(
      <TokenDefinitionEditor
        snapshot={snapshot}
        definition={definition}
        onUpload={vi.fn()}
        onGenerateTokenImage={vi.fn()}
        onCancel={onCancel}
        onCreate={vi.fn()}
        onCreateAndPlace={vi.fn()}
        onPatch={onPatch}
        onReplaceControllers={vi.fn()}
        onOpenCharacters={vi.fn()}
        onOpenMedia={vi.fn()}
      />,
    );
    const name = screen.getByLabelText("Название");
    await userEvent.clear(name);
    await userEvent.type(name, "Новое имя");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledOnce());
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    await act(async () => resolvePatch());
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not create a definition when the embedded generation fails", async () => {
    const onGenerateTokenImage = vi
      .fn()
      .mockRejectedValue(new Error("Генерация отклонена"));
    const { onCreate } = setup(
      undefined,
      snapshot,
      undefined,
      onGenerateTokenImage,
    );
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(
      screen.getByRole("button", { name: "Загрузить портрет" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Выбрать crop загруженного портрета",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Генерация отклонена",
    );
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("reuses the generation action id after a generation rejection", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("Временный сбой"))
      .mockResolvedValueOnce(asset("token", "TOKEN"));
    const { onCreate } = setup(undefined, snapshot, undefined, generate);
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(
      screen.getByRole("button", { name: "Загрузить портрет" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Выбрать crop загруженного портрета",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Временный сбой",
    );
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[1]).toEqual(generate.mock.calls[0]?.[1]);
  });

  it("cancels a held generation without creating a definition", async () => {
    let resolveGeneration!: (value: AssetDto) => void;
    const onGenerateTokenImage = new Promise<AssetDto>((resolve) => {
      resolveGeneration = resolve;
    });
    const generate = vi.fn().mockReturnValue(onGenerateTokenImage);
    const { onCreate, onCancel } = setup(
      undefined,
      snapshot,
      undefined,
      generate,
    );
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(
      screen.getByRole("button", { name: "Загрузить портрет" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Выбрать crop загруженного портрета",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(generate).toHaveBeenCalledOnce());
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    resolveGeneration(asset("late-token", "TOKEN"));
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("reuses a matching generated derivative after definition save failure", async () => {
    const generate = vi.fn().mockResolvedValue(asset("token", "TOKEN"));
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error("Сохранение отклонено"))
      .mockResolvedValueOnce(undefined);
    setup(undefined, snapshot, undefined, generate, onCreate);
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(
      screen.getByRole("button", { name: "Загрузить портрет" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Выбрать crop загруженного портрета",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Сохранение отклонено",
    );
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    expect(generate).toHaveBeenCalledOnce();
  });

  it("не создаёт определение, если загрузка исходника не удалась", async () => {
    const { onCreate } = setup(
      vi.fn().mockRejectedValue(new Error("Сбой загрузки")),
    );
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(
      screen.getByRole("button", { name: "Загрузить портрет" }),
    );
    expect(await screen.findByText("Сбой загрузки")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("создаёт и ставит токен одним действием на активной сцене", async () => {
    const activeSnapshot = {
      ...snapshot,
      scenes: [
        {
          id: "scene",
          active: true,
          grid: { enabled: false, size: 64 },
        },
      ],
    } as unknown as GameSnapshot;
    const { onCreate, onCreateAndPlace } = setup(undefined, activeSnapshot);
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(screen.getByText("Выбрать готовый TOKEN"));
    await userEvent.click(
      screen.getByRole("button", { name: "Создать и поставить" }),
    );
    expect(onCreateAndPlace).toHaveBeenCalledWith(
      expect.objectContaining({ defaultAssetId: "ready" }),
    );
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("оставляет форму открытой при отказе create-and-place", async () => {
    const activeSnapshot = {
      ...snapshot,
      scenes: [
        {
          id: "scene",
          active: true,
          grid: { enabled: false, size: 64 },
        },
      ],
    } as unknown as GameSnapshot;
    setup(
      undefined,
      activeSnapshot,
      vi.fn().mockRejectedValue(new Error("Сцена недоступна")),
    );
    await userEvent.type(screen.getByLabelText("Название"), "Страж");
    await userEvent.click(screen.getByText("Выбрать готовый TOKEN"));
    await userEvent.click(
      screen.getByRole("button", { name: "Создать и поставить" }),
    );
    expect(await screen.findByText("Сцена недоступна")).toBeInTheDocument();
    expect(screen.getByLabelText("Название")).toHaveValue("Страж");
  });
});
