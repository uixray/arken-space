// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import { fireEvent, renderComponent, screen } from "../test-support/render";
import { RollAvatar } from "./RollAvatar";
import { rollInitials } from "../roll-initials";
import { createRollAvatarSource } from "../roll-avatar-source";
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
        identity={{
          id: "c1",
          name: "Шейла",
          portraitAssetId: "a1",
          tokenAssetId: null,
        }}
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
        identity={{
          id: "c1",
          name: "Шейла Ловкая",
          portraitAssetId: null,
          tokenAssetId: null,
        }}
        fallbackName="Сосед"
        assetUrl={null}
      />,
    );
    expect(screen.getByTitle("Шейла Ловкая").textContent).toContain("ШЛ");
  });

  it("падает на инициалы, если файл портрета не загрузился", () => {
    renderComponent(
      <RollAvatar
        identity={{
          id: "c1",
          name: "Шейла Ловкая",
          portraitAssetId: "missing",
          tokenAssetId: null,
        }}
        fallbackName="Сосед"
        assetUrl="/api/assets/missing/content"
      />,
    );

    fireEvent.error(screen.getByAltText("Шейла Ловкая"));

    expect(screen.queryByRole("img")).toBeNull();
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

describe("источник аватара", () => {
  const snapshot = {
    characterIdentities: [
      {
        id: "c1",
        name: "Шейла",
        portraitAssetId: "portrait",
        tokenAssetId: "token",
      },
      {
        id: "c2",
        name: "Ллойд",
        portraitAssetId: "portrait2",
        tokenAssetId: null,
      },
      { id: "c3", name: "Миша", portraitAssetId: null, tokenAssetId: null },
    ],
    assets: [
      { id: "token", url: "/api/assets/token/content" },
      { id: "portrait", url: "/api/assets/portrait/content" },
      { id: "portrait2", url: "/api/assets/portrait2/content" },
    ],
  } as unknown as GameSnapshot;

  it("предпочитает миниатюру токена портрету", () => {
    // Решение мастера: на карте персонажа узнают по токену, а портрет в ленте
    // размером с ноготь.
    expect(createRollAvatarSource(snapshot)("c1").assetUrl).toBe(
      "/api/assets/token/content",
    );
  });

  it("падает на портрет, когда токена с картинкой нет", () => {
    expect(createRollAvatarSource(snapshot)("c2").assetUrl).toBe(
      "/api/assets/portrait2/content",
    );
  });

  it("отдаёт личность без картинки, а не пустоту", () => {
    // Инициалы рисуются от имени персонажа — значит личность нужна и тогда,
    // когда картинки нет вовсе.
    const resolved = createRollAvatarSource(snapshot)("c3");
    expect(resolved.assetUrl).toBeNull();
    expect(resolved.identity?.name).toBe("Миша");
  });

  it("не падает на броске без персонажа", () => {
    expect(createRollAvatarSource(snapshot)(null)).toEqual({
      identity: null,
      assetUrl: null,
    });
  });
});

describe("лента бросков", () => {
  it("подключает аватар в обеих лентах, а не в одной", async () => {
    /**
     * Ровно та ошибка, которую поймал мастер: аватар был вписан в `ChatPanel`,
     * а лента бросков — это `ActivityPanel`. Компонентный тест этого не увидел
     * бы, поэтому проверяется исходник: обе ленты обязаны передавать `avatar`.
     */
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("apps/web/src/sidebar/ChatPanels.tsx", "utf8"),
    );
    expect(source.split("avatar={").length - 1).toBeGreaterThanOrEqual(2);
    // И ни одна из них не должна снова заводить свой источник картинок.
    expect(source).not.toContain("portraitUrlFor");
  });
});
