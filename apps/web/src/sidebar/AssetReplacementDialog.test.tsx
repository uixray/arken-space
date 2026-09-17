// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "../test-support/render";
import { AssetReplacementDialog } from "./AssetReplacementDialog";
import { ApiError } from "../api";
import type { AssetDto } from "@arken/contracts";
const prepare = vi.hoisted(() => vi.fn());
vi.mock("../asset-replacement", () => ({ prepareAssetReplacement: prepare }));
vi.mock("../ui/ArkenDialog", () => ({
  ArkenDialog: ({
    title,
    children,
  }: {
    title: string;
    children: ReactNode;
  }) => (
    <section role="dialog" aria-label={title}>
      {children}
    </section>
  ),
}));
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("../ui/ImageUploadField", () => ({
  ImageUploadField: ({
    label,
    onUpdate,
    disabled,
  }: {
    label: string;
    onUpdate: (file: File) => void;
    disabled: boolean;
  }) => (
    <input
      aria-label={label}
      disabled={disabled}
      type="file"
      onChange={(event) => {
        if (event.target.files?.[0]) onUpdate(event.target.files[0]);
      }}
    />
  ),
}));
vi.mock("../ui/AudioUploadField", () => ({
  AudioUploadField: ({
    label,
    onUpdate,
    disabled,
  }: {
    label: string;
    onUpdate: (file: File) => void;
    disabled: boolean;
  }) => (
    <input
      aria-label={label}
      disabled={disabled}
      type="file"
      onChange={(event) => {
        if (event.target.files?.[0]) onUpdate(event.target.files[0]);
      }}
    />
  ),
}));
const asset = { id: "asset", name: "Карта", kind: "MAP" } as AssetDto;
const intent = {
  assetId: "asset",
  file: new File(["test"], "new.png"),
  version: '"version"',
  actionId: "action",
};
const committed = { asset, version: '"new"', replayed: false };
afterEach(() => {
  vi.resetAllMocks();
});
function setup() {
  prepare.mockResolvedValue(intent);
  const onGetUsage = vi.fn().mockResolvedValue({
    asset,
    inUse: true,
    usages: [
      {
        kind: "SCENE",
        entityId: "scene",
        label: "Сцена",
        location: "Подземелье",
      },
    ],
    hiddenUsageCount: 0,
    canDelete: false,
  });
  const onReplace = vi.fn().mockResolvedValue(committed);
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  renderComponent(
    <AssetReplacementDialog
      asset={asset}
      onGetUsage={onGetUsage}
      onReplace={onReplace}
      onRefresh={onRefresh}
      onClose={onClose}
    />,
  );
  const user = userEvent.setup();
  const review = async () => {
    await user.upload(screen.getByLabelText("Новое изображение"), intent.file);
    await user.click(screen.getByRole("button", { name: "Проверить замену" }));
    await screen.findByText("Сцена · Подземелье");
  };
  return { user, review, onGetUsage, onReplace, onRefresh, onClose };
}
describe("replacement review", () => {
  it("requires review and explicit commit, then never retries a committed replacement after refresh failure", async () => {
    const { user, review, onReplace, onRefresh } = setup();
    onRefresh.mockRejectedValueOnce(new Error("refresh"));
    await review();
    expect(onReplace).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Подтвердить замену" }),
    );
    await screen.findByText(/Не удалось обновить каталог/);
    expect(screen.getByRole("status").textContent).toContain("Файл заменён");
    expect(onReplace).toHaveBeenCalledExactlyOnceWith(intent);
    expect(
      screen.queryByRole("button", {
        name: /Повторить замену|Подтвердить замену/,
      }),
    ).toBeNull();
  });
  it("retains exact intent after an ambiguous failure and retries only on request", async () => {
    const { user, review, onReplace } = setup();
    onReplace.mockRejectedValueOnce(new Error("Нет связи"));
    await review();
    await user.click(
      screen.getByRole("button", { name: "Подтвердить замену" }),
    );
    await screen.findByRole("alert");
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Новое изображение")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Повторить замену" }));
    await screen.findByRole("status");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(onReplace.mock.calls.map((call) => call[0])).toEqual([
      intent,
      intent,
    ]);
  });
  it("requires a fresh review after409 while retaining the file", async () => {
    const { user, review, onReplace } = setup();
    onReplace.mockRejectedValueOnce(
      new ApiError(409, "ASSET_VERSION_CONFLICT", "conflict"),
    );
    await review();
    await user.click(
      screen.getByRole("button", { name: "Подтвердить замену" }),
    );
    await screen.findByText(/Файл уже изменён/);
    expect(
      screen.queryByRole("button", { name: "Повторить замену" }),
    ).toBeNull();
    expect(screen.getByLabelText("Новое изображение")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Проверить замену" }),
    ).toBeEnabled();
    expect(onReplace).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Проверить замену" }));
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    expect(prepare.mock.calls[1]?.[1]).toBe(intent.file);
  });
  it("cancel after reviewing usage never commits", async () => {
    const { user, review, onReplace, onClose } = setup();
    await review();
    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReplace).not.toHaveBeenCalled();
  });
  it("usage failure does not enable commit", async () => {
    const { user, onGetUsage, onReplace } = setup();
    onGetUsage.mockRejectedValueOnce(new Error("Нет доступа"));
    await user.upload(screen.getByLabelText("Новое изображение"), intent.file);
    await user.click(screen.getByRole("button", { name: "Проверить замену" }));
    await screen.findByText("Нет доступа");
    expect(
      screen.queryByRole("button", { name: "Подтвердить замену" }),
    ).toBeNull();
    expect(onReplace).not.toHaveBeenCalled();
  });
});
