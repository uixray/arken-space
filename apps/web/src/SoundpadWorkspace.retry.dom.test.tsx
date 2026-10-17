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
import type { AssetDto, SoundpadPackDto } from "@arken/contracts";
import { SoundpadWorkspace } from "./SoundpadWorkspace";

const campaignId = "44444444-4444-4444-8444-444444444444";
const membershipId = "55555555-5555-4555-8555-555555555555";
const packId = "22222222-2222-4222-8222-222222222222";
const assetId = "33333333-3333-4333-8333-333333333333";
const savedAssetId = "99999999-9999-4999-8999-999999999999";
const soundId = "77777777-7777-4777-8777-777777777777";
const candidateId = "88888888-8888-4888-8888-888888888888";
const asset: AssetDto = {
  id: assetId,
  kind: "AUDIO",
  audioPurpose: "MUSIC",
  name: "synthetic.wav",
  mimeType: "audio/wav",
  sizeBytes: 1000,
  width: null,
  height: null,
  durationSeconds: 12,
  url: `/api/assets/${assetId}/content`,
  createdAt: new Date().toISOString(),
};
const analysis = {
  sourceAssetId: assetId,
  sourceVersion: "source-v1",
  durationMs: 12_000,
  sampleRate: 48_000,
  channels: 1,
  frames: 576_000,
  peaks: [0.1, 0.5, 0.8, 0.3],
};
const savedAsset: AssetDto = {
  ...asset,
  id: savedAssetId,
  kind: "AUDIO",
  audioPurpose: "SOUND_EFFECT",
  name: "synthetic-clip.wav",
  durationSeconds: 1,
  url: `/api/assets/${savedAssetId}/content`,
};
const candidate = {
  candidateId,
  status: "READY",
  range: {
    startMs: 0,
    endMs: 1000,
    actualStartMs: 0,
    actualEndMs: 1000,
    actualStartFrame: 0,
    actualEndFrame: 48_000,
    sampleRate: 48_000,
    channels: 1,
    frames: 48_000,
  },
  previewUrl: `/api/audio-clip-previews/${candidateId}/content`,
  expiresAt: "2099-10-10T15:00:00.000Z",
  sizeBytes: 96_044,
};
const emptyPack: SoundpadPackDto = {
  id: packId,
  campaignId,
  name: "Synthetic connected pack",
  published: true,
  audience: "ALL_MEMBERS",
  sortOrder: 0,
  sounds: [],
};
const savedSound = {
  id: soundId,
  packId,
  assetId: savedAssetId,
  label: "Synthetic GM-only clip",
  icon: "🔊",
  category: "Другое",
  sortOrder: 0,
  defaultGain: 0.5,
  audience: "GM_ONLY" as const,
  sourceNote: null,
};
const savedPack: SoundpadPackDto = { ...emptyPack, sounds: [savedSound] };

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
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

it("keeps a committed editor open after catalog refresh failure and retries refresh without reposting the clip", async () => {
  let clipPosts = 0;
  let postCommitCatalogGets = 0;
  const calls: Array<{ url: string; method: string }> = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url === "/api/soundpad" && clipPosts > 0) {
        postCommitCatalogGets += 1;
        if (postCommitCatalogGets === 1)
          return jsonResponse({ error: "TRANSIENT_CATALOG_FAILURE" }, 503);
        return jsonResponse({
          packs: [savedPack],
          playerPlaybackEnabled: true,
        });
      }
      if (url === "/api/soundpad")
        return jsonResponse({
          packs: [emptyPack],
          playerPlaybackEnabled: true,
        });
      if (url === `/api/assets/${assetId}/audio-analysis`)
        return jsonResponse(analysis);
      if (url === `/api/assets/${assetId}/audio-clip-preview`)
        return jsonResponse(candidate, 201);
      if (url === `/api/audio-clip-previews/${candidateId}`)
        return jsonResponse(candidate);
      if (url === `/api/soundpad/packs/${packId}/clips` && method === "POST") {
        clipPosts += 1;
        return jsonResponse(
          {
            packId,
            sound: savedSound,
            provenance: {
              sourceAssetId: assetId,
              sourceVersion: analysis.sourceVersion,
              startMs: 0,
              endMs: 1000,
              actualStartFrame: 0,
              actualEndFrame: 48_000,
              sampleRate: 48_000,
            },
          },
          201,
        );
      }
      return jsonResponse({ error: "UNEXPECTED_TEST_REQUEST" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchMock as typeof fetch);

  render(
    <>
      <SoundpadWorkspace
        campaignId={campaignId}
        membershipId={membershipId}
        role="GM"
        assets={[asset, savedAsset]}
        socket={null}
        onUpload={vi.fn().mockResolvedValue(asset)}
      />
    </>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Саундпад" }));
  fireEvent.click(
    await screen.findByText("Управление паками", { exact: true }),
  );
  fireEvent.change(screen.getByLabelText("Пак для нового звука"), {
    target: { value: packId },
  });
  fireEvent.change(screen.getByLabelText("Источник для нового эффекта"), {
    target: { value: assetId },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Редактировать отрезок" }),
  );
  await screen.findByRole("img", {
    name: "Волновая форма, рассчитанная по исходному аудио",
  });
  fireEvent.click(screen.getByRole("button", { name: "Создать предпросмотр" }));
  await screen.findByRole("button", { name: "Сохранить эффект" });
  fireEvent.change(screen.getByLabelText("Название эффекта"), {
    target: { value: savedSound.label },
  });
  fireEvent.change(screen.getAllByLabelText(/Кому доступен/).at(-1)!, {
    target: { value: "GM_ONLY" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Сохранить эффект" }));
  await screen.findByRole("button", { name: "Повторить обновление каталога" });
  expect(
    await screen.findByText(
      "Эффект сохранён, но каталог не обновился. Повторите обновление.",
    ),
  ).toBeInTheDocument();
  expect(clipPosts).toBe(1);
  expect(postCommitCatalogGets).toBe(1);

  fireEvent.click(
    screen.getByRole("button", { name: "Повторить обновление каталога" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Повторить обновление каталога" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    await screen.findByRole("button", {
      name: `Запустить звук: ${savedSound.label}`,
    }),
  ).toBeInTheDocument();
  expect(clipPosts).toBe(1);
  expect(postCommitCatalogGets).toBe(2);
  expect(
    calls.filter(
      (call) =>
        call.url === `/api/soundpad/packs/${packId}/clips` &&
        call.method === "POST",
    ),
  ).toHaveLength(1);
  expect(
    calls.filter((call) => call.url === "/api/soundpad").length,
  ).toBeGreaterThanOrEqual(3);
});
