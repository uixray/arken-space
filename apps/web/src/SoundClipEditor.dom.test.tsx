// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AssetDto } from "@arken/contracts";
import { SoundClipEditor } from "./SoundClipEditor.js";

const asset = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: "AUDIO",
  audioPurpose: "MUSIC",
  name: "original.mp3",
  mimeType: "audio/mpeg",
  sizeBytes: 1000,
  width: null,
  height: null,
  durationSeconds: 30,
  url: "/api/assets/333/content",
  createdAt: new Date().toISOString(),
} as AssetDto;
const analysis = {
  sourceAssetId: asset.id,
  sourceVersion: "source-v1",
  durationMs: 12_000,
  sampleRate: 48_000,
  channels: 2,
  frames: 576_000,
  peaks: [0.1, 0.5, 0.8, 0.3],
};
const ready = {
  candidateId: "88888888-8888-4888-8888-888888888888",
  status: "READY",
  range: {
    startMs: 0,
    endMs: 1000,
    actualStartMs: 0,
    actualEndMs: 1000,
    actualStartFrame: 0,
    actualEndFrame: 48_000,
    sampleRate: 48_000,
    channels: 2,
    frames: 48_000,
  },
  previewUrl:
    "/api/audio-clip-previews/88888888-8888-4888-8888-888888888888/content",
  expiresAt: "2099-10-10T15:00:00.000Z",
  sizeBytes: 192_044,
};
const candidateState = { ...ready };

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function setup(fetcher: typeof fetch) {
  vi.stubGlobal("fetch", fetcher);
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <SoundClipEditor
      source={asset}
      packId="22222222-2222-4222-8222-222222222222"
      sourceNote="Rights note"
      onSaved={onSaved}
      onClose={onClose}
    />,
  );
  return { ...view, onSaved, onClose };
}

beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(
    () => undefined,
  );
  vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(
    () => undefined,
  );
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(
    undefined,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("clears old-source analysis immediately and ignores a late aborted response after source switch", async () => {
  const replacement = {
    ...asset,
    id: "44444444-4444-4444-8444-444444444444",
    name: "replacement.wav",
  } as AssetDto;
  let resolveOriginal!: (response: Response) => void;
  const originalPending = new Promise<Response>((resolve) => {
    resolveOriginal = resolve;
  });
  const replacementAnalysis = {
    ...analysis,
    sourceAssetId: replacement.id,
    sourceVersion: "replacement-v1",
    durationMs: 8_000,
    sampleRate: 44_100,
    frames: 352_800,
  };
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(asset.id)) return originalPending;
    return Promise.resolve(jsonResponse(replacementAnalysis));
  });
  vi.stubGlobal("fetch", fetchMock as typeof fetch);
  const onSaved = vi.fn();
  const view = render(
    <SoundClipEditor
      source={asset}
      packId="22222222-2222-4222-8222-222222222222"
      sourceNote="Rights note"
      onSaved={onSaved}
      onClose={vi.fn()}
    />,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  view.rerender(
    <SoundClipEditor
      source={replacement}
      packId="22222222-2222-4222-8222-222222222222"
      sourceNote="Replacement rights"
      onSaved={onSaved}
      onClose={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("img", {
      name: "Волновая форма, рассчитанная по исходному аудио",
    }),
  ).toBeNull();
  expect(screen.getByText("Источник: replacement.wav")).toBeInTheDocument();
  await screen.findByRole("img", {
    name: "Волновая форма, рассчитанная по исходному аудио",
  });
  expect(screen.getByText(/44\s?100\s*Гц/)).toBeInTheDocument();
  resolveOriginal(jsonResponse(analysis));
  await Promise.resolve();
  expect(screen.getByText(/44\s?100\s*Гц/)).toBeInTheDocument();
  expect(screen.queryByText(/48\s?000\s*Гц/)).toBeNull();
});
it("uses trusted server peaks, supports numeric range controls, and invalidates the preview on change", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("audio-analysis")) return jsonResponse(analysis);
    if (url.includes("audio-clip-preview")) return jsonResponse(ready);
    return jsonResponse(candidateState);
  });
  setup(fetchMock as typeof fetch);
  await screen.findByRole("img", {
    name: "Волновая форма, рассчитанная по исходному аудио",
  });
  expect(document.querySelectorAll(".sound-clip-editor__peak")).toHaveLength(
    analysis.peaks.length,
  );
  fireEvent.click(screen.getByRole("button", { name: "Создать предпросмотр" }));
  expect(
    await screen.findByRole("button", { name: "Прослушать" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Сохранить эффект" }),
  ).toBeEnabled();
  expect(screen.getByLabelText("Источник / лицензия")).toHaveValue(
    "Rights note",
  );

  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Начало, миллисекунды" }),
    { target: { value: "100" } },
  );
  expect(screen.queryByRole("button", { name: "Прослушать" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Сохранить эффект" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Создать предпросмотр" }),
  ).toBeEnabled();
});

