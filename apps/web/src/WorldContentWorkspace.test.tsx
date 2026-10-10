// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { ThemeProvider } from "@gravity-ui/uikit";
import type { ReactNode } from "react";
import { fireEvent, renderComponent, screen } from "./test-support/render";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: apiMock,
}));
const { WorldContentWorkspace } = await import("./WorldContentWorkspace");

const entityId = "26400000-0000-4000-8000-000000000001";
const otherId = "26400000-0000-4000-8000-000000000002";
const entity = (
  overrides: Partial<{
    name: string;
    summary: string;
    gmOnlyText: string;
    revision: number;
    lifecycle: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  }> = {},
) => ({
  id: entityId,
  slug: "silver-coast",
  type: "LOCATION" as const,
  subtype: "Port",
  name: "Silver Coast",
  aliases: ["The Coast"],
  summary: "Original summary",
  publicText: "Public v1",
  gmOnlyText: "GM v1",
  tags: ["coast"],
  coverAssetId: null,
  lifecycle: "DRAFT" as const,
  revision: 4,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});
const other = {
  ...entity(),
  id: otherId,
  slug: "other-port",
  name: "Other Port",
};

function renderManager(onClose = vi.fn()) {
  renderComponent(
    <WorldContentWorkspace open assets={[]} onClose={onClose} />,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ThemeProvider theme="dark" lang="ru">
          {children}
        </ThemeProvider>
      ),
    },
  );
  return onClose;
}

