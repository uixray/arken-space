import { describe, expect, it } from "vitest";
import {
  projectInitiative,
  resolveParticipantName,
  sortByInitiative,
} from "./initiative.js";

const names = (entries: Array<[string, string]>) => new Map(entries);

describe("что из очереди видит игрок", () => {
  const roster = [
    { id: "a", tokenId: "видимый", name: null, initiative: 17 },
    { id: "b", tokenId: "засада", name: null, initiative: 21 },
    { id: "c", tokenId: null, name: "Волк №3", initiative: 12 },
  ];

  it("мастеру отдаёт очередь целиком", () => {
    expect(
      projectInitiative(roster, {
        visibleTokenNames: names([
          ["видимый", "Ллойд"],
          ["засада", "Лучник в кустах"],
        ]),
        role: "GM",
      }).map((participant) => participant.name),
    ).toEqual(["Ллойд", "Лучник в кустах", "Волк №3"]);
  });

  it("игроку не отдаёт ни строки скрытого токена, ни заглушки вместо неё", () => {
    // Заглушка «???» сохранила бы номера ходов, но выдала бы, сколько всего
    // юнитов в бою — то же самое, что раньше утекало координатами (UIX-449).
    const visible = projectInitiative(roster, {
      visibleTokenNames: names([["видимый", "Ллойд"]]),
      role: "PLAYER",
    });
    expect(visible.map((participant) => participant.name)).toEqual(["Ллойд"]);
    expect(JSON.stringify(visible)).not.toContain("засада");
  });

  it("не показывает игроку участника без токена", () => {
    // Его нет на карте, показывать нечего — и это тот же случай засады.
    expect(
      projectInitiative([roster[2]!], {
        visibleTokenNames: names([]),
        role: "PLAYER",
      }),
    ).toEqual([]);
  });

  it("отдаёт собственное имя отдельным полем", () => {
    // Редактору нужно отличать «зовусь как токен» от намеренной копии: по
    // одному видимому имени он бы их спутал (тот же урок, что в UIX-400).
    const [inherits, own] = projectInitiative(
      [
        { id: "a", tokenId: "t", name: null, initiative: null },
        { id: "b", tokenId: "t2", name: "Тэйн верхом", initiative: null },
      ],
      {
        visibleTokenNames: names([
          ["t", "Могучий Тэйн"],
          ["t2", "Могучий Тэйн"],
        ]),
        role: "GM",
      },
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
