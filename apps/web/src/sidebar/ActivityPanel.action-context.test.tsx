// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
import { ThemeProvider } from "@gravity-ui/uikit";
import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
  within,
} from "../test-support/render";
import { installMatchMediaMock } from "../test-support/dom-mocks";
import {
  gmSnapshot,
  playerSnapshot,
} from "../test-support/game-snapshot-fixtures";
import { RESOURCE_ADJUST_DELAY_MS } from "../resource-regen";
import { RollVisibilityContext } from "../roll-visibility-context";
import { ApiError } from "../api";
import { ActivityPanel } from "./ChatPanels";

// Real ActivityPanel -> QuickRollPanel / ResourceCounters -> Gravity controls.
// Only browser APIs absent from jsdom are shimmed. A correct supplied scopeKey
// in a ResourceCounters unit test cannot catch the parent choosing owned A.
// Several owned rows are a supported persisted snapshot shape, not a claim
// that the app offers a session-specific player selection API.
function character(id: string, name: string, revision: number): CharacterDto {
  return {
    id,
    name,
    ownerMembershipId: "member-under-test",
    controllerMembershipIds: ["member-under-test"],
    portraitAssetId: null,
    stats: { agility: revision, enduranceRegen: 1 },
    skills: [],
    spells: [],
    notes: "",
    backstory: "",
    inventory: [],
    resources: { physicalPower: { current: revision, maximum: 30 } },
    wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
    entries: [],
    revision,
    lifecycle: "ACTIVE",
    archivedAt: null,
    archivedByMembershipId: null,
  };
}

const a = character("character-a", "Альфа", 3);
const b = character("character-b", "Бета", 7);

function snapshot(
  active: string | null = b.id,
  role: "PLAYER" | "GM" = "PLAYER",
) {
  const result = (role === "GM" ? gmSnapshot : playerSnapshot)({
    characters: [a, b],
  });
  return { ...result, me: { ...result.me, characterId: active } };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

function renderActivity(
  current = snapshot(),
  overrides: Partial<ComponentProps<typeof ActivityPanel>> = {},
) {
  const props: ComponentProps<typeof ActivityPanel> = {
    snapshot: current,
    storyPosts: [],
    activityFilters: new Set(["ROLLS", "STORY", "REFERENCE"]),
    onActivityFiltersChange: vi.fn(),
    onChat: vi.fn(async () => undefined),
    onSticker: vi.fn(async () => undefined),
    onRoll: vi.fn(async () => undefined),
    focusedMessageId: null,
    onMessageFocused: vi.fn(),
    onOpenPlayerRequestCreate: vi.fn(),
    onUpdateCounters: vi.fn(async () => undefined),
    selectedTokenIds: [],
    onUpdateInitiative: vi.fn(async () => undefined),
    onSetOwnInitiative: vi.fn(async () => undefined),
    onRollInitiative: vi.fn(async () => undefined),
    ...overrides,
  };
  const rendered = renderComponent(<ActivityPanel {...props} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ThemeProvider theme="dark" lang="ru">
        <RollVisibilityContext.Provider value="GM_ONLY">
          {children}
        </RollVisibilityContext.Provider>
      </ThemeProvider>
    ),
  });
  return {
    props,
    rerender(next: GameSnapshot) {
      rendered.rerender(<ActivityPanel {...props} snapshot={next} />);
    },
  };
}

const rollButton = () => screen.getByRole("button", { name: "Ловкость" });
const resourceInput = () =>
  screen.getByRole("spinbutton", { name: "Очки: Выносливость" });
const composerInput = () =>
  screen.getByRole("textbox", { name: "Сообщение или бросок" });
const spendButton = () =>
  screen.getByRole("button", { name: "Потратить одно очко: Выносливость" });
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: /^Отправить\./ }));
const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);

