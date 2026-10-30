// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetDto, GameSnapshot } from "@arken/contracts";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
} from "../test-support/render";
import { normalizeClientDiceResult } from "../dice-result";
import { DiceFramePicker } from "../DiceFramePicker";
import { ChatMessageBody } from "./ChatPanels";
import { OutcomeFrame } from "./OutcomeFrame";

/** UIX-457: рамка игрока или навыка в ленте и её выбор. */
const frameId = "11111111-2222-4333-8444-555555555555";

const rollMessage = (dice: Record<string, unknown>) =>
  ({
    id: "m1",
    sequence: 1,
    membershipId: "mem",
    displayName: "Игрок",
    characterId: null,
    body: "Бросок",
    visibility: "PUBLIC",
    kind: "DICE",
    threadId: "t",
    stream: "ROLLS",
    dice: {
      formula: "1d20",
      resolvedFormula: "1d20",
      terms: [{ notation: "1d20", rolls: [13], subtotal: 13 }],
      modifiers: [],
      total: 13,
      ...dice,
    },
    createdAt: new Date().toISOString(),
  }) as unknown as GameSnapshot["messages"][number];

afterEach(() => vi.unstubAllGlobals());

describe("рамка-оформление броска", () => {
  it("анимирует только свежий бросок, история получает постер", () => {
    const { container, rerender } = renderComponent(
      <OutcomeFrame
        frame={null}
        styleFrame={{ assetId: frameId, source: "PLAYER" }}
        active
      />,
    );
    const img = () => container.querySelector("img");
    expect(img()?.getAttribute("src")).toBe(`/api/assets/${frameId}/content`);
    // При reduced motion браузер возьмёт постер из <source>.
    expect(
      container
        .querySelector('source[media="(prefers-reduced-motion: reduce)"]')
        ?.getAttribute("srcset"),
    ).toBe(`/api/assets/${frameId}/content?variant=poster`);
    rerender(
      <OutcomeFrame
        frame={null}
        styleFrame={{ assetId: frameId, source: "PLAYER" }}
        active={false}
      />,
    );
    expect(img()?.getAttribute("src")).toBe(
      `/api/assets/${frameId}/content?variant=poster`,
    );
    expect(container.querySelector("source")).toBeNull();
  });

  it("уступает критической рамке после реального для компонента IO допуска", async () => {
    let observe!: IntersectionObserverCallback;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          observe = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { container } = renderComponent(
      <OutcomeFrame
        frame={{ setKey: "ARKEN_CRITICAL_V1", frameKey: "critical-success" }}
        styleFrame={{ assetId: frameId, source: "SKILL" }}
        active
      />,
    );
    const wrapper = container.querySelector(".outcome-frame")!;
    await act(async () => {
      observe(
        [
          {
            target: wrapper,
            isIntersecting: true,
            intersectionRatio: 1,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/frames/critical-success.png",
    );
  });

  it("доходит из истории до ленты и отбрасывает чужую форму", () => {
    const { container } = renderComponent(
      <ChatMessageBody
        isActive
        message={rollMessage({
          styleFrame: { assetId: frameId, source: "PLAYER" },
        })}
      />,
    );
    expect(
      container
        .querySelector('[data-frame-source="PLAYER"] img')
        ?.getAttribute("src"),
    ).toBe(`/api/assets/${frameId}/content`);
    expect(
      normalizeClientDiceResult(
        rollMessage({ styleFrame: { assetId: "../../etc", source: "PLAYER" } })
          .dice,
      )?.styleFrame,
    ).toBeNull();
    expect(
      normalizeClientDiceResult(
        rollMessage({ styleFrame: { assetId: frameId, source: "GOD" } }).dice,
      )?.styleFrame,
    ).toBeNull();
  });
});

describe("выбор рамки", () => {
  const frames = [
    {
      id: frameId,
      kind: "DICE_FRAME",
      name: "Огонь",
      url: `/api/assets/${frameId}/content?v=a`,
      posterUrl: `/api/assets/${frameId}/content?variant=poster&v=b`,
    },
  ] as unknown as AssetDto[];

  it("показывает постеры как радиогруппу и сообщает выбор", () => {
    const onChange = vi.fn();
    renderComponent(
      <DiceFramePicker
        legend="Рамка ваших бросков"
        frames={frames}
        value={null}
        onChange={onChange}
      />,
    );
    const group = screen.getByRole("group", { name: "Рамка ваших бросков" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Без рамки" })).toHaveProperty(
      "checked",
      true,
    );
    const fire = screen.getByRole("radio", { name: "Огонь" });
    expect(
      fire.closest("label")?.querySelector("img")?.getAttribute("src"),
    ).toBe(frames[0]!.posterUrl);
    fireEvent.click(fire);
    expect(onChange).toHaveBeenCalledWith(frameId);
  });

  it("объясняет пустую палитру", () => {
    renderComponent(
      <DiceFramePicker
        legend="Рамка бросков навыка"
        noneLabel="Рамка игрока"
        frames={[]}
        value={null}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/Мастер ещё не загрузил рамки/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Рамка игрока" })).toBeTruthy();
  });
});