beforeEach(() => {
  apiMock.mockReset();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
  apiMock.mockImplementation((path: string) => {
    if (path === "/api/world-content")
      return Promise.resolve([entity(), other]);
    if (path === `/api/world-content/${entityId}`)
      return Promise.resolve(entity());
    if (path.endsWith("/relations") || path.endsWith("/media"))
      return Promise.resolve([]);
    if (path === "/api/world-content-instances")
      return Promise.resolve({ instances: [] });
    return Promise.resolve([]);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function selectEntity() {
  fireEvent.click(await screen.findByRole("button", { name: /Silver Coast/ }));
  await screen.findByLabelText("Название");
}

describe("WorldContentWorkspace canonical PATCH recovery", () => {
  it("reflects dirty state and clears it when the draft returns to baseline", async () => {
    renderManager();
    await selectEntity();
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Unsaved local edit" },
    });
    expect(save).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Silver Coast" },
    });
    expect(save).toBeDisabled();
    expect(
      apiMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
  });

  it("retries an ambiguous save with the exact original action, revision, and changed payload", async () => {
    let patchCount = 0;
    const saved = entity({ name: "Changed locally", revision: 5 });
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/api/world-content")
        return Promise.resolve([entity(), other]);
      if (path.endsWith("/relations") || path.endsWith("/media"))
        return Promise.resolve([]);
      if (
        path === `/api/world-content/${entityId}` &&
        init?.method === "PATCH"
      ) {
        patchCount += 1;
        if (patchCount === 1)
          return Promise.reject(new TypeError("synthetic transport timeout"));
        return Promise.resolve({ duplicate: true });
      }
      if (path === `/api/world-content/${entityId}`)
        return Promise.resolve(saved);
      return Promise.resolve([]);
    });
    renderManager();
    await selectEntity();
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Changed locally" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText(/повтор отправит тот же запрос/i);

    const firstPatch = apiMock.mock.calls.find(
      ([path, init]) =>
        path === `/api/world-content/${entityId}` && init?.method === "PATCH",
    )![1] as RequestInit;
    const firstEnvelope = JSON.parse(firstPatch.body as string);
    expect(firstEnvelope).toMatchObject({
      actionId: expect.any(String),
      revision: 4,
      name: "Changed locally",
    });
    expect(firstEnvelope).not.toHaveProperty("summary");
    expect(screen.getByLabelText("Название")).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Повторить тот же запрос" }),
    );
    await screen.findByText(/этот запрос уже был применён/i);
    const patches = apiMock.mock.calls.filter(
      ([path, init]) =>
        path === `/api/world-content/${entityId}` && init?.method === "PATCH",
    );
    expect(patches).toHaveLength(2);
    expect(JSON.parse((patches[1]![1] as RequestInit).body as string)).toEqual(
      firstEnvelope,
    );
    expect(await screen.findByLabelText("Название")).toHaveValue(
      "Changed locally",
    );
  });

  it("preserves local draft on 409 and explicitly reapplies only changed fields to latest revision", async () => {
    let patchCount = 0;
    const latest = entity({
      revision: 5,
      summary: "Concurrent summary",
      gmOnlyText: "Concurrent GM field",
    });
    const saved = entity({
      name: "Local title",
      revision: 6,
      summary: latest.summary,
      gmOnlyText: latest.gmOnlyText,
    });
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/api/world-content")
        return Promise.resolve([entity(), other]);
      if (path.endsWith("/relations") || path.endsWith("/media"))
        return Promise.resolve([]);
      if (
        path === `/api/world-content/${entityId}` &&
        init?.method === "PATCH"
      ) {
        patchCount += 1;
        if (patchCount === 1)
          return Promise.reject(
            new ApiError(409, "WORLD_CONTENT_CONFLICT", "conflict"),
          );
        return Promise.resolve(saved);
      }
      if (path === `/api/world-content/${entityId}`)
        return Promise.resolve(latest);
      return Promise.resolve([]);
    });
    renderManager();
    await selectEntity();
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Local title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await screen.findByRole("region", { name: "Сверка конфликта версии" });
    expect(screen.getByText("Ваш черновик: Local title")).toBeInTheDocument();
    expect(screen.getByText("На сервере: Silver Coast")).toBeInTheDocument();
    expect(screen.getByLabelText("Название")).toHaveValue("Local title");

    const detailReadCount = apiMock.mock.calls.filter(
      ([path, init]) =>
        path === `/api/world-content/${entityId}` && init?.method !== "PATCH",
    ).length;
    const refresh = screen.getByRole("button", { name: "Обновить сравнение" });
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    await screen.findByText(/На сервере версия 5/);
    expect(
      apiMock.mock.calls.filter(
        ([path, init]) =>
          path === `/api/world-content/${entityId}` && init?.method !== "PATCH",
      ),
    ).toHaveLength(detailReadCount + 1);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Перенести мои изменения на версию 5 и сохранить",
      }),
    );
    await screen.findByText("Сохранено.");
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    const patches = apiMock.mock.calls.filter(
      ([path, init]) =>
        path === `/api/world-content/${entityId}` && init?.method === "PATCH",
    );
    const initial = JSON.parse((patches[0]![1] as RequestInit).body as string);
    const reapplied = JSON.parse(
      (patches[1]![1] as RequestInit).body as string,
    );
    expect(initial.revision).toBe(4);
    expect(reapplied.revision).toBe(5);
    expect(reapplied.name).toBe("Local title");
    expect(reapplied).not.toHaveProperty("summary");
    expect(reapplied).not.toHaveProperty("gmOnlyText");
    expect(reapplied.actionId).not.toBe(initial.actionId);
    expect(screen.getByLabelText("Краткое описание")).toHaveValue(
      "Concurrent summary",
    );
    expect(screen.getByLabelText("Название")).toHaveValue("Local title");
  });

  it("discards a conflicted local draft onto the latest baseline and clears dirty state", async () => {
    const latest = entity({ name: "Latest server title", revision: 5 });
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/api/world-content")
        return Promise.resolve([entity(), other]);
      if (path === `/api/world-content/${entityId}` && init?.method === "PATCH")
        return Promise.reject(
          new ApiError(409, "WORLD_CONTENT_CONFLICT", "conflict"),
        );
      if (path === `/api/world-content/${entityId}`)
        return Promise.resolve(latest);
      return Promise.resolve([]);
    });
    renderManager();
    await selectEntity();
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Discard this local title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByRole("region", { name: "Сверка конфликта версии" });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Отбросить черновик и загрузить версию 5",
      }),
    );
    await screen.findByText("Черновик отброшен. Загружена актуальная версия.");
    expect(screen.getByLabelText("Название")).toHaveValue(
      "Latest server title",
    );
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  });

  it("coalesces rapid save clicks into one immutable in-flight PATCH", async () => {
    let settlePatch: ((value: ReturnType<typeof entity>) => void) | undefined;
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/api/world-content")
        return Promise.resolve([entity(), other]);
      if (path.endsWith("/relations") || path.endsWith("/media"))
        return Promise.resolve([]);
      if (path === "/api/world-content-instances") return Promise.resolve([]);
      if (path === `/api/world-content/${entityId}` && init?.method === "PATCH")
        return new Promise((resolve) => {
          settlePatch = resolve;
        });
      if (path === `/api/world-content/${entityId}`)
        return Promise.resolve(entity());
      return Promise.resolve([]);
    });
    renderManager();
    await selectEntity();
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Single request" },
    });
    const saveButton = screen.getByRole("button", { name: "Сохранить" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    const patches = apiMock.mock.calls.filter(
      ([path, init]) =>
        path === `/api/world-content/${entityId}` && init?.method === "PATCH",
    );
    expect(patches).toHaveLength(1);
    settlePatch?.(entity({ name: "Single request", revision: 5 }));
    await screen.findByText("Сохранено.");
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    expect(
      apiMock.mock.calls.filter(
        ([path, init]) =>
          path === `/api/world-content/${entityId}` && init?.method === "PATCH",
      ),
    ).toHaveLength(1);
  });
});
