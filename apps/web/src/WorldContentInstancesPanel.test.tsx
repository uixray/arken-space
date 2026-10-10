// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssetDto,
  CreateWorldContentInstance,
  UpdateWorldContentInstance,
  WorldContentInstanceDto,
} from "@arken/contracts";
import { ApiError } from "./api";
import {
  createWorldContentInstance,
  deleteWorldContentInstance,
  fetchWorldContentInstance,
  fetchWorldContentInstances,
  updateWorldContentInstance,
} from "./world-content-instances-client";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "./test-support/render";
import { WorldContentInstancesPanel } from "./WorldContentInstancesPanel";

vi.mock("./world-content-instances-client", () => ({
  createWorldContentInstance: vi.fn(),
  deleteWorldContentInstance: vi.fn(),
  fetchWorldContentInstance: vi.fn(),
  fetchWorldContentInstances: vi.fn(),
  updateWorldContentInstance: vi.fn(),
}));

const canonical = { id: "canon-1", name: "Порт", type: "LOCATION" };
const members = [
  {
    id: "member-1",
    role: "GM" as const,
    displayName: "Мастер",
    characterId: null,
  },
  {
    id: "member-2",
    role: "PLAYER" as const,
    displayName: "Игрок",
    characterId: null,
  },
];
const portrait = (id: string, name: string): AssetDto => ({
  id,
  kind: "PORTRAIT",
  name,
  mimeType: "image/png",
  sizeBytes: 128,
  width: 1,
  height: 1,
  durationSeconds: null,
  url: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
  createdAt: "2026-10-09T00:00:00.000Z",
});
const row = (id: string, overrides: Partial<WorldContentInstanceDto> = {}) => ({
  ...instance(id),
  ...overrides,
});
function instance(id: string) {
  return {
    id,
    campaignId: "campaign-current",
    worldContentId: canonical.id,
    displayNameOverride: null,
    currentState: null,
    gmNotes: null,
    portraitAssetId: null,
    ownerMembershipId: null,
    currentLocationId: null,
    quantity: null,
    condition: null,
    discovered: false,
    revision: 0,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  };
}

