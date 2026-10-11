// @vitest-environment jsdom
import { ThemeProvider } from "@gravity-ui/uikit";
import type { AssetDto } from "@arken/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
import { MediaPanel } from "./MediaPanel";
import type { AssetActions } from "../use-asset-actions";

// Both upload fields and Gravity controls are real. Mock only the server actions.
beforeEach(() =>
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  })),
);
afterEach(() => vi.unstubAllGlobals());

const asset: AssetDto = {
  id: "f1be0001-1111-4111-8111-111111111111",
  kind: "AUDIO",
  audioPurpose: "MUSIC",
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
  assets: AssetDto[] = [asset],
  onRefresh?: AssetActions["refreshAssets"],
) {
  renderComponent(
    <ThemeProvider theme="dark" lang="ru">
      <MediaPanel
        snapshot={{ ...(player ? playerSnapshot() : gmSnapshot()), assets }}
        onUpload={onUpload}
        onGetUsage={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={onRefresh}
      />
    </ThemeProvider>,
  );
  return onUpload;
}

it("groups mixed-purpose audio under both library headings and allows explicit purpose change", async () => {
  const soundEffect = { ...asset, id: "sound-effect", name: "effect.mp3", audioPurpose: "SOUND_EFFECT" as const };
  const both = { ...asset, id: "both-purpose", name: "both.mp3", audioPurpose: "BOTH" as const };
  const music = { ...asset, id: "music-only", name: "music.mp3", audioPurpose: "MUSIC" as const };
  const refresh = vi.fn().mockResolvedValue(undefined);
  const fetchMock = vi.fn().mockImplementation((url: string) =>
    Promise.resolve(new Response(url === "/api/gm/sticker-packs" || url === "/api/gm/global-sticker-packs" ? "[]" : "{}", { status: 200 })),
  );
  vi.stubGlobal("fetch", fetchMock);
  setup(vi.fn(), false, [soundEffect, both, music], refresh);

  expect(screen.getByRole("region", { name: "Файлы: Фоновая музыка" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Файлы: Звуковые эффекты" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Файлы: Фоновая музыка" })).toHaveTextContent("both.mp3");
  expect(screen.getByRole("region", { name: "Файлы: Фоновая музыка" })).toHaveTextContent("music.mp3");
  expect(within(screen.getByRole("region", { name: "Файлы: Фоновая музыка" })).queryByText("effect.mp3")).not.toBeInTheDocument();
  await userEvent.setup().selectOptions(screen.getByLabelText("Назначение аудио: effect.mp3"), "MUSIC");
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === `/api/assets/${soundEffect.id}/audio-purpose`)).toBe(true));
  const [url, init] = fetchMock.mock.calls.find(([candidate]) => candidate === `/api/assets/${soundEffect.id}/audio-purpose`) as [string, RequestInit];
  expect(url).toBe(`/api/assets/${soundEffect.id}/audio-purpose`);
  expect(init.method).toBe("PATCH");
  expect(JSON.parse(String(init.body))).toEqual({ actionId: expect.any(String), audioPurpose: "MUSIC" });
  expect(refresh).toHaveBeenCalledTimes(1);
});

it.each([
  ["theme.mp3", "audio/mpeg"],
  ["theme.ogg", "audio/ogg"],
  ["theme.ogg", "application/ogg"],
])(
  "GM passes the original %s (%s) file to AUDIO upload, not image intake",
  async (name, type) => {
    let resolve!: (value: AssetDto) => void;
    const onUpload = vi.fn(
      () =>
        new Promise<AssetDto>((done) => {
          resolve = done;
        }),
    );
    setup(onUpload);
    const user = userEvent.setup();
    const input = screen.getByLabelText<HTMLInputElement>("Музыка и звуки");
    const section = input.closest(".upload-section") as HTMLElement;
    const upload = within(section).getByRole("button", {
      name: "Загрузить",
    });
    const file = new File(["synthetic audio candidate"], name, { type });
    await user.upload(input, file);
    await user.selectOptions(screen.getByLabelText("Назначение аудиофайла"), "MUSIC");
    expect(input).toHaveValue("");
    expect(upload).toBeEnabled();
    expect(upload).toHaveAccessibleDescription("Файл готов к загрузке.");
    expect(section.querySelector("img, audio, video")).toBeNull();
    const remove = within(section).getByRole("button", {
      name: `Удалить ${name}`,
    });
    expect(remove.querySelector("svg.arken-icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(onUpload).not.toHaveBeenCalled();
    await user.click(upload);
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload).toHaveBeenCalledWith(file, "AUDIO", { audioPurpose: "MUSIC" });
    expect(input).toBeDisabled();
    expect(remove).toBeDisabled();
    expect(upload).toBeDisabled();
    expect(upload).toHaveAccessibleDescription("Файл загружается.");
    resolve({ ...asset, name, mimeType: type });
    await waitFor(() => expect(input).not.toBeDisabled());
    expect(within(section).queryByText(name)).not.toBeInTheDocument();
    expect(upload).toBeDisabled();
  },
);

it("keeps the audio candidate for retry after a server rejection", async () => {
  const onUpload = setup(
    vi
      .fn()
      .mockRejectedValueOnce(new Error("Аудиофайл повреждён."))
      .mockResolvedValueOnce(asset),
  );
  const user = userEvent.setup();
  const input = screen.getByLabelText<HTMLInputElement>("Музыка и звуки");
  const section = input.closest(".upload-section") as HTMLElement;
  const upload = within(section).getByRole("button", {
    name: "Загрузить",
  });
  const file = new File(["candidate"], "retry.mp3", { type: "audio/mpeg" });
  await user.upload(input, file);
  await user.selectOptions(screen.getByLabelText("Назначение аудиофайла"), "SOUND_EFFECT");
  await user.click(upload);
  await screen.findByText("Аудиофайл повреждён.");
  expect(within(section).getByText(file.name)).toBeInTheDocument();
  expect(upload).toBeEnabled();
  await user.click(upload);
  await waitFor(() =>
    expect(within(section).queryByText(file.name)).not.toBeInTheDocument(),
  );
  expect(onUpload).toHaveBeenNthCalledWith(1, file, "AUDIO", { audioPurpose: "SOUND_EFFECT" });
  expect(onUpload).toHaveBeenNthCalledWith(2, file, "AUDIO", { audioPurpose: "SOUND_EFFECT" });
});

it("keeps AUDIO creation unavailable to PLAYER in the actual caller", () => {
  const onUpload = setup(undefined, true);
  expect(screen.queryByLabelText("Музыка и звуки")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Изображения токенов")).toBeInTheDocument();
  expect(screen.getByLabelText("Портреты персонажей")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Загрузить" })).toHaveLength(2);
  expect(onUpload).not.toHaveBeenCalled();
});