it("retains the preview action id after a transient response and retries the same intent", async () => {
  const bodies: Array<{
    actionId: string;
    sourceVersion: string;
    startMs: number;
    endMs: number;
  }> = [];
  let previewAttempts = 0;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("audio-analysis")) return jsonResponse(analysis);
      if (url.includes("audio-clip-preview")) {
        bodies.push(JSON.parse(String(init?.body)) as (typeof bodies)[number]);
        previewAttempts++;
        return previewAttempts === 1
          ? jsonResponse({ error: "PROCESSING_BUSY" }, 503)
          : jsonResponse(ready);
      }
      return jsonResponse(candidateState);
    },
  );
  setup(fetchMock as typeof fetch);
  await screen.findByRole("button", { name: "Создать предпросмотр" });
  fireEvent.click(screen.getByRole("button", { name: "Создать предпросмотр" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Создать предпросмотр" }));
  await screen.findByRole("button", { name: "Прослушать" });
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
});

it("moves accessible markers by keyboard in 100 ms steps and drops stale preview", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes("audio-analysis")
      ? jsonResponse(analysis)
      : jsonResponse(ready),
  );
  setup(fetchMock as typeof fetch);
  fireEvent.click(
    await screen.findByRole("button", { name: "Создать предпросмотр" }),
  );
  await screen.findByRole("button", { name: "Прослушать" });
  const marker = screen.getByRole("slider", { name: "Начало отрезка" });
  expect(marker).toHaveAttribute("aria-valuenow", "0");
  fireEvent.keyDown(marker, { key: "ArrowRight" });
  expect(
    screen.getByRole("slider", { name: "Начало отрезка" }),
  ).toHaveAttribute("aria-valuenow", "100");
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Прослушать" })).toBeNull(),
  );
});

it("stops and clears only its own preview player when the editor unmounts", async () => {
  const pause = vi
    .spyOn(window.HTMLMediaElement.prototype, "pause")
    .mockImplementation(() => undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(
    () => undefined,
  );
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(
    undefined,
  );
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes("audio-analysis")
      ? jsonResponse(analysis)
      : jsonResponse(ready),
  );
  const view = setup(fetchMock as typeof fetch);
  fireEvent.click(
    await screen.findByRole("button", { name: "Создать предпросмотр" }),
  );
  const player = (await screen.findByLabelText(
    "Предпрослушивание эффекта",
  )) as HTMLAudioElement;
  expect(player.src).toContain("/api/audio-clip-previews/");
  fireEvent.click(screen.getByRole("button", { name: "Прослушать" }));
  await waitFor(() => expect(player.play).toHaveBeenCalled());
  view.unmount();
  expect(pause).toHaveBeenCalled();
  expect(player.getAttribute("src")).toBeNull();
});

it("saves only the current ready candidate through the clip endpoint without repurposing the MUSIC source", async () => {
  const calls: Array<{ url: string; body?: string }> = [];
  const onSaved = vi
    .fn()
    .mockRejectedValueOnce(new Error("catalog unavailable"))
    .mockResolvedValue(undefined);
  const onClose = vi.fn();
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.includes("audio-analysis")) return jsonResponse(analysis);
      if (url.includes("audio-clip-preview")) return jsonResponse(ready);
      if (url.includes("/clips"))
        return jsonResponse({
          packId: "22222222-2222-4222-8222-222222222222",
          sound: {
            id: "77777777-7777-4777-8777-777777777777",
            packId: "22222222-2222-4222-8222-222222222222",
            assetId: "66666666-6666-4666-8666-666666666666",
            label: "original",
            icon: "🔊",
            category: "Другое",
            sortOrder: 0,
            defaultGain: 0.5,
            audience: "ALL_MEMBERS",
            sourceNote: "Rights note",
          },
          provenance: {
            sourceAssetId: asset.id,
            sourceVersion: analysis.sourceVersion,
            startMs: 0,
            endMs: 1000,
            actualStartFrame: 0,
            actualEndFrame: 48_000,
            sampleRate: 48_000,
          },
        });
      return jsonResponse(candidateState);
    },
  );
  vi.stubGlobal("fetch", fetchMock as typeof fetch);
  render(
    <SoundClipEditor
      source={asset}
      packId="22222222-2222-4222-8222-222222222222"
      sourceNote="Rights note"
      onSaved={onSaved}
      onClose={onClose}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Создать предпросмотр" }),
  );
  await screen.findByRole("button", { name: "Сохранить эффект" });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить эффект" }));
  await screen.findByRole("alert");
  expect(onSaved).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Сохранить эффект" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Повторить обновление каталога",
    }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(calls.filter((call) => call.url.includes("/clips"))).toHaveLength(1);
  const saveCall = calls.find((call) => call.url.includes("/clips"));
  expect(saveCall?.url).toBe(
    "/api/soundpad/packs/22222222-2222-4222-8222-222222222222/clips",
  );
  expect(JSON.parse(saveCall?.body ?? "{}")).toMatchObject({
    candidateId: ready.candidateId,
    sourceNote: "Rights note",
  });
  expect(calls.some((call) => call.url === "/api/assets" && call.body)).toBe(
    false,
  );
});
