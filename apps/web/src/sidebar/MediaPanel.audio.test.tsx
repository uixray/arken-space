// @vitest-environment jsdom
import { ThemeProvider } from "@gravity-ui/uikit";
import type { AssetDto } from "@arken/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent, waitFor, within } from "../test-support/render";
import { gmSnapshot, playerSnapshot } from "../test-support/game-snapshot-fixtures";
import { MediaPanel } from "./MediaPanel";
import type { AssetActions } from "../use-asset-actions";

// Both upload fields and Gravity controls are real. Mock only the server actions.
beforeEach(() => vi.stubGlobal("matchMedia", (media: string) => ({
  matches: false, media, onchange: null,
  addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {}, dispatchEvent: () => true,
})));
afterEach(() => vi.unstubAllGlobals());

const asset: AssetDto = {
  id: "f1be0001-1111-4111-8111-111111111111",
  kind: "AUDIO",
  name: "Тема стража.mp3",
  mimeType: "audio/mpeg",
  sizeBytes: 128,
  width: null,
  height: null,
  durationSeconds: 2,
  url: "/api/assets/f1be0001-1111-4111-8111-111111111111/content",
  createdAt: new Date(0).toISOString(),
};

function setup(
  onUpload: AssetActions["uploadAsset"] = vi.fn().mockResolvedValue(asset),
  player = false,
) {
  renderComponent(
    <ThemeProvider theme="dark" lang="ru">
      <MediaPanel
        snapshot={player ? playerSnapshot() : gmSnapshot()}
        onUpload={onUpload}
        onGetUsage={vi.fn()}
        onDelete={vi.fn()}
      />
    </ThemeProvider>,
  );
  return onUpload;
}

it.each([
  ["theme.mp3", "audio/mpeg"],
  ["theme.ogg", "audio/ogg"],
  ["theme.ogg", "application/ogg"],
])("GM passes the original %s (%s) file to AUDIO upload, not image intake", async (name, type) => {
  let resolve!: (value: AssetDto) => void;
  const onUpload = vi.fn(() => new Promise<AssetDto>((done) => { resolve = done; }));
  setup(onUpload);
  const user = userEvent.setup();
  const input = screen.getByLabelText<HTMLInputElement>("Музыка и звуки");
  const section = input.closest(".upload-section") as HTMLElement;
  const upload = within(section).getByRole("button", { name: "Загрузить", exact: true });
  const file = new File(["synthetic audio candidate"], name, { type });
  await user.upload(input, file);
  expect(input).toHaveValue("");
  expect(upload).toBeEnabled();
  expect(upload).toHaveAccessibleDescription("Файл готов к загрузке.");
  expect(section.querySelector("img, audio, video")).toBeNull();
  expect(onUpload).not.toHaveBeenCalled();
  await user.click(upload);
  expect(onUpload).toHaveBeenCalledTimes(1);
  expect(onUpload).toHaveBeenCalledWith(file, "AUDIO");
  expect(input).toBeDisabled();
  expect(upload).toBeDisabled();
  expect(upload).toHaveAccessibleDescription("Файл загружается.");
  resolve({ ...asset, name, mimeType: type });
  await waitFor(() => expect(input).not.toBeDisabled());
  expect(within(section).queryByText(name)).not.toBeInTheDocument();
  expect(upload).toBeDisabled();
});

it("keeps the audio candidate for retry after a server rejection", async () => {
  const onUpload = setup(vi.fn()
    .mockRejectedValueOnce(new Error("Аудиофайл повреждён."))
    .mockResolvedValueOnce(asset));
  const user = userEvent.setup();
  const input = screen.getByLabelText<HTMLInputElement>("Музыка и звуки");
  const section = input.closest(".upload-section") as HTMLElement;
  const upload = within(section).getByRole("button", { name: "Загрузить", exact: true });
  const file = new File(["candidate"], "retry.mp3", { type: "audio/mpeg" });
  await user.upload(input, file);
  await user.click(upload);
  await screen.findByText("Аудиофайл повреждён.");
  expect(within(section).getByText(file.name)).toBeInTheDocument();
  expect(upload).toBeEnabled();
  await user.click(upload);
  await waitFor(() => expect(within(section).queryByText(file.name)).not.toBeInTheDocument());
  expect(onUpload).toHaveBeenNthCalledWith(1, file, "AUDIO");
  expect(onUpload).toHaveBeenNthCalledWith(2, file, "AUDIO");
});

it("keeps AUDIO creation unavailable to PLAYER in the actual caller", () => {
  const onUpload = setup(undefined, true);
  expect(screen.queryByLabelText("Музыка и звуки")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Изображения токенов")).toBeInTheDocument();
  expect(screen.getByLabelText("Портреты персонажей")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Загрузить", exact: true })).toHaveLength(2);
  expect(onUpload).not.toHaveBeenCalled();
});
