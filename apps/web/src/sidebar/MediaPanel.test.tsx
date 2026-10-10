// @vitest-environment jsdom
import type { ReactNode } from "react";
import type { AssetDto, AssetUsageResponseDto } from "@arken/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
  within,
} from "../test-support/render";
import {
  gmSnapshot,
  playerSnapshot,
} from "../test-support/game-snapshot-fixtures";
import type { ImageUploadFieldProps } from "../ui/ImageUploadField";

// UIX-383: MediaPanel had no component test at all before this file --
// `allowed` (which asset kinds a member may upload) is exactly the kind of
// role-gated UI the AC asks component tests to cover honestly: GM sees five
// upload sections (including GM-only MAP and AUDIO), a PLAYER sees only two
// (TOKEN, PORTRAIT). Both renders below go through the *same* MediaPanel
// component with a real `GameSnapshot` built by `gmSnapshot()`/
// `playerSnapshot()` -- role flows through `snapshot.me.role` exactly like
// production, not a test-only shortcut. See game-snapshot-fixtures.ts.
//
// Mocking notes (typed against the real prop contracts, per the AC's
// concern about mocks that don't typecheck):
// - This historical role-focused suite keeps a plain Button double restricted
//   to the props it needs. Current vitest.config.ts supports real Gravity CSS;
//   MediaPanel.audio.test.tsx deliberately uses real controls and upload fields.
// - `ImageUploadField` is swapped for a minimal stub typed against its own
//   exported `ImageUploadFieldProps`, so this file stays focused on
//   MediaPanel's role gating rather than file-input/object-URL plumbing.
//   This double must not be used as proof that actual MIME intake works.
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    disabled,
    loading,
    onClick,
    children,
    "aria-describedby": describedBy,
  }: {
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
    children?: ReactNode;
    "aria-describedby"?: string;
  }) => (
    <button
      disabled={disabled}
      aria-busy={loading}
      aria-describedby={describedBy}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));

vi.mock("../ui/ImageUploadField", () => ({
  ImageUploadField: ({ label, disabled, onUpdate }: ImageUploadFieldProps) => (
    <div>
      <span>{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onUpdate(new File(["file"], `${label}.png`))}
      >
        Выбрать файл: {label}
      </button>
    </div>
  ),
}));

const { MediaPanel } = await import("./MediaPanel");

const asset: AssetDto = {
  id: "00000000-0000-4000-8000-000000000610",
  kind: "IMAGE",
  name: "Замок.webp",
  mimeType: "image/webp",
  sizeBytes: 1024 * 1024,
  width: 800,
  height: 600,
  durationSeconds: null,
  url: "/api/assets/00000000-0000-4000-8000-000000000610/content",
  createdAt: new Date(0).toISOString(),
};

const unused: AssetUsageResponseDto = {
  asset,
  inUse: false,
  usages: [],
  hiddenUsageCount: 0,
  canDelete: true,
  deletionBlockedReason: null,
};

const defaultActions = () => ({
  onUpload: vi.fn(),
  onGetUsage: vi.fn().mockResolvedValue(unused),
  onDelete: vi.fn().mockResolvedValue({
    assetId: asset.id,
    deleted: true,
    blobCleanupPending: false,
  }),
});

function queryUploadSection(label: string) {
  const control =
    label === "Музыка и звуки"
      ? screen.queryByLabelText(label)
      : screen.queryByRole("button", { name: `Выбрать файл: ${label}` });
  return control?.closest(".upload-section") ?? null;
}

afterEach(() => vi.restoreAllMocks());

