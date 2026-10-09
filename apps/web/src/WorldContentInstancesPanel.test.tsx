// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateWorldContentInstance,
  UpdateWorldContentInstance,
  WorldContentInstanceDto,
} from "@arken/contracts";
import { ApiError } from "./api";
import {
  createWorldContentInstance,
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
      revision: 4,
    });
    const latest = row("instance-1", {
      displayNameOverride: "Новая крепость",
      currentState: "Осаждена",
      revision: 5,
    });
    vi.mocked(fetchWorldContentInstances).mockResolvedValue([original]);
    vi.mocked(updateWorldContentInstance)
      .mockRejectedValueOnce(
        new ApiError(409, "WORLD_CONTENT_INSTANCE_CONFLICT", "Конфликт"),
      )
      .mockResolvedValueOnce(
        row("instance-1", {
          ...latest,
          gmNotes: "Ключ у капитана",
          revision: 6,
        }),
      );
    vi.mocked(fetchWorldContentInstance).mockResolvedValue(latest);

    renderComponent(<WorldContentInstancesPanel canonical={canonical} />);
    await screen.findByRole("button", { name: /Крепость/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Изменить выбранный экземпляр" }),
    );
    await userEvent.type(
      screen.getByLabelText("Заметки мастера"),
      "Ключ у капитана",
    );
    await userEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await screen.findByText(/Актуальная версия — ревизия 5/);
    expect(screen.getByLabelText("Заметки мастера")).toHaveValue(
      "Ключ у капитана",
    );
    expect(screen.getByText("Состояние: Осаждена")).toBeInTheDocument();

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
      expect.objectContaining({ revision: 5, gmNotes: "Ключ у капитана" }),
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
      <WorldContentInstancesPanel key="canon-1" canonical={canonical} />,
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
        key="canon-2"
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
    const initial = row("instance-1", { currentState: "Открыта", revision: 3 });
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
        row("instance-1", { currentState: "Закрыта", revision: 4 }),
      );
    renderComponent(<WorldContentInstancesPanel canonical={canonical} />);
    await screen.findByRole("button", { name: /Открыта/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Изменить выбранный экземпляр" }),
    );
    await userEvent.clear(screen.getByLabelText("Состояние"));
    await userEvent.type(screen.getByLabelText("Состояние"), "Закрыта");
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
  });
});