beforeEach(() => {
  window.localStorage.clear();
  installMatchMediaMock();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollTo)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

describe("ActivityPanel action context (UIX-621)", () => {
  it("follows snapshot.me.characterId B for rolls and resources when several owned rows begin with A", async () => {
    const { props } = renderActivity();
    expect(screen.getByText("Броски и ресурсы · Бета")).toBeVisible();
    expect(
      screen.queryByLabelText("Персонаж для броска"),
    ).not.toBeInTheDocument();
    expect(resourceInput()).toHaveValue(7);
    await act(async () => {
      fireEvent.click(rollButton());
    });
    expect(props.onRoll).toHaveBeenCalledWith(
      "1d20 + agility",
      "Ловкость",
      "GM_ONLY",
      b.id,
      "NORMAL",
    );
    fireEvent.click(spendButton());
    expect(resourceInput()).toHaveValue(6);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    expect(props.onUpdateCounters).toHaveBeenCalledExactlyOnceWith(
      b.id,
      b.revision,
      {},
      { resource: { key: "physicalPower", kind: "DELTA", delta: -1 } },
    );
  });

  it("does not widen resource editing permission just because a character is the roll context", () => {
    const current = snapshot();
    current.characters = [
      a,
      { ...b, ownerMembershipId: "another-member", controllerMembershipIds: [] },
    ];
    const { props } = renderActivity(current);
    expect(resourceInput()).toHaveValue(7);
    expect(resourceInput()).toBeDisabled();
    expect(spendButton()).toBeDisabled();
    fireEvent.click(spendButton());
    expect(props.onUpdateCounters).not.toHaveBeenCalled();
  });

  it("keeps an accepted roll visible when the character becomes unavailable, then clears only its pending feedback", async () => {
    const pending = deferred();
    const onRoll = vi.fn(() => pending.promise);
    const { rerender } = renderActivity(snapshot(a.id), { onRoll });
    fireEvent.click(rollButton());
    rerender(snapshot(null));
    expect(screen.getByText("Бросаем… Альфа · Ловкость")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Ловкость" }),
    ).not.toBeInTheDocument();
    await act(async () => pending.resolve());
    expect(
      screen.queryByText("Бросаем… Альфа · Ловкость"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it("keeps the pending roll's owner through A to B, blocks duplicates, then sends new rolls for B", async () => {
    const first = deferred();
    const onRoll = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const { rerender } = renderActivity(snapshot(a.id), { onRoll });
    const button = rollButton();
    act(() => {
      button.click();
      button.click();
    });
    expect(onRoll).toHaveBeenCalledTimes(1);
    expect(button.closest(".activity-quick-rolls")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText("Бросаем… Альфа · Ловкость")).toHaveAttribute(
      "role",
      "status",
    );
    rerender(snapshot(b.id));
    expect(screen.getByText("Броски и ресурсы · Бета")).toBeVisible();
    expect(resourceInput()).toHaveValue(7);
    expect(rollButton()).toBeDisabled();
    fireEvent.click(rollButton());
    expect(onRoll).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Бросаем… Альфа · Ловкость")).toBeVisible();
    await act(async () => first.reject(new Error("Бросок отклонён")));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Альфа · Ловкость: Бросок отклонён",
    );
    expect(rollButton()).toBeEnabled();
    expect(button.closest(".activity-quick-rolls")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(composerInput()).not.toHaveAttribute("aria-invalid", "true");
    expect(composerInput()).toHaveAttribute(
      "aria-describedby",
      "activity-composer-hint",
    );
    await act(async () => {
      fireEvent.click(rollButton());
    });
    expect(onRoll).toHaveBeenLastCalledWith(
      "1d20 + agility",
      "Ловкость",
      "GM_ONLY",
      b.id,
      "NORMAL",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("preserves an accepted A resource batch, but never sends a new B click to A", async () => {
    const first = deferred();
    const second = deferred();
    const onUpdateCounters = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { rerender } = renderActivity(snapshot(a.id), { onUpdateCounters });
    fireEvent.click(spendButton());
    rerender(snapshot(b.id));
    expect(resourceInput()).toHaveValue(7);
    fireEvent.click(spendButton());
    expect(resourceInput()).toHaveValue(6);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    expect(onUpdateCounters).toHaveBeenCalledTimes(2);
    expect(onUpdateCounters).toHaveBeenNthCalledWith(
      1,
      a.id,
      a.revision,
      {},
      { resource: { key: "physicalPower", kind: "DELTA", delta: -1 } },
    );
    expect(onUpdateCounters).toHaveBeenNthCalledWith(
      2,
      b.id,
      b.revision,
      {},
      { resource: { key: "physicalPower", kind: "DELTA", delta: -1 } },
    );
    await act(async () => {
      first.reject(new ApiError(409, "CHARACTER_CONFLICT", "Conflict"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Альфа · Ресурсы: Ресурсы уже изменены",
    );
    // A's rejection must not remove the still-pending B optimistic value.
    expect(resourceInput()).toHaveValue(6);
    expect(composerInput()).not.toHaveAttribute("aria-invalid", "true");
    expect(composerInput()).toHaveAttribute(
      "aria-describedby",
      "activity-composer-hint",
    );
    await act(async () => second.resolve());
    expect(resourceInput()).toHaveValue(7);
    expect(onUpdateCounters).toHaveBeenCalledTimes(2);
  });

  it.each([null, "missing-character"])(
    "does not act on owned A when active character is %s",
    (active) => {
      renderActivity(snapshot(active));
      expect(
        screen.getByText("Нет доступного персонажа для броска."),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Ловкость" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("spinbutton", { name: "Очки: Выносливость" }),
      ).not.toBeInTheDocument();
      expect(composerInput()).toBeEnabled();
    },
  );

  it("keeps the GM's explicit B selection for physical rolls and the latest B revision", async () => {
    const { props, rerender } = renderActivity(snapshot(a.id, "GM"));
    fireEvent.click(screen.getByLabelText("Персонаж для броска"));
    fireEvent.click(screen.getByRole("option", { name: "Бета" }));
    expect(screen.getByText("Броски и ресурсы · Бета")).toBeVisible();
    const next = snapshot(a.id, "GM");
    next.characters = [a, { ...b, revision: 19 }];
    rerender(next);
    fireEvent.click(screen.getByRole("checkbox", { name: "Физические кубы" }));
    await act(async () => {
      fireEvent.click(rollButton(), { ctrlKey: true });
    });
    expect(props.onRoll).not.toHaveBeenCalled();
    expect(props.onChat).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("бонус +7."),
      "GM_ONLY",
      "TABLE",
      b.id,
    );
    expect(vi.mocked(props.onChat).mock.calls[0]?.[0]).toContain(
      "Бросьте два d20, возьмите больший",
    );
    fireEvent.click(spendButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    expect(props.onUpdateCounters).toHaveBeenCalledExactlyOnceWith(
      b.id,
      19,
      {},
      { resource: { key: "physicalPower", kind: "DELTA", delta: -1 } },
    );
  });

  it("links only composer validation to its field; quick-roll and resource errors stay at their surfaces", async () => {
    renderActivity(snapshot(), {
      onRoll: vi.fn().mockRejectedValue(new Error("Нет доступа к броску")),
      onUpdateCounters: vi.fn().mockRejectedValue(new Error("Ресурс недоступен")),
    });
    fireEvent.change(composerInput(), { target: { value: "/roll" } });
    submit();
    expect(composerInput()).toHaveAttribute("aria-invalid", "true");
    expect(composerInput()).toHaveAttribute(
      "aria-describedby",
      "activity-composer-hint activity-composer-error",
    );
    const validation = document.getElementById("activity-composer-error");
    expect(validation).toHaveAttribute("role", "alert");
    expect(validation).toHaveTextContent("Укажите формулу после /roll");
    await act(async () => {
      fireEvent.click(rollButton());
    });
    fireEvent.click(spendButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    const quickSurface = screen.getByRole("region", { name: "Быстрые броски" });
    expect(within(quickSurface).getByRole("alert")).toHaveTextContent(
      "Бета · Ловкость: Нет доступа к броску",
    );
    expect(screen.getByText("Бета · Ресурсы: Ресурс недоступен")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(validation).toHaveTextContent("Укажите формулу после /roll");
    expect(composerInput()).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(composerInput(), { target: { value: "Привет" } });
    expect(composerInput()).not.toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("activity-composer-error")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("preserves meaningful send failures at the composer without marking valid text invalid", async () => {
    renderActivity(snapshot(), {
      onChat: vi.fn().mockRejectedValue(new Error("Соединение закрыто")),
    });
    fireEvent.change(composerInput(), { target: { value: "Сообщение" } });
    await act(async () => {
      submit();
    });
    expect(composerInput()).toHaveValue("Сообщение");
    expect(composerInput()).not.toHaveAttribute("aria-invalid", "true");
    expect(composerInput()).toHaveAttribute(
      "aria-describedby",
      "activity-composer-hint activity-composer-error",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Соединение закрыто");
    await act(async () => {
      fireEvent.click(rollButton());
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Соединение закрыто");
  });
});
