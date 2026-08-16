import { describe, expect, it } from "vitest";
import { sortByInitiative } from "@arken/contracts";
import { projectInitiative, resolveParticipantName } from "./initiative.js";

const names = (entries: Array<[string, string]>) => new Map(entries);

/** Собирает контекст проекции, чтобы тесты называли только то, что проверяют. */
const context = (
  overrides: Partial<Parameters<typeof projectInitiative>[1]> = {},
): Parameters<typeof projectInitiative>[1] => ({
  tokenNames: names([]),
  playerTokenIds: new Set<string>(),
  ownTokenIds: new Set<string>(),
  initiativeBonusByToken: new Map<string, number>(),
  role: "GM",
  ...overrides,
});

describe("что из очереди видит игрок", () => {
  const roster = [
    { id: "a", tokenId: "игрок", name: null, initiative: 17 },
    { id: "b", tokenId: "засада", name: null, initiative: 21 },
    { id: "c", tokenId: null, name: "Волк №3", initiative: 12 },
  ];
  const allNames = names([
    ["игрок", "Ллойд"],
    ["засада", "Лучник в кустах"],
  ]);

  it("мастеру отдаёт очередь целиком", () => {
    expect(
      projectInitiative(
        roster,
        context({ tokenNames: allNames, role: "GM" }),
      ).map((participant) => participant.name),
    ).toEqual(["Ллойд", "Лучник в кустах", "Волк №3"]);
  });

  it("игроку не отдаёт строку противника — ни целиком, ни заглушкой", () => {
    // Заглушка «???» сохранила бы номера ходов, но выдала бы, сколько всего
    // юнитов в бою — то же самое, что раньше утекало координатами (UIX-449).
    const visible = projectInitiative(
      roster,
      context({
        tokenNames: allNames,
        playerTokenIds: new Set(["игрок"]),
        role: "PLAYER",
      }),
    );
    expect(visible.map((participant) => participant.name)).toEqual(["Ллойд"]);
    expect(JSON.stringify(visible)).not.toContain("засада");
  });

  it("показывает игроку его строку, даже когда его токен скрыт туманом", () => {
    // UIX-466 сменил правило с «виден токен» на «это персонаж игрока». Прежнее
    // зависело от тумана: свой же ход пропадал из очереди, стоило зайти в тень.
    const visible = projectInitiative(
      [roster[0]!],
      context({
        // Токена нет среди видимых — имя всё равно приходит из общей карты.
        tokenNames: allNames,
        playerTokenIds: new Set(["игрок"]),
        ownTokenIds: new Set(["игрок"]),
        role: "PLAYER",
      }),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ name: "Ллойд", canEdit: true });
  });

  it("не показывает игроку NPC, стоящего на виду", () => {
    // Обратная сторона того же правила: видимость на карте больше не пускает
    // противника в очередь игрока.
    expect(
      projectInitiative(
        [roster[1]!],
        context({
          tokenNames: allNames,
          playerTokenIds: new Set(["игрок"]),
          role: "PLAYER",
        }),
      ),
    ).toEqual([]);
  });

  it("не показывает игроку участника без токена", () => {
    // За ним нет персонажа игрока — показывать нечего.
    expect(
      projectInitiative([roster[2]!], context({ role: "PLAYER" })),
    ).toEqual([]);
  });

  it("даёт игроку править только свою строку", () => {
    const [own, other] = projectInitiative(
      [
        { id: "a", tokenId: "мой", name: null, initiative: null },
        { id: "b", tokenId: "чужой", name: null, initiative: null },
      ],
      context({
        tokenNames: names([
          ["мой", "Ллойд"],
          ["чужой", "Тэйн"],
        ]),
        playerTokenIds: new Set(["мой", "чужой"]),
        ownTokenIds: new Set(["мой"]),
        role: "PLAYER",
      }),
    );
    expect(own).toMatchObject({ name: "Ллойд", canEdit: true });
    expect(other).toMatchObject({ name: "Тэйн", canEdit: false });
  });

  it("отдаёт бонус к инициативе персонажа", () => {
    // Мастеру он нужен, чтобы понимать, к чему прибавлять физический бросок.
    const [withBonus, withoutCharacter] = projectInitiative(
      [
        { id: "a", tokenId: "t", name: null, initiative: null },
        { id: "b", tokenId: null, name: "Волк №3", initiative: null },
      ],
      context({
        tokenNames: names([["t", "Ллойд"]]),
        initiativeBonusByToken: new Map([["t", 3]]),
      }),
    );
    expect(withBonus).toMatchObject({ initiativeBonus: 3 });
    expect(withoutCharacter).toMatchObject({ initiativeBonus: null });
  });

  it("отдаёт собственное имя отдельным полем", () => {
    // Редактору нужно отличать «зовусь как токен» от намеренной копии: по
    // одному видимому имени он бы их спутал (тот же урок, что в UIX-400).
    const [inherits, own] = projectInitiative(
      [
        { id: "a", tokenId: "t", name: null, initiative: null },
        { id: "b", tokenId: "t2", name: "Тэйн верхом", initiative: null },
      ],
      context({
        tokenNames: names([
          ["t", "Могучий Тэйн"],
          ["t2", "Могучий Тэйн"],
        ]),
      }),
    );
    expect(inherits).toMatchObject({ name: "Могучий Тэйн", ownName: null });
    expect(own).toMatchObject({ name: "Тэйн верхом", ownName: "Тэйн верхом" });
  });
});

describe("имя строки очереди", () => {
  it("предпочитает собственное имя имени токена", () => {
    expect(resolveParticipantName("Волк №3", "Волк")).toBe("Волк №3");
  });

  it("наследует имя токена, когда своего нет", () => {
    expect(resolveParticipantName(null, "Ллойд")).toBe("Ллойд");
    expect(resolveParticipantName("   ", "Ллойд")).toBe("Ллойд");
  });

  it("оставляет строку в очереди, даже если токен удалили посреди боя", () => {
    // Порядок ходов не производная карты: исчезнувший токен не должен
    // выбрасывать участника из очереди или оставлять пустую подпись.
    expect(resolveParticipantName(null, undefined)).toBe("Без имени");
  });
});

describe("пересортировка по броскам", () => {
  it("ставит больший бросок выше", () => {
    expect(
      sortByInitiative([
        { id: "a", initiative: 7 },
        { id: "b", initiative: 19 },
        { id: "c", initiative: 12 },
      ]).map((participant) => participant.id),
    ).toEqual(["b", "c", "a"]);
  });

  it("уводит вниз тех, кто ещё не бросал, не считая их нулём", () => {
    // «Не бросал» и «выбросил ноль» — разные состояния: ноль ниже единицы, но
    // выше пустой строки, иначе мастер не отличит забытых от невезучих.
    expect(
      sortByInitiative([
        { id: "не бросал", initiative: null },
        { id: "ноль", initiative: 0 },
        { id: "минус", initiative: -2 },
      ]).map((participant) => participant.id),
    ).toEqual(["ноль", "минус", "не бросал"]);
  });

  it("не перетасовывает ничью, решённую мастером", () => {
    // Устойчивость — не деталь реализации: при равных бросках мастер решает
    // порядок руками, и повторное нажатие «пересортировать» обязано его
    // сохранить, а не менять местами на каждом клике.
    expect(
      sortByInitiative([
        { id: "первый", initiative: 15 },
        { id: "второй", initiative: 15 },
        { id: "третий", initiative: 15 },
      ]).map((participant) => participant.id),
    ).toEqual(["первый", "второй", "третий"]);
  });
});
