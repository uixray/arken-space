// @vitest-environment jsdom
import type { ReactNode } from "react";
import type { AssetDto, AssetUsageResponseDto } from "@arken/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
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
// - `@gravity-ui/uikit`'s `Button` ships CSS this repo's Vitest transform
//   can't handle (same constraint as the existing `renderToStaticMarkup`
//   tests, e.g. RollButton.test.tsx) -- swapped for a plain <button>
//   restricted to the props MediaPanel/ImageUploadField actually pass.
// - `ImageUploadField` is swapped for a minimal stub typed against its own
//   exported `ImageUploadFieldProps`, so this file stays focused on
//   MediaPanel's role gating rather than file-input/object-URL plumbing
//   (which is that component's own concern, untouched here).
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    disabled,
    loading,
    onClick,
    children,
  }: {
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
    children?: ReactNode;
  }) => (
    <button disabled={disabled} aria-busy={loading} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("../ui/ImageUploadField", () => ({
  ImageUploadField: ({ label, disabled }: ImageUploadFieldProps) => (
    <div>
      <span>{label}</span>
      <input type="file" aria-label={label} disabled={disabled} readOnly />
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

afterEach(() => vi.restoreAllMocks());

describe("MediaPanel upload sections by role", () => {
  it("offers all five asset kinds -- including GM-only MAP and AUDIO -- to a GM", () => {
    renderComponent(
      <MediaPanel snapshot={gmSnapshot()} {...defaultActions()} />,
    );

    expect(screen.getByText("Карты")).toBeInTheDocument();
    expect(screen.getByText("Изображения токенов")).toBeInTheDocument();
    expect(screen.getByText("Портреты персонажей")).toBeInTheDocument();
    expect(screen.getByText("Другие изображения")).toBeInTheDocument();
    expect(screen.getByText("Музыка и звуки")).toBeInTheDocument();
  });

  it("hides GM-only asset kinds (maps, other images, audio) from a PLAYER", () => {
    renderComponent(
      <MediaPanel snapshot={playerSnapshot()} {...defaultActions()} />,
    );

    expect(screen.getByText("Изображения токенов")).toBeInTheDocument();
    expect(screen.getByText("Портреты персонажей")).toBeInTheDocument();
    expect(screen.queryByText("Карты")).not.toBeInTheDocument();
    expect(screen.queryByText("Другие изображения")).not.toBeInTheDocument();
    expect(screen.queryByText("Музыка и звуки")).not.toBeInTheDocument();
  });

  it("checks usage and deletes an unused asset after confirmation", async () => {
    const actions = defaultActions();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderComponent(
      <MediaPanel snapshot={gmSnapshot({ assets: [asset] })} {...actions} />,
    );

    expect(screen.getByAltText("Превью: Замок.webp")).toBeInTheDocument();
    expect(screen.getByText("IMAGE · 1.0 МБ")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Проверить использование"));
    expect(await screen.findByText("Не используется")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Удалить файл"));
    expect(window.confirm).toHaveBeenCalledWith(
      "Удалить файл «Замок.webp» без возможности отмены?",
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
          location: "Scene",
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
    expect(screen.getByText("Подземелье · Scene")).toBeInTheDocument();
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
