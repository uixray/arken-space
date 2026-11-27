// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "./test-support/render";
const mocks = vi.hoisted(() => ({ api: vi.fn(), request: vi.fn() }));
vi.mock("./economy-client", () => ({
  economyApi: mocks.api,
  economyRequest: mocks.request,
  copperLabel: (n: number) => String(n),
}));
vi.mock("./ui/ArkenDialog", () => ({
  ArkenDialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
const { EconomyWorkspace } = await import("./EconomyWorkspace");
const key = "arken.shop.pending.v1.campaign.player";
afterEach(() => {
  localStorage.removeItem(key);
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it.each(["", "{", "null", "[]", '{"actionId":"bad","quoteId":"bad"}'])(
  "blocks new purchases with actionable guidance when pending record is corrupt: %s",
  async (raw) => {
    localStorage.setItem(key, raw);
    mocks.api.mockImplementation(async (_context: unknown, url: string) =>
      url.endsWith("/history")
        ? { items: [], nextCursor: null }
        : { enabled: true, merchants: [], date: null },
    );
    renderComponent(
      <EconomyWorkspace
        campaignId="campaign"
        membershipId="player"
        gm={false}
        characters={[{ id: "hero", name: "Hero" }]}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Повреждена сохранённая квитанция запроса. Не создавайте новую покупку до проверки истории.",
    );
    await waitFor(() =>
      expect(screen.getByRole("group", { name: "Покупка" })).toBeDisabled(),
    );
    expect(localStorage.getItem(key)).toBe(raw);
    expect(mocks.request).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Обновить магазины и историю" }),
    );
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(4));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Повреждена сохранённая квитанция запроса",
    );
    expect(screen.getByRole("group", { name: "Покупка" })).toBeDisabled();
  },
);
it("clears recovery only after a complete matching purchase receipt", async () => {
  const pending = {
    actionId: "00000000-0000-4000-8000-000000000001",
    quoteId: "00000000-0000-4000-8000-000000000002",
  };
  localStorage.setItem(key, JSON.stringify(pending));
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object) => unknown,
      ) => callback({}),
    },
  });
  mocks.api.mockImplementation(async (_context: unknown, url: string) =>
    url.endsWith("/history")
      ? { items: [], nextCursor: null }
      : { enabled: true, merchants: [], date: null },
  );
  mocks.request.mockResolvedValue({
    ...pending,
    characterId: "00000000-0000-4000-8000-000000000003",
    inventoryInstanceId: "00000000-0000-4000-8000-000000000004",
    itemName: "Тест",
    merchantName: "Лавка",
    quantity: 1,
    totalCopper: 3,
    purchasedAt: "2026-11-04T00:00:00.000Z",
    date: { year: 1, month: "Месяц", day: 1, season: "Лето" },
  });
  renderComponent(
    <EconomyWorkspace
      campaignId="campaign"
      membershipId="player"
      gm={false}
      characters={[]}
      onClose={() => {}}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Проверить / повторить ту же покупку",
    }),
  );
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
  expect(await screen.findByRole("status")).toHaveTextContent("Куплено: Тест");
});
it("preserves a different saved command if storage changes before the receipt arrives", async () => {
  const pending = {
    actionId: "00000000-0000-4000-8000-000000000001",
    quoteId: "00000000-0000-4000-8000-000000000002",
  };
  const changed = {
    ...pending,
    quoteId: "00000000-0000-4000-8000-000000000099",
  };
  localStorage.setItem(key, JSON.stringify(pending));
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object) => unknown,
      ) => callback({}),
    },
  });
  mocks.api.mockImplementation(async (_context: unknown, url: string) =>
    url.endsWith("/history")
      ? { items: [], nextCursor: null }
      : { enabled: true, merchants: [], date: null },
  );
  mocks.request.mockImplementation(async () => {
    localStorage.setItem(key, JSON.stringify(changed));
    return {
      ...pending,
      characterId: "00000000-0000-4000-8000-000000000003",
      inventoryInstanceId: "00000000-0000-4000-8000-000000000004",
      itemName: "Тест",
      merchantName: "Лавка",
      quantity: 1,
      totalCopper: 3,
      purchasedAt: "2026-11-04T00:00:00.000Z",
      date: { year: 1, month: "Месяц", day: 1, season: "Лето" },
    };
  });
  renderComponent(
    <EconomyWorkspace
      campaignId="campaign"
      membershipId="player"
      gm={false}
      characters={[]}
      onClose={() => {}}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Проверить / повторить ту же покупку",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Сохранённая покупка изменилась",
  );
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(changed);
  expect(
    screen.getByRole("region", { name: "Неподтверждённая покупка" }),
  ).toBeInTheDocument();
});
it.each([
  {},
  {
    actionId: "00000000-0000-4000-8000-000000000001",
    quoteId: "00000000-0000-4000-8000-000000000099",
    characterId: "00000000-0000-4000-8000-000000000003",
    inventoryInstanceId: "00000000-0000-4000-8000-000000000004",
    itemName: "Тест",
    merchantName: "Лавка",
    quantity: 1,
    totalCopper: 3,
    purchasedAt: "2026-11-04T00:00:00.000Z",
    date: { year: 1, month: "Месяц", day: 1, season: "Лето" },
  },
])(
  "retains an unresolved purchase when a successful response does not confirm it",
  async (response) => {
    const pending = {
      actionId: "00000000-0000-4000-8000-000000000001",
      quoteId: "00000000-0000-4000-8000-000000000002",
    };
    localStorage.setItem(key, JSON.stringify(pending));
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: object) => unknown,
        ) => callback({}),
      },
    });
    mocks.api.mockImplementation(async (_context: unknown, url: string) =>
      url.endsWith("/history")
        ? { items: [], nextCursor: null }
        : { enabled: true, merchants: [], date: null },
    );
    mocks.request.mockResolvedValue(response);
    renderComponent(
      <EconomyWorkspace
        campaignId="campaign"
        membershipId="player"
        gm={false}
        characters={[]}
        onClose={() => {}}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Проверить / повторить ту же покупку",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ответ не подтверждает сохранённую покупку",
    );
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(pending);
    expect(
      screen.getByRole("region", { name: "Неподтверждённая покупка" }),
    ).toBeInTheDocument();
  },
);