describe("WorldContentInstancesPanel", () => {
  beforeEach(() => vi.resetAllMocks());

  it("sets, changes, clears, and preserves an instance owner without changing canon", async () => {
    let stored = row("instance-1");
    vi.mocked(fetchWorldContentInstances).mockResolvedValue([stored]);
    vi.mocked(updateWorldContentInstance).mockImplementation(
      async (id: string, input: UpdateWorldContentInstance) => {
        stored = row(id, {
          ...stored,
          ...input,
          ownerMembershipId:
            input.ownerMembershipId === undefined
              ? stored.ownerMembershipId
              : input.ownerMembershipId,
          revision: stored.revision + 1,
        });
        return stored;
      },
    );
    renderComponent(
      <WorldContentInstancesPanel canonical={canonical} members={members} />,
    );
    await screen.findByRole("button", { name: /Порт/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Изменить выбранный экземпляр" }),
    );
    const owner = screen.getByRole("combobox", {
      name: "Владелец в этой кампании",
    });
    expect(owner).toHaveAccessibleName("Владелец в этой кампании");
    expect(owner).toHaveTextContent("Не назначен");
    await userEvent.click(owner);
    await userEvent.click(
      screen.getByRole("option", { name: "Мастер (Мастер)" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() => expect(stored.ownerMembershipId).toBe("member-1"));

    await userEvent.click(owner);
    await userEvent.click(
      screen.getByRole("option", { name: "Игрок (Игрок)" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() => expect(stored.ownerMembershipId).toBe("member-2"));

    await userEvent.clear(screen.getByLabelText("Состояние"));
    await userEvent.type(screen.getByLabelText("Состояние"), "Перемещён");
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() => expect(stored.ownerMembershipId).toBe("member-2"));

    await userEvent.click(owner);
    await userEvent.click(screen.getByRole("option", { name: "Не назначен" }));
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() => expect(stored.ownerMembershipId).toBeNull());
    expect(stored.worldContentId).toBe(canonical.id);
  });

  it("creates, changes, clears and previews instance portrait and map location", async () => {
    const assets = [
      portrait("portrait-a", "Портрет A"),
      portrait("portrait-b", "Портрет B"),
    ];
    const maps = [{ id: "map-a", name: "Берег" }];
    const locations = [
      { id: "location-a", mapId: "map-a", name: "Причал" },
      { id: "location-b", mapId: "map-a", name: "Маяк" },
    ];
    let stored = row("instance-new");
    vi.mocked(fetchWorldContentInstances).mockResolvedValue([]);
    vi.mocked(createWorldContentInstance).mockImplementation(
      async (input: CreateWorldContentInstance) => {
        stored = row("instance-new", input);
        return stored;
      },
    );
    vi.mocked(updateWorldContentInstance).mockImplementation(
      async (id: string, input: UpdateWorldContentInstance) => {
        stored = row(id, {
          ...stored,
          ...input,
          portraitAssetId:
            input.portraitAssetId === undefined
              ? stored.portraitAssetId
              : input.portraitAssetId,
          currentLocationId:
            input.currentLocationId === undefined
              ? stored.currentLocationId
              : input.currentLocationId,
          revision: stored.revision + 1,
        });
        return stored;
      },
    );

    renderComponent(
      <WorldContentInstancesPanel
        canonical={canonical}
        assets={assets}
        maps={maps}
        locations={locations}
      />,
    );
    await screen.findByText(
      "В этой кампании пока нет экземпляров этой сущности.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Создать экземпляр" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Портрет A" }));
    await userEvent.click(
      screen.getByRole("combobox", {
        name: "Текущее место на карте кампании",
      }),
    );
    await userEvent.click(
      screen.getByRole("option", { name: "Берег — Причал" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^Создать$/ }));
    await screen.findByRole("img", { name: "Портрет: Порт" });
    expect(createWorldContentInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        portraitAssetId: "portrait-a",
        currentLocationId: "location-a",
      }),
    );
    expect(stored.worldContentId).toBe(canonical.id);

    await userEvent.click(
      screen.getByRole("button", { name: "Изменить выбранный экземпляр" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Портрет B" }));
    await userEvent.click(
      screen.getByRole("combobox", {
        name: "Текущее место на карте кампании",
      }),
    );
    await userEvent.click(screen.getByRole("option", { name: "Берег — Маяк" }));
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() => expect(stored.portraitAssetId).toBe("portrait-b"));
    expect(updateWorldContentInstance).toHaveBeenLastCalledWith(
      "instance-new",
      expect.objectContaining({
        portraitAssetId: "portrait-b",
        currentLocationId: "location-b",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Без портрета" }));
    await userEvent.click(
      screen.getByRole("combobox", {
        name: "Текущее место на карте кампании",
      }),
    );
    await userEvent.click(screen.getByRole("option", { name: "Не указано" }));
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() => expect(stored.portraitAssetId).toBeNull());
    expect(updateWorldContentInstance).toHaveBeenLastCalledWith(
      "instance-new",
      expect.objectContaining({
        portraitAssetId: null,
        currentLocationId: null,
      }),
    );
    expect(stored.worldContentId).toBe(canonical.id);
  });

  it("keeps unavailable saved references distinct from empty and omits them on unrelated edits", async () => {
    const orphan = row("orphan-instance", {
      portraitAssetId: "old-portrait-id",
      currentLocationId: "old-location-id",
      quantity: 2,
      condition: "Целый",
    });
    vi.mocked(fetchWorldContentInstances).mockResolvedValue([orphan]);
    let stored = orphan;
    vi.mocked(updateWorldContentInstance).mockImplementation(
      async (id: string, input: UpdateWorldContentInstance) => {
        stored = row(id, {
          ...stored,
          ...input,
          revision: stored.revision + 1,
        });
        return stored;
      },
    );
    renderComponent(
      <WorldContentInstancesPanel
        canonical={{ id: canonical.id, name: "Зелье", type: "ITEM" }}
      />,
    );
    await screen.findByRole("button", { name: /место: место недоступно/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Изменить выбранный экземпляр" }),
    );
    expect(
      screen.getByText(/Сохранённый портрет недоступен/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Сохранённое место недоступно/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", {
        name: "Текущее место на карте кампании",
      }),
    ).toHaveTextContent("Место недоступно");

    await userEvent.clear(screen.getByLabelText(/Количество/));
    await userEvent.type(screen.getByLabelText(/Количество/), "3");
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() => expect(stored.quantity).toBe(3));
    const unrelated = vi.mocked(updateWorldContentInstance).mock.calls[0]![1];
    expect(unrelated).not.toHaveProperty("portraitAssetId");
    expect(unrelated).not.toHaveProperty("currentLocationId");
    expect(stored).toMatchObject({
      portraitAssetId: "old-portrait-id",
      currentLocationId: "old-location-id",
    });

    await userEvent.click(screen.getByRole("button", { name: "Без портрета" }));
    await userEvent.click(
      screen.getByRole("combobox", {
        name: "Текущее место на карте кампании",
      }),
    );
    await userEvent.click(screen.getByRole("option", { name: "Не указано" }));
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() => expect(stored.currentLocationId).toBeNull());
    expect(updateWorldContentInstance).toHaveBeenLastCalledWith(
      "orphan-instance",
      expect.objectContaining({
        portraitAssetId: null,
        currentLocationId: null,
      }),
    );
  });

  it("creates and edits ITEM quantity and condition, preserving zero and explicit unset", async () => {
    const itemCanonical = { id: "item-canon", name: "Зелье", type: "ITEM" };
    let stored = row("item-1", {
      worldContentId: itemCanonical.id,
      quantity: null,
      condition: null,
    });
    vi.mocked(fetchWorldContentInstances).mockResolvedValue([stored]);
    vi.mocked(createWorldContentInstance).mockImplementation(
      async (input: CreateWorldContentInstance) => {
        expect(input.quantity).toBe(0);
        expect(input.condition).toBe("Целое");
        return row("item-2", {
          worldContentId: itemCanonical.id,
          quantity: input.quantity ?? null,
          condition: input.condition ?? null,
        });
      },
    );
    vi.mocked(updateWorldContentInstance).mockImplementation(
      async (id: string, input: UpdateWorldContentInstance) => {
        stored = row(id, {
          ...stored,
          ...input,
          quantity: input.quantity ?? null,
          condition: input.condition ?? null,
          revision: stored.revision + 1,
        });
        return stored;
      },
    );

    renderComponent(<WorldContentInstancesPanel canonical={itemCanonical} />);
    await screen.findAllByRole("button", { name: /Зелье/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Создать экземпляр" }),
    );
    await userEvent.type(screen.getByLabelText(/Количество/), "0");
    await userEvent.type(screen.getByLabelText("Состояние предмета"), "Целое");
    await userEvent.click(screen.getByRole("button", { name: /^Создать$/ }));
    await screen.findAllByRole("button", { name: /Зелье/ });
    expect(createWorldContentInstance).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 0, condition: "Целое" }),
    );

    await userEvent.click(screen.getAllByRole("button", { name: /Зелье/ })[0]!);
    await userEvent.click(
      screen.getByRole("button", { name: "Изменить выбранный экземпляр" }),
    );
    await userEvent.clear(screen.getByLabelText(/Количество/));
    await userEvent.clear(screen.getByLabelText("Состояние предмета"));
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() =>
      expect(updateWorldContentInstance).toHaveBeenCalledWith(
        "item-2",
        expect.objectContaining({ quantity: null, condition: null }),
      ),
    );
  });

  it("rejects invalid item quantity and condition without submitting", async () => {
    vi.mocked(fetchWorldContentInstances).mockResolvedValue([]);
    renderComponent(
      <WorldContentInstancesPanel
        canonical={{ id: "item-canon", name: "Зелье", type: "ITEM" }}
      />,
    );
    await screen.findByText(
      "В этой кампании пока нет экземпляров этой сущности.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Создать экземпляр" }),
    );
    await userEvent.type(screen.getByLabelText(/Количество/), "-1");
    expect(screen.getByRole("button", { name: /^Создать$/ })).toBeDisabled();
    expect(createWorldContentInstance).not.toHaveBeenCalled();
  });

  it("creates multiple scoped instances, edits only changed fields and reloads persisted rows", async () => {
    const first = row("instance-1", {
      displayNameOverride: "Северный порт",
      revision: 1,
    });
    const second = row("instance-2", {
      displayNameOverride: "Южный порт",
      revision: 1,
    });
    let stored: ReturnType<typeof row>[] = [];
    vi.mocked(fetchWorldContentInstances).mockImplementation(
      async () => stored,
    );
    vi.mocked(createWorldContentInstance).mockImplementation(
      async (input: CreateWorldContentInstance) => {
        const next = row(`instance-${stored.length + 1}`, {
          displayNameOverride: input.displayNameOverride ?? null,
          currentState: input.currentState ?? null,
          gmNotes: input.gmNotes ?? null,
          revision: 1,
        });
        stored = [next, ...stored];
        return next;
      },
    );
    vi.mocked(updateWorldContentInstance).mockImplementation(
      async (id: string, input: UpdateWorldContentInstance) => {
        const current = stored.find((candidate) => candidate.id === id)!;
        const next = row(id, {
          ...current,
          ...input,
          revision: current.revision + 1,
        });
        stored = stored.map((candidate) =>
          candidate.id === id ? next : candidate,
        );
        return next;
      },
    );

    renderComponent(<WorldContentInstancesPanel canonical={canonical} />);
    await screen.findByText(
      "В этой кампании пока нет экземпляров этой сущности.",
    );
    expect(screen.queryByLabelText(/Количество/)).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Создать экземпляр" }),
    );
    await userEvent.type(
      screen.getByLabelText("Имя в этой кампании"),
      "Северный порт",
    );
    await userEvent.click(screen.getByRole("button", { name: /^Создать$/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Экземпляры сущности" }).children,
      ).toHaveLength(1),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Создать экземпляр" }),
    );
    await userEvent.type(
      screen.getByLabelText("Имя в этой кампании"),
      "Южный порт",
    );
    await userEvent.click(screen.getByRole("button", { name: /^Создать$/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Экземпляры сущности" }).children,
      ).toHaveLength(2),
    );
    expect(
      screen.getByRole("list", { name: "Экземпляры сущности" }).children,
    ).toHaveLength(2);

    await userEvent.click(
      screen.getByRole("button", { name: /Северный порт/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Изменить выбранный экземпляр" }),
    );
    await userEvent.type(screen.getByLabelText("Состояние"), "Закрыт штормом");
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() => expect(updateWorldContentInstance).toHaveBeenCalled());
    expect(updateWorldContentInstance).toHaveBeenCalledWith(
      "instance-1",
      expect.objectContaining({ revision: 1, currentState: "Закрыт штормом" }),
    );
    const update = vi.mocked(updateWorldContentInstance).mock.calls[0]![1];
    expect(update).not.toHaveProperty("gmNotes");
    expect(update).not.toHaveProperty("displayNameOverride");
    expect(update).not.toHaveProperty("quantity");
    expect(update).not.toHaveProperty("condition");
    expect(
      stored.find((candidate) => candidate.id === "instance-2")
        ?.displayNameOverride,
    ).toBe("Южный порт");

    await screen.findAllByText("Закрыт штормом");
    expect(fetchWorldContentInstances).toHaveBeenCalledWith(canonical.id);
    expect(first.worldContentId).toBe(canonical.id);
    expect(second.worldContentId).toBe(canonical.id);
  });

  it("retains a draft on 409 and requires an explicit rebase onto the latest revision", async () => {
    const original = row("instance-1", {
      displayNameOverride: "Крепость",
      portraitAssetId: "portrait-a",
      currentLocationId: "location-a",
      revision: 4,
    });
    const latest = row("instance-1", {
      displayNameOverride: "Новая крепость",
      currentState: "Осаждена",
      portraitAssetId: "portrait-a",
      currentLocationId: "location-a",
      revision: 5,
    });
    const assets = [
      portrait("portrait-a", "Портрет A"),
      portrait("portrait-b", "Портрет B"),
    ];
    const maps = [{ id: "map-a", name: "Берег" }];
    const locations = [
      { id: "location-a", mapId: "map-a", name: "Причал" },
      { id: "location-b", mapId: "map-a", name: "Маяк" },
    ];
    vi.mocked(fetchWorldContentInstances).mockResolvedValue([original]);
    vi.mocked(updateWorldContentInstance)
      .mockRejectedValueOnce(
        new ApiError(409, "WORLD_CONTENT_INSTANCE_CONFLICT", "Конфликт"),
      )
      .mockResolvedValueOnce(
        row("instance-1", {
          ...latest,
          gmNotes: "Ключ у капитана",
          portraitAssetId: "portrait-b",
          currentLocationId: "location-b",
          revision: 6,
        }),
      );
    vi.mocked(fetchWorldContentInstance).mockResolvedValue(latest);

    renderComponent(
      <WorldContentInstancesPanel
        canonical={canonical}
        assets={assets}
        maps={maps}
        locations={locations}
      />,
    );
    await screen.findByRole("button", { name: /Крепость/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Изменить выбранный экземпляр" }),
    );
    await userEvent.type(
      screen.getByLabelText("Заметки мастера"),
      "Ключ у капитана",
    );
    await userEvent.click(screen.getByRole("button", { name: "Портрет B" }));
    const locationPicker = screen.getByRole("combobox", {
      name: "Текущее место на карте кампании",
    });
    await userEvent.click(locationPicker);
    await userEvent.click(screen.getByRole("option", { name: "Берег — Маяк" }));
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await screen.findByText(/Актуальная версия — ревизия 5/);
    expect(screen.getByLabelText("Заметки мастера")).toHaveValue(
      "Ключ у капитана",
    );
    expect(screen.getByText("Состояние: Осаждена")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Портрет B" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(locationPicker).toHaveTextContent("Берег — Маяк");

    await userEvent.click(
      screen.getByRole("button", {
        name: "Сохранить черновик поверх ревизии 5",
      }),
    );
    await waitFor(() =>
      expect(updateWorldContentInstance).toHaveBeenCalledTimes(2),
    );
    expect(updateWorldContentInstance).toHaveBeenLastCalledWith(
      "instance-1",
      expect.objectContaining({
        revision: 5,
        gmNotes: "Ключ у капитана",
        portraitAssetId: "portrait-b",
        currentLocationId: "location-b",
      }),
    );
    const rebased = vi.mocked(updateWorldContentInstance).mock.calls[1]![1];
    expect(rebased).not.toHaveProperty("currentState");
    expect(rebased).not.toHaveProperty("displayNameOverride");
    expect(fetchWorldContentInstance).toHaveBeenCalledWith("instance-1");
  });

  it("retries an uncertain create with the exact same immutable payload", async () => {
    vi.mocked(fetchWorldContentInstances).mockResolvedValue([]);
    vi.mocked(createWorldContentInstance)
      .mockRejectedValueOnce(new Error("network lost after submit"))
      .mockResolvedValueOnce(row("created", { displayNameOverride: "Башня" }));
    renderComponent(<WorldContentInstancesPanel canonical={canonical} />);
    await screen.findByText(
      "В этой кампании пока нет экземпляров этой сущности.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Создать экземпляр" }),
    );
    await userEvent.type(screen.getByLabelText("Имя в этой кампании"), "Башня");
    await userEvent.click(screen.getByRole("button", { name: /^Создать$/ }));
    await screen.findByRole("alert");

    expect(screen.getByLabelText("Имя в этой кампании")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Создать экземпляр" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить тот же запрос" }),
    );
    await screen.findByRole("button", { name: /Башня/ });
    expect(createWorldContentInstance).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createWorldContentInstance).mock.calls[1]![0]).toEqual(
      vi.mocked(createWorldContentInstance).mock.calls[0]![0],
    );
  });

  it("does not paint a late create response after the selected canonical changes", async () => {
    let resolveCreate!: (value: ReturnType<typeof row>) => void;
    vi.mocked(fetchWorldContentInstances).mockImplementation(
      async (id: string) => (id === "canon-1" ? [] : []),
    );
    vi.mocked(createWorldContentInstance).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const view = renderComponent(
      <WorldContentInstancesPanel canonical={canonical} />,
    );
    await screen.findByText(
      "В этой кампании пока нет экземпляров этой сущности.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Создать экземпляр" }),
    );
    await userEvent.type(
      screen.getByLabelText("Имя в этой кампании"),
      "Старый канон",
    );
    await userEvent.click(screen.getByRole("button", { name: /^Создать$/ }));
    await waitFor(() =>
      expect(createWorldContentInstance).toHaveBeenCalledTimes(1),
    );

    view.rerender(
      <WorldContentInstancesPanel
        canonical={{ id: "canon-2", name: "Новый канон", type: "LOCATION" }}
      />,
    );
    await screen.findByText(
      "В этой кампании пока нет экземпляров этой сущности.",
    );
    resolveCreate(
      row("late", {
        worldContentId: canonical.id,
        displayNameOverride: "Старый канон",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText(/Новый канон/)).toBeInTheDocument();
    expect(screen.queryByText("Старый канон")).not.toBeInTheDocument();
  });

  it("retries an uncertain update with the exact same id and immutable payload", async () => {
    const initial = row("instance-1", {
      currentState: "Открыта",
      portraitAssetId: "portrait-a",
      currentLocationId: "location-a",
      revision: 3,
    });
    const assets = [
      portrait("portrait-a", "Портрет A"),
      portrait("portrait-b", "Портрет B"),
    ];
    const maps = [{ id: "map-a", name: "Берег" }];
    const locations = [
      { id: "location-a", mapId: "map-a", name: "Причал" },
      { id: "location-b", mapId: "map-a", name: "Маяк" },
    ];
    let rejectUpdate!: (reason: Error) => void;
    vi.mocked(fetchWorldContentInstances).mockResolvedValue([initial]);
    vi.mocked(updateWorldContentInstance)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectUpdate = reject;
          }),
      )
      .mockResolvedValueOnce(
        row("instance-1", {
          currentState: "Закрыта",
          portraitAssetId: "portrait-b",
          currentLocationId: "location-b",
          revision: 4,
        }),
      );
    renderComponent(
      <WorldContentInstancesPanel
        canonical={canonical}
        assets={assets}
        maps={maps}
        locations={locations}
      />,
    );
    await screen.findByRole("button", { name: /Открыта/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Изменить выбранный экземпляр" }),
    );
    await userEvent.clear(screen.getByLabelText("Состояние"));
    await userEvent.type(screen.getByLabelText("Состояние"), "Закрыта");
    await userEvent.click(screen.getByRole("button", { name: "Портрет B" }));
    const locationPicker = screen.getByRole("combobox", {
      name: "Текущее место на карте кампании",
    });
    await userEvent.click(locationPicker);
    await userEvent.click(screen.getByRole("option", { name: "Берег — Маяк" }));
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await waitFor(() =>
      expect(updateWorldContentInstance).toHaveBeenCalledTimes(1),
    );
    rejectUpdate(new Error("network outcome unknown"));
    await screen.findByRole("alert");
    const snapshot = vi.mocked(updateWorldContentInstance).mock.calls[0]!;
    expect(screen.getByLabelText("Состояние")).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить тот же запрос" }),
    );
    await screen.findByRole("button", { name: /Закрыта/ });
    expect(vi.mocked(updateWorldContentInstance).mock.calls[1]).toEqual(
      snapshot,
    );
    expect(snapshot[1]).toMatchObject({
      portraitAssetId: "portrait-b",
      currentLocationId: "location-b",
    });
    expect(screen.getByRole("button", { name: "Портрет B" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(locationPicker).toHaveTextContent("Берег — Маяк");
  });

  it("cancels by default, then deletes only the selected campaign instance and selects its sibling", async () => {
    const first = row("instance-delete-a", { displayNameOverride: "Сторож" });
    const sibling = row("instance-delete-b", {
      displayNameOverride: "Дубликат в кампании",
    });
    vi.mocked(fetchWorldContentInstances)
      .mockResolvedValueOnce([first, sibling])
      .mockResolvedValueOnce([sibling]);
    vi.mocked(deleteWorldContentInstance).mockResolvedValue(null);
    renderComponent(<WorldContentInstancesPanel canonical={canonical} />);

    await screen.findByRole("button", { name: /Сторож/ });
    const trigger = screen.getByRole("button", { name: "Удалить экземпляр…" });
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Удаление экземпляра" });
    expect(dialog).toHaveTextContent("«Сторож»");
    expect(dialog).toHaveTextContent(
      "Каноническая сущность и другие экземпляры не изменятся.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(deleteWorldContentInstance).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр…" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр" }),
    );
    await screen.findByRole("button", { name: /Дубликат в кампании/ });
    expect(deleteWorldContentInstance).toHaveBeenCalledWith(
      first.id,
      expect.objectContaining({
        revision: first.revision,
        actionId: expect.any(String),
      }),
    );
    expect(fetchWorldContentInstances).toHaveBeenLastCalledWith(canonical.id);
    expect(
      await screen.findByText(/Экземпляр удалён из этой кампании/),
    ).toBeTruthy();
    expect(sibling.worldContentId).toBe(first.worldContentId);
  });

  it("requires explicit discard of dirty edit before deletion", async () => {
    const selected = row("instance-dirty-delete", {
      displayNameOverride: "Текущий караван",
    });
    vi.mocked(fetchWorldContentInstances).mockResolvedValue([selected]);
    vi.mocked(deleteWorldContentInstance).mockResolvedValue(null);
    renderComponent(<WorldContentInstancesPanel canonical={canonical} />);
    await screen.findByRole("button", { name: /Текущий караван/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Изменить выбранный экземпляр" }),
    );
    await userEvent.type(screen.getByLabelText("Состояние"), "Новая заметка");
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр…" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Удаление экземпляра" });
    expect(dialog).toHaveTextContent(
      "Несохранённые изменения этого экземпляра будут отброшены",
    );
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.getByLabelText("Состояние")).toHaveValue("Новая заметка");
    expect(deleteWorldContentInstance).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр…" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Отбросить изменения и удалить" }),
    );
    await waitFor(() =>
      expect(deleteWorldContentInstance).toHaveBeenCalledTimes(1),
    );
    expect(deleteWorldContentInstance).toHaveBeenCalledWith(
      selected.id,
      expect.objectContaining({ revision: selected.revision }),
    );
  });

  it("retries an ambiguous deletion with the exact same revision and action id", async () => {
    const selected = row("instance-ambiguous-delete", {
      displayNameOverride: "Сундук",
    });
    vi.mocked(fetchWorldContentInstances)
      .mockResolvedValueOnce([selected])
      .mockResolvedValueOnce([selected])
      .mockResolvedValueOnce([]);
    vi.mocked(deleteWorldContentInstance)
      .mockRejectedValueOnce(new Error("transport outcome unknown"))
      .mockResolvedValueOnce(null);
    renderComponent(<WorldContentInstancesPanel canonical={canonical} />);
    await screen.findByRole("button", { name: /Сундук/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр…" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр" }),
    );
    await screen.findByText(/Ответ на удаление не подтверждён/);
    expect(
      screen.getByRole("dialog", { name: "Удаление экземпляра" }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить то же удаление" }),
    );
    await screen.findByText(/Экземпляр удалён из этой кампании/);
    expect(vi.mocked(deleteWorldContentInstance).mock.calls[1]).toEqual(
      vi.mocked(deleteWorldContentInstance).mock.calls[0],
    );
    expect(
      screen.getByText("В этой кампании пока нет экземпляров этой сущности."),
    ).toBeTruthy();
  });

  it("requires a new confirmation and action envelope after a delete CAS conflict", async () => {
    const initial = row("instance-delete-conflict", {
      displayNameOverride: "Страж",
      revision: 4,
    });
    const latest = row(initial.id, {
      ...initial,
      revision: 5,
      currentState: "Обновлён другим мастером",
    });
    vi.mocked(fetchWorldContentInstances)
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([]);
    vi.mocked(fetchWorldContentInstance).mockResolvedValue(latest);
    vi.mocked(deleteWorldContentInstance)
      .mockRejectedValueOnce(
        new ApiError(
          409,
          "WORLD_CONTENT_INSTANCE_REVISION_CONFLICT",
          "Conflict",
        ),
      )
      .mockResolvedValueOnce(null);
    renderComponent(<WorldContentInstancesPanel canonical={canonical} />);
    await screen.findByRole("button", { name: /Страж/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр…" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр" }),
    );
    await screen.findByText(/не удалён.*ревизия 5/i);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /ревизия 5/ })).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр…" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр" }),
    );
    await screen.findByText(
      "В этой кампании пока нет экземпляров этой сущности.",
    );
    const calls = vi.mocked(deleteWorldContentInstance).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![1]).toMatchObject({ revision: 4 });
    expect(calls[1]![1]).toMatchObject({ revision: 5 });
    expect(calls[1]![1].actionId).not.toBe(calls[0]![1].actionId);
  });

  it("reports external 404 as unavailable rather than claiming its own deletion", async () => {
    const selected = row("instance-external-delete", {
      displayNameOverride: "Сундук",
    });
    vi.mocked(fetchWorldContentInstances)
      .mockResolvedValueOnce([selected])
      .mockResolvedValueOnce([]);
    vi.mocked(deleteWorldContentInstance).mockRejectedValueOnce(
      new ApiError(404, "WORLD_CONTENT_INSTANCE_NOT_FOUND", "Missing"),
    );
    renderComponent(<WorldContentInstancesPanel canonical={canonical} />);
    await screen.findByRole("button", { name: /Сундук/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр…" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр" }),
    );
    await screen.findByText(/не подтверждает, что его удалил данный запрос/);
    expect(
      screen.getByText("В этой кампании пока нет экземпляров этой сущности."),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not show an old ambiguous delete prompt when reconciliation rejects after switching canonicals", async () => {
    const selected = row("instance-old-canonical", {
      displayNameOverride: "Старый объект",
    });
    let rejectReconciliation!: (error: Error) => void;
    vi.mocked(fetchWorldContentInstances)
      .mockResolvedValueOnce([selected])
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectReconciliation = reject;
          }),
      )
      .mockResolvedValueOnce([]);
    vi.mocked(deleteWorldContentInstance).mockRejectedValueOnce(
      new Error("transport outcome unknown"),
    );
    const view = renderComponent(
      <WorldContentInstancesPanel canonical={canonical} />,
    );
    await screen.findByRole("button", { name: /Старый объект/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр…" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить экземпляр" }),
    );
    await waitFor(() => expect(rejectReconciliation).toBeTypeOf("function"));

    const nextCanonical = {
      id: "canon-2",
      name: "Новый канон",
      type: "LOCATION",
    };
    view.rerender(<WorldContentInstancesPanel canonical={nextCanonical} />);
    await screen.findByText(
      "В этой кампании пока нет экземпляров этой сущности.",
    );
    rejectReconciliation(new Error("reconciliation unavailable"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      screen.queryByRole("dialog", { name: "Удаление экземпляра" }),
    ).toBeNull();
    expect(screen.queryByText(/Ответ на удаление не подтверждён/)).toBeNull();
    expect(screen.queryByText(/Старый объект/)).toBeNull();
    expect(screen.getByText(/Новый канон/)).toBeInTheDocument();
    vi.mocked(fetchWorldContentInstances)
      .mockResolvedValueOnce([selected])
      .mockResolvedValueOnce([]);
    vi.mocked(deleteWorldContentInstance).mockResolvedValueOnce(null);
    view.rerender(<WorldContentInstancesPanel canonical={canonical} />);
    await screen.findByRole("dialog", { name: "Удаление экземпляра" });
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить то же удаление" }),
    );
    await screen.findByText(/Экземпляр удалён из этой кампании/);
    expect(vi.mocked(deleteWorldContentInstance).mock.calls[1]).toEqual(
      vi.mocked(deleteWorldContentInstance).mock.calls[0],
    );
  });
});
