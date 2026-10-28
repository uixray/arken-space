// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { entryRollRequestSchema, type CharacterDto } from "@arken/contracts";
import {
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "../test-support/render";
import { QuickRollPanel } from "./QuickRollPanel";

vi.mock("../use-panel-resize", () => ({
  usePanelResize: () => ({ height: null, handleProps: {} }),
}));

beforeEach(() => window.localStorage.clear());

for (const kind of ["ABILITY", "SKILL"] as const) {
  for (const executable of [false, true]) {
    it(`${kind} ${executable ? "executes its roll" : kind === "ABILITY" ? "activates without a roll" : "shares without an invalid execute request"}`, async () => {
      const entry = {
        id: "entry",
        kind,
        name: "Теневой шаг",
        description: "Описание",
        sourceCatalogEntryId: null,
        revision: 3,
        data: {
          ...(kind === "ABILITY" && !executable
            ? {
                activation: { consumeUse: true },
                uses: { current: 1, max: 1, recharge: "DAY" },
              }
            : {}),
          rollActions: executable
            ? [
                {
                  id: "strike",
                  kind: "HIT",
                  label: "Удар",
                  dice: "1d20",
                  modifiers: [],
                },
              ]
            : [],
        },
      };
      const onEntryAction = vi.fn().mockResolvedValue(undefined);
      renderComponent(
        <QuickRollPanel
          rollCharacter={
            {
              stats: {},
              skills: [],
              entries: [entry],
            } as unknown as CharacterDto
          }
          campaignId="campaign"
          membershipId="member"
          rows={[]}
          quickRollPending={false}
          canControlCharacter
          gmOnly={false}
          onQuickRoll={() => {}}
          onEntryAction={onEntryAction}
        />,
      );
      fireEvent.click(
        screen.getByRole("tab", {
          name: kind === "SKILL" ? "Характеристики и навыки" : "Способности",
        }),
      );
      if (executable) {
        fireEvent.click(screen.getByRole("button", { name: "Удар" }));
      } else if (kind === "ABILITY") {
        fireEvent.click(
          screen.getByRole("button", { name: "Теневой шаг · Активировать" }),
        );
      } else {
        fireEvent.click(
          screen.getByRole("button", {
            name: "Показать без выполнения: Теневой шаг",
          }),
        );
      }
      await waitFor(() => expect(onEntryAction).toHaveBeenCalledOnce());
      const [, mode, rollActionId] = onEntryAction.mock.calls[0]!;
      const expectedMode =
        executable || kind === "ABILITY" ? "EXECUTE" : "SHARE";
      expect(mode).toBe(expectedMode);
      expect(rollActionId).toBe(executable ? "strike" : undefined);
      expect(
        entryRollRequestSchema.safeParse({
          actionId: "11111111-1111-4111-8111-111111111111",
          entryRevision: entry.revision,
          mode,
          rollActionId,
          visibility: "PUBLIC",
        }).success,
      ).toBe(true);
    });
  }
}

it("prepares a no-roll ability without writing and executes only on manual confirmation", async () => {
  const entry = {
    id: "prepared-ability",
    kind: "ABILITY" as const,
    name: "Теневой шаг",
    description: "Описание",
    sourceCatalogEntryId: null,
    revision: 3,
    data: { usageCost: { type: "physical", amount: 1 }, rollActions: [] },
  };
  const onEntryAction = vi.fn().mockResolvedValue(undefined);
  renderComponent(
    <QuickRollPanel
      rollCharacter={
        { stats: {}, skills: [], entries: [entry] } as unknown as CharacterDto
      }
      campaignId="campaign"
      membershipId="member"
      rows={[]}
      quickRollPending={false}
      canControlCharacter
      gmOnly={false}
      onQuickRoll={() => {}}
      onEntryAction={onEntryAction}
    />,
  );

  fireEvent.click(screen.getByRole("tab", { name: "Способности" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Подготовить активацию" }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Подготовлено для хода",
  );
  expect(onEntryAction).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Выполнить сейчас" }));
  await waitFor(() => expect(onEntryAction).toHaveBeenCalledOnce());
  expect(onEntryAction).toHaveBeenCalledWith(entry, "EXECUTE", undefined);
});

it("blocks a prepared action after its entry revision changes", () => {
  const entry = {
    id: "prepared-ability-stale",
    kind: "ABILITY" as const,
    name: "Теневой шаг",
    description: "Описание",
    sourceCatalogEntryId: null,
    revision: 3,
    data: {
      rollActions: [
        {
          id: "strike",
          kind: "HIT",
          label: "Удар",
          dice: "1d20",
          modifiers: [],
        },
      ],
    },
  };
  const onEntryAction = vi.fn().mockResolvedValue(undefined);
  const view = renderComponent(
    <QuickRollPanel
      rollCharacter={
        { stats: {}, skills: [], entries: [entry] } as unknown as CharacterDto
      }
      campaignId="campaign"
      membershipId="member"
      rows={[]}
      quickRollPending={false}
      canControlCharacter
      gmOnly={false}
      onQuickRoll={() => {}}
      onEntryAction={onEntryAction}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Способности" }));
  fireEvent.click(screen.getByRole("button", { name: "Подготовить" }));
  expect(onEntryAction).not.toHaveBeenCalled();

  const changedEntry = { ...entry, revision: 4 };
  view.rerender(
    <QuickRollPanel
      rollCharacter={
        {
          stats: {},
          skills: [],
          entries: [changedEntry],
        } as unknown as CharacterDto
      }
      campaignId="campaign"
      membershipId="member"
      rows={[]}
      quickRollPending={false}
      canControlCharacter
      gmOnly={false}
      onQuickRoll={() => {}}
      onEntryAction={onEntryAction}
    />,
  );
  expect(
    screen.getByText(
      "Действие изменилось или больше недоступно. Выберите его заново.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Выполнить сейчас" }),
  ).toBeDisabled();
  expect(onEntryAction).not.toHaveBeenCalled();
});

it("keeps numeric skill rows with characteristics and gives explicit control access", () => {
  const onQuickRoll = vi.fn();
  renderComponent(
    <QuickRollPanel
      rollCharacter={
        {
          stats: { strength: 1, stealth: 3 },
          skills: [],
          entries: [],
        } as unknown as CharacterDto
      }
      campaignId="campaign"
      membershipId="member"
      rows={[
        { key: "strength", label: "Сила", group: "characteristics" },
        { key: "stealth", label: "Скрытность", group: "skills" },
      ]}
      quickRollPending={false}
      canControlCharacter
      gmOnly={false}
      onQuickRoll={onQuickRoll}
    />,
  );
  expect(
    screen.getByRole("tab", { name: "Характеристики и навыки" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    screen.getByRole("button", { name: /^Скрытность\s*3$/ }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: /^Сила\s*1$/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^Скрытность\s*3$/ }));
  expect(onQuickRoll).toHaveBeenCalledWith(
    "1d20 + stealth",
    "Скрытность",
    3,
    "NORMAL",
    1,
  );
});

it("posts the info control as SHARE without activating the ability name", async () => {
  const entry = {
    id: "ability-info",
    kind: "ABILITY" as const,
    name: "Вспышка",
    description: "Описание способности",
    sourceCatalogEntryId: null,
    revision: 4,
    data: {
      activation: { consumeUse: true, cost: { type: "physical", amount: 2 } },
      uses: { current: 1, max: 1, recharge: "DAY" },
      rollActions: [],
    },
  };
  const onEntryAction = vi.fn().mockResolvedValue(undefined);
  renderComponent(
    <QuickRollPanel
      rollCharacter={
        { stats: {}, skills: [], entries: [entry] } as unknown as CharacterDto
      }
      campaignId="campaign"
      membershipId="member"
      rows={[]}
      quickRollPending={false}
      canControlCharacter
      gmOnly={false}
      onQuickRoll={() => {}}
      onEntryAction={onEntryAction}
    />,
  );

  fireEvent.click(screen.getByRole("tab", { name: "Способности" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Показать без выполнения: Вспышка" }),
  );

  await waitFor(() => expect(onEntryAction).toHaveBeenCalledOnce());
  expect(onEntryAction).toHaveBeenCalledWith(entry, "SHARE", undefined);
  expect(onEntryAction).not.toHaveBeenCalledWith(entry, "EXECUTE", undefined);
  expect(
    entryRollRequestSchema.safeParse({
      actionId: "11111111-1111-4111-8111-111111111111",
      entryRevision: entry.revision,
      mode: "SHARE",
      visibility: "PUBLIC",
    }).success,
  ).toBe(true);
});

it("предлагает число бросков характеристики по Shift без немедленного броска", async () => {
  const onQuickRoll = vi.fn();
  renderComponent(
    <QuickRollPanel
      rollCharacter={
        {
          stats: { willpower: 3 },
          skills: [],
          entries: [],
        } as unknown as CharacterDto
      }
      campaignId="campaign"
      membershipId="member"
      rows={[{ key: "willpower", label: "Сила воли" }]}
      quickRollPending={false}
      gmOnly={false}
      onQuickRoll={onQuickRoll}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /^Сила воли\s*3$/ }),
    { shiftKey: true },
  );
  expect(onQuickRoll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "4" }));
  expect(onQuickRoll).toHaveBeenCalledWith(
    "1d20 + willpower",
    "Сила воли",
    3,
    "NORMAL",
    4,
  );
});
