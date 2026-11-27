// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "./test-support/render";
const state = vi.hoisted(() => ({
  done: false,
  failOnce: false,
  transferMode: false,
  transferred: false,
  removeDuringCommit: false,
  corruptDuringCommit: false,
  requests: [] as Array<{ path: string; body: Record<string, unknown> }>,
}));
vi.mock("./creation-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./creation-client")>();
  const recipeId = "00000000-0000-4000-8000-000000000001",
    characterId = "00000000-0000-4000-8000-000000000002";
  const cost = { copper: 7, sp: 0, materials: [] },
    zero = { copper: 0, sp: 0, materials: [] };
  return {
    ...actual,
    creationApi: async (_context: unknown, path: string) => {
      if (path.includes("recipes"))
        return {
          recipes: [
            {
              recipe: {
                id: recipeId,
                name: "Тестовый рецепт",
                enabled: true,
                revision: 0,
              },
              version: { id: recipeId, number: 1, published: true },
              source: {
                name: "Тестовый рецепт",
                operation: "CRAFT",
                reason: "Проба",
                inputs: [],
                output: { level: 1, stage: "CRAFTED" },
                cost,
                refund: null,
              },
            },
          ],
        };
      if (path.includes("objects"))
        return {
          items:
            state.done || (state.transferMode && !state.transferred)
              ? [
                  {
                    id: state.transferMode
                      ? "00000000-0000-4000-8000-000000000005"
                      : "made",
                    versionId: recipeId,
                    kind: "SKILL",
                    level: 1,
                    stage: "CRAFTED",
                    revision: 0,
                    snapshot: {
                      name: "Созданный навык",
                      description: "",
                      appearance: "",
                      entryData: {},
                    },
                    parentObjectIds: [],
                    rulesEnabled: true,
                    review: { decision: "APPROVED" },
                  },
                ]
              : [],
          nextAfter: null,
        };
      if (path.includes("operations")) return { items: [], nextAfter: null };
      throw new Error(`Unexpected read ${path}`);
    },
    creationRequest: async (
      _context: unknown,
      path: string,
      body: Record<string, unknown>,
    ) => {
      state.requests.push({ path, body });
      if (path.includes("operations/quote"))
        return {
          id: "00000000-0000-4000-8000-000000000003",
          characterId,
          recipeVersionId: recipeId,
          recipeName: "Тестовый рецепт",
          operation: "CRAFT",
          inputObjectIds: [],
          output: {
            name: "Созданный навык",
            level: 1,
            stage: "CRAFTED",
            kind: "SKILL",
          },
          spend: cost,
          returns: zero,
          affordable: true,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        };
      if (path.includes("operations/commit")) {
        state.done = true;
        if (state.failOnce) {
          state.failOnce = false;
          throw new Error("Ответ потерян");
        }
        if (state.removeDuringCommit)
          localStorage.removeItem("arken.creation.pending.v1.campaign.member");
        if (state.corruptDuringCommit)
          localStorage.setItem(
            "arken.creation.pending.v1.campaign.member",
            "{",
          );
        return { actionId: body.actionId, quoteId: body.quoteId };
      }
      if (path.includes("objects/transfer")) {
        state.transferred = true;
        if (state.failOnce) {
          state.failOnce = false;
          throw new Error("Ответ потерян");
        }
        return {
          actionId: body.actionId,
          objectId: body.objectId,
          revision: 1,
        };
      }
      throw new Error(`Unexpected write ${path}`);
    },
  };
});
const { CreationObjects } = await import("./CreationObjects");
const { useCreationSession } = await import("./use-creation-session");
const character = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Игрок",
  ownerMembershipId: "00000000-0000-4000-8000-000000000004",
};
function Harness() {
  const s = useCreationSession({
    campaignId: "campaign",
    membershipId: "member",
  });
  return (
    <>
      <span role="alert">{s.error}</span>
      {s.pending && (
        <button onClick={() => void s.recover()}>Восстановить действие</button>
      )}
      <CreationObjects
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
  vi.restoreAllMocks();
  localStorage.clear();
  state.done = false;
  state.failOnce = false;
  state.transferMode = false;
  state.transferred = false;
  state.removeDuringCommit = false;
  state.corruptDuringCommit = false;
  state.requests = [];
});
it("reconciles a recovered transfer without leaving the old transfer form open", async () => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lease: object) => unknown,
      ) => callback({}),
    },
  });
  state.transferMode = true;
  state.failOnce = true;
  const target = {
    id: "00000000-0000-4000-8000-000000000006",
    name: "Другой персонаж",
    ownerMembershipId: null,
  };
  function GmHarness() {
    const s = useCreationSession({
      campaignId: "campaign",
      membershipId: "member",
    });
    return (
      <>
        {s.pending && (
          <button onClick={() => void s.recover()}>
            Восстановить действие
          </button>
        )}
        <CreationObjects
          session={s}
          character={character}
          characters={[character, target]}
          gm
          active
        />
      </>
    );
  }
  const user = userEvent.setup();
  renderComponent(<GmHarness />);
  await user.click(
    await screen.findByRole("button", { name: "Передать персонажу" }),
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Получатель" }),
    target.id,
  );
  await user.type(
    screen.getByRole("textbox", { name: "Причина" }),
    "  Передача  ",
  );
  await user.click(
    screen.getByRole("button", { name: "Подтвердить передачу" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Восстановить действие" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("group", { name: /Передать предмет/ }),
    ).not.toBeInTheDocument(),
  );
  const commands = state.requests.filter((r) =>
    r.path.includes("objects/transfer"),
  );
  expect(commands).toHaveLength(2);
  expect(commands[1]!.body).toEqual(commands[0]!.body);
  expect(commands[0]!.body.reason).toBe("Передача");
  expect(localStorage.length).toBe(0);
});
it("preserves malformed pending work and explains recovery rather than showing JSON parser errors", async () => {
  const key = "arken.creation.pending.v1.campaign.member";
  localStorage.setItem(key, "{");
  renderComponent(<Harness />);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Сохранённое действие повреждено. Сначала проверьте историю с мастером.",
    ),
  );
  expect(localStorage.getItem(key)).toBe("{");
  expect(state.requests).toHaveLength(0);
});
it("keeps the damaged-queue warning after an unrelated inspection", async () => {
  const key = "arken.creation.pending.v1.campaign.member";
  localStorage.setItem(key, "{");
  function InspectHarness() {
    const s = useCreationSession({
      campaignId: "campaign",
      membershipId: "member",
    });
    return (
      <>
        <p role="alert">{s.error}</p>
        <button onClick={() => void s.inspect(async () => ({}))}>
          Прочитать
        </button>
        <output>{String(s.locked)}</output>
      </>
    );
  }
  renderComponent(<InspectHarness />);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Сохранённое действие повреждено",
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Прочитать" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Сохранённое действие повреждено",
    ),
  );
  expect(screen.getByText("true")).toBeInTheDocument();
  expect(localStorage.getItem(key)).toBe("{");
});
it("shows a server quote then refreshes the player's objects after confirmation", async () => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lease: object) => unknown,
      ) => callback({}),
    },
  });
  const user = userEvent.setup();
  renderComponent(<Harness />);
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Рецепт мастера" }),
    "00000000-0000-4000-8000-000000000001",
  );
  await user.click(
    screen.getByRole("button", { name: "Получить точный расчёт" }),
  );
  expect(
    await screen.findByRole("region", { name: "Подтверждение операции" }),
  ).toHaveTextContent("Созданный навык");
  await user.click(
    screen.getByRole("button", { name: "Подтвердить расход и результат" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Созданный навык")).toBeInTheDocument(),
  );
  expect(
    state.requests.filter((r) => r.path.includes("operations/commit")),
  ).toHaveLength(1);
  expect(localStorage.length).toBe(0);
});
it("retains and retries the same action after a lost response", async () => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lease: object) => unknown,
      ) => callback({}),
    },
  });
  state.failOnce = true;
  const user = userEvent.setup();
  renderComponent(<Harness />);
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Рецепт мастера" }),
    "00000000-0000-4000-8000-000000000001",
  );
  await user.click(
    screen.getByRole("button", { name: "Получить точный расчёт" }),
  );
  await screen.findByRole("region", { name: "Подтверждение операции" });
  await user.click(
    screen.getByRole("button", { name: "Подтвердить расход и результат" }),
  );
  expect(
    await screen.findByRole("button", { name: "Восстановить действие" }),
  ).toBeInTheDocument();
  expect(localStorage.length).toBe(1);
  await user.click(
    screen.getByRole("button", { name: "Восстановить действие" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Созданный навык")).toBeInTheDocument(),
  );
  const commits = state.requests.filter((r) =>
    r.path.includes("operations/commit"),
  );
  expect(commits).toHaveLength(2);
  expect(commits[1]!.body).toEqual(commits[0]!.body);
  expect(localStorage.length).toBe(0);
});
it("does not mark a result as reconciled if the saved command disappears in flight", async () => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lease: object) => unknown,
      ) => callback({}),
    },
  });
  state.removeDuringCommit = true;
  const user = userEvent.setup();
  renderComponent(<Harness />);
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Рецепт мастера" }),
    "00000000-0000-4000-8000-000000000001",
  );
  await user.click(
    screen.getByRole("button", { name: "Получить точный расчёт" }),
  );
  await screen.findByRole("region", { name: "Подтверждение операции" });
  await user.click(
    screen.getByRole("button", { name: "Подтвердить расход и результат" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "команда исчезла или изменилась",
    ),
  );
  expect(
    screen.getByRole("button", { name: "Восстановить действие" }),
  ).toBeInTheDocument();
});
it("retains a corrupt in-flight record and blocks reconciliation", async () => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lease: object) => unknown,
      ) => callback({}),
    },
  });
  state.corruptDuringCommit = true;
  const user = userEvent.setup();
  renderComponent(<Harness />);
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Рецепт мастера" }),
    "00000000-0000-4000-8000-000000000001",
  );
  await user.click(
    screen.getByRole("button", { name: "Получить точный расчёт" }),
  );
  await screen.findByRole("region", { name: "Подтверждение операции" });
  await user.click(
    screen.getByRole("button", { name: "Подтвердить расход и результат" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Сохранённое действие повреждено",
    ),
  );
  expect(
    localStorage.getItem("arken.creation.pending.v1.campaign.member"),
  ).toBe("{");
  expect(
    screen.getByRole("button", { name: "Восстановить действие" }),
  ).toBeInTheDocument();
});
