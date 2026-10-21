// @vitest-environment jsdom
import type { CharacterDto } from "@arken/contracts";
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "../test-support/render";
import {
  gmSnapshot,
  playerSnapshot,
} from "../test-support/game-snapshot-fixtures";
import { CampaignClockDialog } from "./CampaignClockDialog";

function clockSnapshot(
  clock: Partial<ReturnType<typeof gmSnapshot>["campaign"]> = {},
) {
  const snapshot = gmSnapshot();
  return {
    ...snapshot,
    campaign: { ...snapshot.campaign, ...clock },
  };
}

function characterWithEntries(entries: CharacterDto["entries"]): CharacterDto {
  return {
    id: "character-with-recharge",
    name: "Персонаж с восстановлением",
    ownerMembershipId: null,
    controllerMembershipIds: [],
    portraitAssetId: null,
    stats: {},
    skills: [],
    spells: [],
    notes: "",
    backstory: "",
    inventory: [],
    resources: {},
    wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
    entries,
    revision: 0,
    lifecycle: "ACTIVE",
    archivedAt: null,
    archivedByMembershipId: null,
    statLayout: [],
  };
}

function rechargeEntry(
  recharge: "BATTLE" | "DAY" | "WEEK",
  anchor: number,
): CharacterDto["entries"][number] {
  return {
    id: `entry-${recharge.toLocaleLowerCase()}`,
    sourceCatalogEntryId: null,
    kind: "ABILITY",
    name: `Восстановление ${recharge}`,
    description: "",
    data: {
      uses: {
        current: 0,
        max: 1,
        recharge,
        ...(recharge === "BATTLE"
          ? { lastBattleCounter: anchor }
          : { lastRechargeDay: anchor }),
      },
    },
    revision: 0,
  };
}

function renderClock(
  overrides: Partial<Parameters<typeof CampaignClockDialog>[0]> = {},
) {
  const props = {
    open: true,
    snapshot: clockSnapshot({
      day: 7,
      battleCounter: 3,
      battleActive: false,
      revision: 12,
    }),
    onCommand: vi.fn(async () => {}),
    onClose: vi.fn(),
    ...overrides,
  };
  renderComponent(<CampaignClockDialog {...props} />);
  return props;
}

describe("окно времени кампании", () => {
  it("показывает единые часы только мастеру и не дублирует управление боем", () => {
    renderClock();

    expect(screen.getByText("День 7")).toBeInTheDocument();
    expect(
      screen.queryByText(/боёв|столкновение|идёт бой/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Начать бой")).not.toBeInTheDocument();
    expect(screen.queryByText("Завершить бой")).not.toBeInTheDocument();

    const player = playerSnapshot();
    renderClock({ snapshot: player });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("предлагает только длинный отдых, а обычная смена дня не дублируется", async () => {
    const props = renderClock();

    expect(
      screen.queryByRole("button", { name: "Следующий день" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Длинный отдых" }),
    );

    expect(props.onCommand).toHaveBeenCalledExactlyOnceWith("LONG_REST", 12);
  });

  it("отправляет сброс только после отдельного подтверждения", async () => {
    const props = renderClock();

    await userEvent.click(
      screen.getByRole("button", { name: "Сбросить время" }),
    );
    expect(props.onCommand).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Сбросить время кампании?" }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Подтвердить сброс" }),
    );
    expect(props.onCommand).toHaveBeenCalledOnce();
    expect(props.onCommand).toHaveBeenCalledWith("RESET_CLOCK", 12);
  });

  it("не разрешает сброс во время боя и в исходной точке", () => {
    const { rerender } = renderComponent(
      <CampaignClockDialog
        open
        snapshot={clockSnapshot({
          day: 4,
          battleCounter: 2,
          battleActive: true,
        })}
        onCommand={vi.fn(async () => {})}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Сбросить время" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Сброс недоступен для сохранённого состояния кампании/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/столкновени|завершите бой/),
    ).not.toBeInTheDocument();

    rerender(
      <CampaignClockDialog
        open
        snapshot={clockSnapshot({
          day: 1,
          battleCounter: 0,
          battleActive: false,
        })}
        onCommand={vi.fn(async () => {})}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Сбросить время" }),
    ).toBeDisabled();
    expect(screen.getByText(/уже находится в исходной/)).toBeInTheDocument();
  });

  it.each([
    {
      reason: "устарел недельный anchor",
      campaign: {},
      characters: [characterWithEntries([rechargeEntry("WEEK", 8)])],
    },
    {
      reason: "устарел боевой anchor",
      campaign: {},
      characters: [characterWithEntries([rechargeEntry("BATTLE", 3)])],
    },
    {
      reason: "в очереди остался участник",
      campaign: {
        initiative: [
          {
            id: "initiative-entry",
            tokenId: null,
            name: "Забытый участник",
            ownName: "Забытый участник",
            initiative: null,
            initiativeBonus: null,
            canEdit: true,
            pinned: false,
          },
        ],
      },
      characters: [],
    },
  ])(
    "оставляет repair-сброс доступным на числовом baseline: $reason",
    async ({ campaign, characters }) => {
      const baseline = clockSnapshot({
        day: 1,
        battleCounter: 0,
        battleActive: false,
        ...campaign,
      });
      renderClock({ snapshot: { ...baseline, characters } });

      const reset = screen.getByRole("button", { name: "Сбросить время" });
      expect(reset).toBeEnabled();
      await userEvent.click(reset);
      expect(
        screen.getByRole("dialog", { name: "Сбросить время кампании?" }),
      ).toBeInTheDocument();
    },
  );

  it("оставляет подтверждение открытым и показывает отказ сервера", async () => {
    const props = renderClock({
      onCommand: vi.fn(async () => {
        throw new Error("Конфликт ревизии");
      }),
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Сбросить время" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Подтвердить сброс" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Конфликт ревизии",
    );
    expect(
      screen.getByRole("dialog", { name: "Сбросить время кампании?" }),
    ).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
