// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "./test-support/render";
import { api } from "./api";
import { GlobalStickerPackManager } from "./GlobalStickerPackManager";

vi.mock("./api", () => ({
  api: vi.fn(),
  formatApiError: (_error: unknown, fallback: string) => fallback,
  ApiError: class ApiError extends Error {
    status = 400;
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

it("creates, uploads, publishes, and deprecates only through global-pack APIs", async () => {
  const id = "global-pack-1";
  let lifecycle: "DRAFT" | "ACTIVE" | "DEPRECATED" = "DRAFT";
  const stickers: Array<{ id: string; actionId: string; sha256: string }> = [];
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/api/gm/global-sticker-packs" && !options?.method)
      return (
        lifecycle === "DEPRECATED"
          ? []
          : [{ id, name: "Общие эмоции", lifecycle, revision: 0 }]
      ) as never;
    if (path === "/api/gm/global-sticker-packs" && options?.method === "POST")
      return { id, name: "Общие эмоции", lifecycle, revision: 0 } as never;
    if (path === `/api/gm/global-sticker-packs/${id}`)
      return {
        id,
        name: "Общие эмоции",
        lifecycle,
        revision: 0,
        stickers,
      } as never;
    if (String(path).includes("/stickers?")) {
      const query = new URLSearchParams(String(path).split("?")[1]);
      stickers.push({
        id: "global-sticker-1",
        actionId: query.get("actionId")!,
        sha256: "hash",
      });
      return {} as never;
    }
    if (String(path).endsWith("/publish")) {
      lifecycle = "ACTIVE";
      return {} as never;
    }
    if (String(path).endsWith("/deprecate")) {
      lifecycle = "DEPRECATED";
      return {} as never;
    }
    return {} as never;
  });

  renderComponent(<GlobalStickerPackManager />);
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/gm/global-sticker-packs"),
  );
  fireEvent.change(screen.getByLabelText("Название нового общего пака"), {
    target: { value: "Общие эмоции" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Создать общий пак" }));
  await screen.findByRole("option", { name: /Общие эмоции — DRAFT/ });
  fireEvent.change(screen.getByLabelText("Alt-текст"), {
    target: { value: "Улыбка" },
  });
  fireEvent.change(screen.getByLabelText("Изображение"), {
    target: {
      files: [new File(["image"], "smile.webp", { type: "image/webp" })],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Добавить стикер" }));
  await screen.findByText("Изображение добавлено в черновик.");
  expect(api).toHaveBeenCalledWith(
    expect.stringMatching(
      new RegExp(`/api/gm/global-sticker-packs/${id}/stickers\\?`),
    ),
    expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Опубликовать общий пак" }),
  );
  await screen.findByRole("option", { name: /Общие эмоции — ACTIVE/ });
  fireEvent.click(
    screen.getByRole("button", { name: "Снять пак с публикации" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/api/gm/global-sticker-packs/${id}/deprecate`,
      { method: "POST" },
    ),
  );
  expect(api).not.toHaveBeenCalledWith(
    "/api/gm/sticker-packs",
    expect.anything(),
  );
});

it("retries an uncertain creation with the same idempotency key", async () => {
  const row = {
    id: "global-pack-1",
    name: "Пак",
    lifecycle: "DRAFT",
    revision: 0,
  };
  vi.mocked(api)
    .mockResolvedValueOnce([] as never)
    .mockRejectedValueOnce(new Error("network lost"))
    .mockResolvedValueOnce([] as never)
    .mockResolvedValueOnce(row as never)
    .mockResolvedValueOnce([row] as never)
    .mockResolvedValueOnce({ ...row, stickers: [] } as never);
  renderComponent(<GlobalStickerPackManager />);
  await waitFor(() => expect(api).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("Название нового общего пака"), {
    target: { value: "Пак" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Создать общий пак" }));
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: "Безопасно повторить создание" }),
  );
  await screen.findByRole("option", { name: /Пак — DRAFT/ });
  const createCalls = vi
    .mocked(api)
    .mock.calls.filter(
      (call) =>
        call[0] === "/api/gm/global-sticker-packs" &&
        call[1]?.method === "POST",
    );
  expect(createCalls).toHaveLength(2);
  expect(JSON.parse(String(createCalls[0]![1]?.body)).actionId).toBe(
    JSON.parse(String(createCalls[1]![1]?.body)).actionId,
  );
  expect(JSON.parse(String(createCalls[1]![1]?.body)).name).toBe("Пак");
});

it("restores an uncertain create intent after reload without creating a new action", async () => {
  const row = {
    id: "global-pack-1",
    name: "Пак",
    lifecycle: "DRAFT" as const,
    revision: 0,
  };
  let attempt = 0;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/api/gm/global-sticker-packs" && !options?.method)
      return (attempt ? [row] : []) as never;
    if (path === "/api/gm/global-sticker-packs" && options?.method === "POST") {
      attempt += 1;
      if (attempt === 1) throw new Error("network lost");
      return row as never;
    }
    if (path === `/api/gm/global-sticker-packs/${row.id}`)
      return { ...row, stickers: [] } as never;
    return {} as never;
  });
  const first = renderComponent(<GlobalStickerPackManager />);
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/gm/global-sticker-packs"),
  );
  fireEvent.change(screen.getByLabelText("Название нового общего пака"), {
    target: { value: "Пак" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Создать общий пак" }));
  await screen.findByRole("alert");
  first.unmount();

  renderComponent(<GlobalStickerPackManager />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Безопасно повторить создание" }),
    ).toBeEnabled(),
  );
  expect(screen.getByLabelText("Название нового общего пака")).toHaveValue(
    "Пак",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Безопасно повторить создание" }),
  );
  await screen.findByRole("option", { name: /Пак — DRAFT/ });
  const createCalls = vi
    .mocked(api)
    .mock.calls.filter(
      (call) =>
        call[0] === "/api/gm/global-sticker-packs" &&
        call[1]?.method === "POST",
    );
  expect(createCalls).toHaveLength(2);
  expect(JSON.parse(String(createCalls[0]![1]?.body)).actionId).toBe(
    JSON.parse(String(createCalls[1]![1]?.body)).actionId,
  );
});

it("reuses the upload idempotency key after an uncertain response", async () => {
  const row = {
    id: "global-pack-1",
    name: "Пак",
    lifecycle: "DRAFT",
    revision: 0,
  };
  let uploadAttempts = 0;
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/api/gm/global-sticker-packs") return [row] as never;
    if (path === `/api/gm/global-sticker-packs/${row.id}`)
      return { ...row, stickers: [] } as never;
    if (String(path).includes("/stickers?")) {
      uploadAttempts += 1;
      if (uploadAttempts === 1) throw new Error("network lost");
      return {} as never;
    }
    return {} as never;
  });
  renderComponent(<GlobalStickerPackManager />);
  await screen.findByRole("option", { name: /Пак — DRAFT/ });
  fireEvent.change(screen.getByLabelText("Alt-текст"), {
    target: { value: "Улыбка" },
  });
  fireEvent.change(screen.getByLabelText("Изображение"), {
    target: {
      files: [new File(["image"], "smile.webp", { type: "image/webp" })],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Добавить стикер" }));
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Проверить / безопасно повторить загрузку",
    }),
  );
  await screen.findByText("Изображение добавлено в черновик.");
  const uploads = vi
    .mocked(api)
    .mock.calls.filter((call) => String(call[0]).includes("/stickers?"));
  expect(uploads).toHaveLength(2);
  expect(
    new URLSearchParams(String(uploads[0]![0]).split("?")[1]).get("actionId"),
  ).toBe(
    new URLSearchParams(String(uploads[1]![0]).split("?")[1]).get("actionId"),
  );
  expect(
    new URLSearchParams(String(uploads[0]![0]).split("?")[1]).get(
      "sourceSha256",
    ),
  ).toMatch(/^[a-f0-9]{64}$/);
});

it("clears the upload intent when an uncertain response is reconciled immediately", async () => {
  const row = {
    id: "global-pack-1",
    name: "Пак",
    lifecycle: "DRAFT" as const,
    revision: 0,
  };
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("image")),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  let uploadedActionId = "";
  let detailHasUpload = false;
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/api/gm/global-sticker-packs") return [row] as never;
    if (path === `/api/gm/global-sticker-packs/${row.id}`)
      return {
        ...row,
        stickers: detailHasUpload
          ? [{ id: "sticker-1", actionId: uploadedActionId, sha256: hash }]
          : [],
      } as never;
    if (String(path).includes("/stickers?")) {
      uploadedActionId = new URLSearchParams(String(path).split("?")[1]).get(
        "actionId",
      )!;
      detailHasUpload = true;
      throw new Error("response lost after server accepted upload");
    }
    return {} as never;
  });
  const first = renderComponent(<GlobalStickerPackManager />);
  await screen.findByRole("option", { name: /Пак — DRAFT/ });
  fireEvent.change(screen.getByLabelText("Alt-текст"), {
    target: { value: "Улыбка" },
  });
  fireEvent.change(screen.getByLabelText("Изображение"), {
    target: {
      files: [new File(["image"], "smile.webp", { type: "image/webp" })],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Добавить стикер" }));
  await screen.findByRole("alert");
  await screen.findByText(
    "Загрузка подтверждена по сохранённой записи; повтор не требуется.",
  );
  expect(
    sessionStorage.getItem("arken.global-sticker-upload-intent"),
  ).toBeNull();
  expect(
    vi
      .mocked(api)
      .mock.calls.filter((call) => String(call[0]).includes("/stickers?")),
  ).toHaveLength(1);
  first.unmount();
});

it("does not upload again when reload finds a pending same-source upload", async () => {
  const row = {
    id: "global-pack-1",
    name: "Пак",
    lifecycle: "DRAFT" as const,
    revision: 0,
  };
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("image")),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  let uploadedActionId = "";
  let serverAccepted = false;
  let readsAfterAccept = 0;
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/api/gm/global-sticker-packs") return [row] as never;
    if (path === `/api/gm/global-sticker-packs/${row.id}`) {
      const visible = serverAccepted && readsAfterAccept > 0;
      if (serverAccepted) readsAfterAccept += 1;
      return {
        ...row,
        stickers: visible
          ? [{ id: "sticker-1", actionId: uploadedActionId, sha256: hash }]
          : [],
      } as never;
    }
    if (String(path).includes("/stickers?")) {
      uploadedActionId = new URLSearchParams(String(path).split("?")[1]).get(
        "actionId",
      )!;
      serverAccepted = true;
      throw new Error("response lost; first detail read is stale");
    }
    return {} as never;
  });
  const first = renderComponent(<GlobalStickerPackManager />);
  await screen.findByRole("option", { name: /Пак — DRAFT/ });
  fireEvent.change(screen.getByLabelText("Alt-текст"), {
    target: { value: "Улыбка" },
  });
  fireEvent.change(screen.getByLabelText("Изображение"), {
    target: {
      files: [new File(["image"], "smile.webp", { type: "image/webp" })],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Добавить стикер" }));
  await screen.findByRole("alert");
  await waitFor(() =>
    expect(
      sessionStorage.getItem("arken.global-sticker-upload-intent"),
    ).not.toBeNull(),
  );
  first.unmount();

  renderComponent(<GlobalStickerPackManager />);
  await screen.findByRole("option", { name: /Пак — DRAFT/ });
  await screen.findByText("Загружено файлов: 1");
  fireEvent.change(screen.getByLabelText("Alt-текст"), {
    target: { value: "Улыбка" },
  });
  fireEvent.change(screen.getByLabelText("Изображение"), {
    target: {
      files: [new File(["image"], "smile.webp", { type: "image/webp" })],
    },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Проверить / безопасно повторить загрузку",
    }),
  );
  await screen.findByText(
    "Это изображение уже есть в черновике; повторная загрузка не отправлена.",
  );
  expect(
    sessionStorage.getItem("arken.global-sticker-upload-intent"),
  ).toBeNull();
  expect(
    vi
      .mocked(api)
      .mock.calls.filter((call) => String(call[0]).includes("/stickers?")),
  ).toHaveLength(1);
});

it("owns Escape only for its open summary, leaving select and parent Escape intact", async () => {
  const onParentEscape = vi.fn();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/api/gm/global-sticker-packs")
      return [
        { id: "pack-escape", name: "Пак", lifecycle: "DRAFT", revision: 0 },
      ] as never;
    if (path === "/api/gm/global-sticker-packs/pack-escape")
      return {
        id: "pack-escape",
        name: "Пак",
        lifecycle: "DRAFT",
        revision: 0,
        stickers: [],
      } as never;
    return {} as never;
  });
  renderComponent(
    <div onKeyDown={(event) => event.key === "Escape" && onParentEscape()}>
      <GlobalStickerPackManager />
    </div>,
  );

  const summary = screen.getByText("Общие паки");
  const details = summary.parentElement as HTMLDetailsElement;
  const unownedRepeat = fireEvent.keyDown(summary, {
    key: "Escape",
    repeat: true,
  });
  expect(unownedRepeat).toBe(true);
  expect(onParentEscape).toHaveBeenCalledTimes(1);

  fireEvent.click(summary);
  expect(details.open).toBe(true);

  const ownedEscape = fireEvent.keyDown(summary, { key: "Escape" });
  expect(ownedEscape).toBe(false);
  expect(details.open).toBe(false);
  expect(summary).toHaveFocus();
  expect(onParentEscape).toHaveBeenCalledTimes(1);

  const heldEscapeRepeat = fireEvent.keyDown(summary, {
    key: "Escape",
    repeat: true,
  });
  expect(heldEscapeRepeat).toBe(false);
  expect(onParentEscape).toHaveBeenCalledTimes(1);

  fireEvent.keyUp(summary, { key: "Escape" });
  fireEvent.keyDown(summary, { key: "Escape" });
  expect(onParentEscape).toHaveBeenCalledTimes(2);

  fireEvent.click(summary);
  const select = await screen.findByLabelText("Мои общие паки");
  const nativeEscape = fireEvent.keyDown(select, { key: "Escape" });
  expect(nativeEscape).toBe(true);
  expect(details.open).toBe(true);
  expect(onParentEscape).toHaveBeenCalledTimes(3);

  fireEvent.keyDown(screen.getByLabelText("Название нового общего пака"), {
    key: "Escape",
  });
  expect(details.open).toBe(true);
  expect(onParentEscape).toHaveBeenCalledTimes(4);
});
