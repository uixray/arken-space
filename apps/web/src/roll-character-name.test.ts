import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import { createRollCharacterNameSource } from "./roll-character-name";

/**
 * UIX-501. Проверяется решение «откуда взять имя», а не арифметика вокруг него:
 * именно на выборе источника задача ломалась дважды.
 */
const snapshotWith = (
  role: "GM" | "PLAYER",
  identities: { id: string; name: string }[],
  characters: { id: string; name: string }[],
) =>
  ({
    me: { role },
    characterIdentities: identities.map((identity) => ({
      ...identity,
      portraitAssetId: null,
      tokenAssetId: null,
    })),
    characters,
  }) as unknown as GameSnapshot;

describe("имя персонажа для подписи броска", () => {
  it("берёт публичную личность, а не доступную карточку", () => {
    const name = createRollCharacterNameSource(
      snapshotWith(
        "PLAYER",
        [{ id: "c1", name: "Тейн" }],
        [{ id: "c1", name: "ИМЯ ИЗ КАРТОЧКИ" }],
      ),
    );
    expect(name("c1")).toBe("Тейн");
  });

  it("у игрока скрытый персонаж остаётся без имени", () => {
    // Бросок мастера за NPC: игроку показывать имя нельзя, и заглушка тут была
    // бы хуже пустоты — ровно она и вырождалась в слово «Персонаж».
    const name = createRollCharacterNameSource(
      snapshotWith("PLAYER", [], [{ id: "c1", name: "Лучник в кустах" }]),
    );
    expect(name("c1")).toBeNull();
  });

  it("мастер видит имя собственного NPC", () => {
    // Найдено замером: публичные личности фильтруются по владельцу для всех,
    // включая мастера, и его бросок за NPC оставался без подписи.
    const name = createRollCharacterNameSource(
      snapshotWith("GM", [], [{ id: "c1", name: "Лучник в кустах" }]),
    );
    expect(name("c1")).toBe("Лучник в кустах");
  });

  it("бросок без персонажа не подписывается", () => {
    const name = createRollCharacterNameSource(
      snapshotWith("GM", [], [{ id: "c1", name: "Лучник" }]),
    );
    expect(name(null)).toBeNull();
  });

  it("незнакомый идентификатор не выдумывает имя", () => {
    // Персонаж удалён или заархивирован: подписи нет, но и обмана нет.
    const name = createRollCharacterNameSource(
      snapshotWith(
        "GM",
        [{ id: "c1", name: "Тейн" }],
        [{ id: "c1", name: "Тейн" }],
      ),
    );
    expect(name("c2")).toBeNull();
  });
});
