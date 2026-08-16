// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import { renderComponent, screen } from "../test-support/render";
import { RollAvatar } from "./RollAvatar";
import { rollInitials } from "../roll-initials";
import { ChatMessageBody } from "./ChatPanels";

vi.mock("@gravity-ui/uikit", () => ({
  Button: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

const diceMessage = {
  id: "m1",
  sequence: 1,
  membershipId: "mem",
  displayName: "Андрей",
  characterId: "c1",
  body: "Инициатива",
  visibility: "PUBLIC",
  kind: "DICE",
  threadId: "t",
  stream: "ROLLS",
  dice: {
    formula: "1d20 + 4",
    resolvedFormula: "1d20 + 4",
    terms: [{ notation: "1d20", rolls: [13], subtotal: 13 }],
    modifiers: [{ source: "agility", value: 4 }],
    total: 17,
  },
  createdAt: new Date().toISOString(),
} as unknown as GameSnapshot["messages"][number];

const physicalMessage = {
  ...diceMessage,
  id: "m2",
  kind: "TEXT",
  dice: null,
  body: "Физический бросок · Ловкость · бонус +3.",
} as unknown as GameSnapshot["messages"][number];

describe("инициалы", () => {
  it("берёт по букве от имени и фамилии", () => {
    expect(rollInitials("Шейла Ловкая")).toBe("ШЛ");
  });

  it("из одного слова берёт две буквы", () => {
    expect(rollInitials("Ллойд")).toBe("ЛЛ");
  });

  it("не остаётся пустым", () => {
    // Пустой кружок в ленте читается как несработавшая загрузка картинки.
    expect(rollInitials("   ")).toBe("?");
  });
});

describe("аватар броска", () => {
  it("показывает портрет, когда он есть", () => {
    renderComponent(
      <RollAvatar
        identity={{ id: "c1", name: "Шейла", portraitAssetId: "a1" }}
        fallbackName="Сосед"
        assetUrl="/api/assets/a1/content"
      />,
    );
    expect(screen.getByAltText("Шейла").getAttribute("src")).toBe(
      "/api/assets/a1/content",
    );
  });

  it("падает на инициалы персонажа, а не участника", () => {
    // Решение мастера: заглушка — для персонажа без картинки. Имя персонажа
    // известно и в этом случае, подменять его именем игрока незачем.
    renderComponent(
      <RollAvatar
        identity={{ id: "c1", name: "Шейла Ловкая", portraitAssetId: null }}
        fallbackName="Сосед"
        assetUrl={null}
      />,
    );
    expect(screen.getByTitle("Шейла Ловкая").textContent).toContain("ШЛ");
  });

  it("для броска без персонажа берёт имя участника", () => {
    renderComponent(
      <RollAvatar identity={null} fallbackName="Мастер" assetUrl={null} />,
    );
    expect(screen.getByTitle("Мастер").textContent).toContain("МА");
  });
});

describe("строка броска", () => {
  const order = () =>
    Array.from(document.querySelector(".roll-result")?.children ?? []).map(
      (node) => node.className.split(" ")[0],
    );

  it("ставит аватар слева, а итог справа", () => {
    renderComponent(
      <ChatMessageBody
        message={diceMessage}
        avatar={
          <RollAvatar identity={null} fallbackName="Андрей" assetUrl={null} />
        }
      />,
    );
    expect(order()).toEqual(["roll-avatar", "roll-details", "roll-total"]);
    expect(screen.getByLabelText("Итог броска").textContent).toBe("17");
  });

  it("рисует физический бросок тем же макетом, но с бонусом вместо итога", () => {
    // Раньше он выпадал в обычный текст и выглядел сообщением другого рода,
    // хотя за столом это тот же бросок — просто кубик настоящий.
    renderComponent(
      <ChatMessageBody
        message={physicalMessage}
        avatar={
          <RollAvatar identity={null} fallbackName="Андрей" assetUrl={null} />
        }
      />,
    );
    expect(order()).toEqual(["roll-avatar", "roll-details", "roll-total"]);
    expect(screen.getByLabelText("Бонус к броску").textContent).toBe("+3");
    // Итога здесь быть не может: результат выпадает на настоящем кубике.
    expect(screen.queryByLabelText("Итог броска")).toBeNull();
  });
});
