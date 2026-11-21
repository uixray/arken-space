// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "./test-support/render";
const state = vi.hoisted(() => ({
  fail: true,
  commands: [] as Record<string, unknown>[],
}));
vi.mock("./creation-client", async (original) => {
  const actual = await original<typeof import("./creation-client")>();
  const listing = {
    id: "00000000-0000-4000-8000-000000000001",
    listingVersionId: "00000000-0000-4000-8000-000000000002",
    revision: 0,
    enabled: true,
    soldCount: 0,
    author: { membershipId: "member", displayName: "Автор" },
    terms: {
      versionId: "00000000-0000-4000-8000-000000000007",
      mode: "TEMPLATE",
      priceCopper: 10,
      maxPurchases: null,
      availableUntil: null,
      collection: "",
      note: "",
    },
    source: {
      versionId: "00000000-0000-4000-8000-000000000007",
      mode: "TEMPLATE",
      payout: "AUTHOR",
      payoutCharacterId: "00000000-0000-4000-8000-000000000004",
    },
    card: {
      name: "Тестовый лот",
      description: "",
      requirements: [],
      components: [],
      manualEffects: [],
    },
    fabrication: null,
  };
  return {
    ...actual,
    creationApi: async (_c: unknown, path: string) =>
      path.includes("policy")
        ? { policy: { enabled: true }, revision: 0 }
        : path.includes("recipes")
          ? { recipes: [] }
          : {
              items:
                path.includes("listings") || path.includes("store/mine")
                  ? [listing]
                  : [],
              nextAfter: null,
            },
    creationRequest: async (
      _c: unknown,
      path: string,
      body: Record<string, unknown>,
    ) => {
      if (path.includes("store/quote"))
        return {
          id: "00000000-0000-4000-8000-000000000003",
          characterId: body.characterId,
          listingVersionId: body.listingVersionId,
          name: "Тестовый лот",
          mode: "TEMPLATE",
          total: { copper: 10, sp: 0, materials: [] },
          priceCopper: 10,
          authorIncomeCopper: 10,
          sinkCopper: 0,
          affordable: true,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        };
      if (path.includes("store/commit")) {
        state.commands.push(body);
        if (state.fail) {
          state.fail = false;
          throw new Error("Ответ потерян");
        }
        return { actionId: body.actionId, quoteId: body.quoteId };
      }
      if (path.includes("store/listings")) {
        state.commands.push(body);
        if (state.fail) {
          state.fail = false;
          throw new Error("Ответ потерян");
        }
        return {
          listingId: body.listingId,
          revision: 1,
          versionId: "00000000-0000-4000-8000-000000000008",
        };
      }
      throw new Error(path);
    },
  };
});
const { CreationStore } = await import("./CreationStore");
const { useCreationSession } = await import("./use-creation-session");
const character = {
  id: "00000000-0000-4000-8000-000000000004",
  name: "Покупатель",
  ownerMembershipId: "member",
};
function Harness() {
  const s = useCreationSession({
    campaignId: "campaign",
    membershipId: "member",
  });
  return (
    <>
      {s.pending && (
        <button onClick={() => void s.recover()}>Восстановить</button>
      )}
      <CreationStore
        session={s}
        character={character}
        characters={[character]}
        gm={false}
        active
      />
    </>
  );
}
afterEach(() => {
  localStorage.clear();
  state.fail = true;
  state.commands = [];
  vi.restoreAllMocks();
});
it("reconciles a purchase recovered after a lost reply", async () => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _n: string,
        _o: unknown,
        cb: (lease: object) => unknown,
      ) => cb({}),
    },
  });
  const user = userEvent.setup();
  renderComponent(<Harness />);
  await user.click(
    await screen.findByRole("button", { name: "Выбрать предложение" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Рассчитать покупку на сервере" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Оплатить и получить" }),
  );
  await user.click(await screen.findByRole("button", { name: "Восстановить" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Рассчитать покупку на сервере" }),
    ).not.toBeInTheDocument(),
  );
  expect(state.commands).toHaveLength(2);
  expect(state.commands[1]).toEqual(state.commands[0]);
  expect(localStorage.length).toBe(0);
});
it("keeps the listing editor mounted and closes it after recovering the same save", async () => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _n: string,
        _o: unknown,
        cb: (lease: object) => unknown,
      ) => cb({}),
    },
  });
  const user = userEvent.setup();
  renderComponent(<Harness />);
  await user.click(screen.getByRole("button", { name: "Мои лоты" }));
  await user.click(
    await screen.findByRole("button", { name: "Управлять лотом" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Сохранить и выставить" }),
  );
  expect(
    await screen.findByRole("button", { name: "Восстановить" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Витрина" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Восстановить" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Сохранить и выставить" }),
    ).not.toBeInTheDocument(),
  );
  expect(state.commands).toHaveLength(2);
  expect(state.commands[1]).toEqual(state.commands[0]);
  expect(localStorage.length).toBe(0);
});
it("preserves unsaved listing terms when a tab change is declined", async () => {
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  renderComponent(<Harness />);
  await user.click(screen.getByRole("button", { name: "Мои лоты" }));
  await user.click(
    await screen.findByRole("button", { name: "Управлять лотом" }),
  );
  const price = screen.getByRole("spinbutton", {
    name: "Цена продажи, медные",
  });
  await user.clear(price);
  await user.type(price, "42");
  await user.click(screen.getByRole("button", { name: "Витрина" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(price).toHaveValue(42);
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "Витрина" }));
  expect(
    screen.queryByRole("spinbutton", { name: "Цена продажи, медные" }),
  ).not.toBeInTheDocument();
});