describe("MediaPanel upload sections by role", () => {
  it.each(["GM", "PLAYER"] as const)(
    "renders Russian types for all five visible asset kinds for %s without changing names or actions",
    (role) => {
      const examples = [
        ["MAP", "Карта", "Карты", "North Gate.webp"],
        [
          "TOKEN",
          "Изображение токена",
          "Изображения токенов",
          "ranger-token.webp",
        ],
        ["PORTRAIT", "Портрет персонажа", "Портреты персонажей", "Elena.webp"],
        ["IMAGE", "Изображение", "Другие изображения", "Замок.webp"],
        ["AUDIO", "Фоновая музыка", "Музыка и звуки", "Moonlight.ogg"],
      ] as const;
      // These DTOs represent already-visible shared assets, not a claim that
      // PLAYER can see every asset stored by the GM. Server filtering is unchanged.
      const visibleAssets: AssetDto[] = examples.map(
        ([kind, , , name], index) => ({
          ...asset,
          id: `00000000-0000-4000-8000-0000000006${index + 20}`,
          kind,
          name,
          mimeType: kind === "AUDIO" ? "audio/ogg" : "image/webp",
          width: kind === "AUDIO" ? null : asset.width,
          height: kind === "AUDIO" ? null : asset.height,
          durationSeconds: kind === "AUDIO" ? 30 : null,
        }),
      );
      const actions = defaultActions();
      const buildSnapshot = role === "GM" ? gmSnapshot : playerSnapshot;
      renderComponent(
        <MediaPanel
          snapshot={buildSnapshot({ assets: visibleAssets })}
          {...actions}
        />,
      );

      for (const [kind, label, uploadLabel, name] of examples) {
        const row = screen.getByText(name).closest(".asset-row");
        expect(row).not.toBeNull();
        expect(
          within(row as HTMLElement).getByText(`${label} · 1.0 МБ`),
        ).toBeInTheDocument();
        expect(screen.queryByText(`${kind} · 1.0 МБ`)).not.toBeInTheDocument();
        if (kind !== "AUDIO")
          expect(screen.getByAltText(`Превью: ${name}`)).toBeInTheDocument();
        const uploadSection = queryUploadSection(uploadLabel);
        if (role === "GM" || kind === "TOKEN" || kind === "PORTRAIT")
          expect(uploadSection).not.toBeNull();
        else expect(uploadSection).toBeNull();
      }
      expect(screen.getByLabelText("Аудиофайл")).toHaveTextContent("Аудиофайл");
      expect(screen.queryByText("AUDIO")).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Загрузить" })).toHaveLength(
        role === "GM" ? 5 : 2,
      );
      expect(
        screen.queryAllByRole("button", { name: "Проверить использование" }),
      ).toHaveLength(role === "GM" ? 5 : 0);
      expect(
        screen.queryByRole("button", { name: "Удалить файл" }),
      ).not.toBeInTheDocument();
      expect(actions.onUpload).not.toHaveBeenCalled();
      expect(actions.onGetUsage).not.toHaveBeenCalled();
      expect(actions.onDelete).not.toHaveBeenCalled();
      if (role === "GM")
        expect(
          screen.getByRole("heading", { name: "Пак кампании" }),
        ).toBeInTheDocument();
      else
        expect(
          screen.queryByRole("heading", { name: "Пак кампании" }),
        ).toBeNull();
    },
  );

  it("offers all five asset kinds -- including GM-only MAP and AUDIO -- to a GM", () => {
    renderComponent(
      <MediaPanel snapshot={gmSnapshot()} {...defaultActions()} />,
    );

    for (const label of [
      "Карты",
      "Изображения токенов",
      "Портреты персонажей",
      "Другие изображения",
      "Музыка и звуки",
    ]) {
      const section = queryUploadSection(label);
      expect(section).not.toBeNull();
      expect(
        within(section as HTMLElement).getByRole("button", {
          name: "Загрузить",
        }),
      ).toBeInTheDocument();
    }
  });

  it("hides GM-only asset kinds (maps, other images, audio) from a PLAYER", () => {
    renderComponent(
      <MediaPanel snapshot={playerSnapshot()} {...defaultActions()} />,
    );

    expect(queryUploadSection("Изображения токенов")).not.toBeNull();
    expect(queryUploadSection("Портреты персонажей")).not.toBeNull();
    for (const label of ["Карты", "Другие изображения", "Музыка и звуки"])
      expect(queryUploadSection(label)).toBeNull();
  });

  it("groups assets by type, filters to one exact type, and restores all groups", async () => {
    const token = {
      ...asset,
      id: "token-asset",
      kind: "TOKEN" as const,
      name: "Токен.webp",
    };
    const portrait = {
      ...asset,
      id: "portrait-asset",
      kind: "PORTRAIT" as const,
      name: "Портрет.webp",
    };
    renderComponent(
      <MediaPanel
        snapshot={gmSnapshot({ assets: [asset, token, portrait] })}
        {...defaultActions()}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Файлы: Другие изображения" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Файлы: Изображения токенов" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Файлы: Портреты персонажей" }),
    ).toBeInTheDocument();

    const filter = screen.getByRole("combobox", {
      name: "Фильтр файлов по типу",
    });
    await userEvent.selectOptions(filter, "TOKEN");
    expect(screen.getByText("Токен.webp")).toBeInTheDocument();
    expect(screen.queryByText("Замок.webp")).not.toBeInTheDocument();
    expect(screen.queryByText("Портрет.webp")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Файлы: Изображения токенов" }),
    ).toBeInTheDocument();

    await userEvent.selectOptions(filter, "ALL");
    expect(screen.getByText("Замок.webp")).toBeInTheDocument();
    expect(screen.getByText("Токен.webp")).toBeInTheDocument();
    expect(screen.getByText("Портрет.webp")).toBeInTheDocument();
  });

  it("shows an explicit empty-catalog and filtered-empty state", async () => {
    const { rerender } = renderComponent(
      <MediaPanel
        snapshot={gmSnapshot({ assets: [] })}
        {...defaultActions()}
      />,
    );
    expect(screen.getByText("Файлов пока нет.")).toBeInTheDocument();
    rerender(
      <MediaPanel
        snapshot={gmSnapshot({ assets: [asset] })}
        {...defaultActions()}
      />,
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Фильтр файлов по типу" }),
      "AUDIO",
    );
    expect(
      screen.getByText("Нет файлов типа «Музыка и звуки»."),
    ).toBeInTheDocument();
  });

  it.each([
    ["GM", gmSnapshot],
    ["PLAYER", playerSnapshot],
  ] as const)(
    "explains upload intent and sends the chosen kind for %s",
    async (_role, buildSnapshot) => {
      const onUpload = vi.fn().mockResolvedValue(asset);
      renderComponent(
        <MediaPanel
          snapshot={buildSnapshot()}
          {...defaultActions()}
          onUpload={onUpload}
        />,
      );

      expect(
        screen.getAllByText(/Загрузка не прикрепляет файл автоматически\./),
      ).toHaveLength(_role === "GM" ? 5 : 2);
      const tokenSection = screen
        .getByRole("button", {
          name: "Выбрать файл: Изображения токенов",
        })
        .closest(".upload-section");
      expect(tokenSection).not.toBeNull();
      await userEvent.click(
        within(tokenSection as HTMLElement).getByRole("button", {
          name: "Выбрать файл: Изображения токенов",
        }),
      );
      await userEvent.click(
        within(tokenSection as HTMLElement).getByRole("button", {
          name: "Загрузить",
        }),
      );
      expect(onUpload).toHaveBeenCalledWith(expect.any(File), "TOKEN", undefined);
    },
  );

  it("объясняет состояния недоступной загрузки видимым текстом", async () => {
    let finishUpload!: (uploaded: AssetDto) => void;
    const onUpload = vi.fn(
      () =>
        new Promise<AssetDto>((resolve) => {
          finishUpload = resolve;
        }),
    );
    renderComponent(
      <MediaPanel
        snapshot={playerSnapshot()}
        {...defaultActions()}
        onUpload={onUpload}
      />,
    );
    const tokenUpload = screen.getAllByRole("button", {
      name: "Загрузить",
    })[0]!;
    expect(tokenUpload).toBeDisabled();
    expect(tokenUpload).toHaveAccessibleDescription("Сначала выберите файл.");

    await userEvent.click(
      screen.getByRole("button", {
        name: "Выбрать файл: Изображения токенов",
      }),
    );
    expect(tokenUpload).toBeEnabled();
    expect(tokenUpload).toHaveAccessibleDescription("Файл готов к загрузке.");

    await userEvent.click(tokenUpload);
    expect(tokenUpload).toBeDisabled();
    expect(tokenUpload).toHaveAccessibleDescription("Файл загружается.");
    expect(
      screen.getAllByRole("button", { name: "Загрузить" })[1],
    ).toHaveAccessibleDescription("Дождитесь завершения другой загрузки.");
    finishUpload(asset);
    await waitFor(() =>
      expect(tokenUpload).toHaveAccessibleDescription("Сначала выберите файл."),
    );
    expect(tokenUpload).toBeDisabled();
  });

  it("checks usage and deletes an unused asset after confirmation", async () => {
    const actions = defaultActions();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderComponent(
      <MediaPanel snapshot={gmSnapshot({ assets: [asset] })} {...actions} />,
    );

    expect(screen.getByAltText("Превью: Замок.webp")).toBeInTheDocument();
    expect(screen.getByText("Изображение · 1.0 МБ")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Проверить использование"));
    expect(await screen.findByText("Не используется")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Удалить файл"));
    expect(window.confirm).toHaveBeenCalledWith(
      "Удалить файл «Замок.webp» без возможности отмены?",
    );
    expect(actions.onDelete).toHaveBeenCalledWith(asset.id);
  });

  it("warns before detaching shared world-content references", async () => {
    const actions = defaultActions();
    actions.onGetUsage.mockResolvedValue({
      ...unused,
      inUse: true,
      usages: [
        {
          kind: "WORLD_CONTENT_COVER",
          entityId: "world-1",
          label: "Локация",
          location: "Обложка материала мира",
          visibility: "GM_ONLY",
          deletionPolicy: "DETACH",
        },
      ],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderComponent(<MediaPanel snapshot={gmSnapshot({ assets: [asset] })} {...actions} />);
    await userEvent.click(screen.getByText("Проверить использование"));
    await userEvent.click(await screen.findByText("Удалить файл"));
    expect(window.confirm).toHaveBeenCalledWith(
      "Отвязать 1 связей и удалить файл «Замок.webp» без возможности отмены? Материалы мира сохранятся; их обложки и файлы будут отвязаны. Материалов мира: 1.",
    );
    expect(actions.onDelete).toHaveBeenCalledWith(asset.id);
  });

  it("shows exact usage and does not offer force-delete", async () => {
    const blocked: AssetUsageResponseDto = {
      ...unused,
      inUse: true,
      canDelete: false,
      deletionBlockedReason: "ASSET_IN_USE",
      usages: [
        {
          kind: "SCENE_BACKGROUND",
          entityId: "scene-1",
          label: "Подземелье",
          location: "Сцена",
          visibility: "GM_ONLY",
          deletionPolicy: "BLOCK",
        },
      ],
    };
    const actions = defaultActions();
    actions.onGetUsage.mockResolvedValue(blocked);
    renderComponent(
      <MediaPanel snapshot={gmSnapshot({ assets: [asset] })} {...actions} />,
    );

    await userEvent.click(screen.getByText("Проверить использование"));
    expect(await screen.findByText("Используется: 1")).toBeInTheDocument();
    expect(screen.getByText("Подземелье · Сцена")).toBeInTheDocument();
    expect(
      screen.getByText("Удаление заблокировано: файл используется."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Удалить файл")).not.toBeInTheDocument();
  });

  it("does not delete when confirmation is cancelled", async () => {
    const actions = defaultActions();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderComponent(
      <MediaPanel snapshot={gmSnapshot({ assets: [asset] })} {...actions} />,
    );

    await userEvent.click(screen.getByText("Проверить использование"));
    await userEvent.click(await screen.findByText("Удалить файл"));
    expect(actions.onDelete).not.toHaveBeenCalled();
  });

  it("keeps the row and explains a server deletion failure", async () => {
    const actions = defaultActions();
    actions.onDelete.mockRejectedValue(new Error("Сервер недоступен"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderComponent(
      <MediaPanel snapshot={gmSnapshot({ assets: [asset] })} {...actions} />,
    );

    await userEvent.click(screen.getByText("Проверить использование"));
    await userEvent.click(await screen.findByText("Удалить файл"));
    expect(await screen.findByText("Сервер недоступен")).toBeInTheDocument();
    expect(screen.getByText("Замок.webp")).toBeInTheDocument();
    await waitFor(() => expect(actions.onGetUsage).toHaveBeenCalledTimes(1));
  });
});
