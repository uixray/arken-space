import { describe, expect, it } from "vitest";
import { battleZoneSchema, tokensInBattleZone } from "@arken/contracts";
import { recruitFromZone } from "./initiative.js";

const SCENE = "11111111-1111-4111-8111-111111111111";
const OTHER_SCENE = "22222222-2222-4222-8222-222222222222";

const zone = {
  sceneId: SCENE,
  x: 100,
  y: 100,
  width: 200,
  height: 200,
} as const;

const token = (
  id: string,
  x: number,
  y: number,
  overrides: { sceneId?: string; width?: number; height?: number } = {},
) => ({
  id,
  sceneId: overrides.sceneId ?? SCENE,
  x,
  y,
  width: overrides.width ?? 64,
  height: overrides.height ?? 64,
});

const inZone = (tokens: ReturnType<typeof token>[]) =>
  tokensInBattleZone(tokens, zone).map((item) => item.id);

describe("состав по зоне боя", () => {
  it("берёт того, кто стоит внутри", () => {
    expect(inZone([token("внутри", 150, 150)])).toEqual(["внутри"]);
  });

  it("не берёт того, кто стоит снаружи", () => {
    expect(inZone([token("далеко", 500, 500)])).toEqual([]);
  });

  it("берёт задетого краем — мастер обводит поле примерно", () => {
    // Фигура заходит в зону на четверть. Требовать полного вхождения значило бы
    // заставлять обводить карту целиком ради гиганта у границы.
    expect(inZone([token("на краю", 84, 150)])).toEqual(["на краю"]);
  });

  it("не считает попаданием касание ребром", () => {
    // Правый край фигуры ровно на левой границе зоны. Иначе рамка, приложенная
    // вплотную к строю, втягивала бы соседнюю шеренгу.
    expect(inZone([token("вплотную", 36, 150)])).toEqual([]);
  });

  it("не берёт токен другой сцены, стоящий на тех же координатах", () => {
    // Самая дорогая ошибка: противники с прошлой карты в очереди текущего боя.
    expect(
      inZone([token("чужая сцена", 150, 150, { sceneId: OTHER_SCENE })]),
    ).toEqual([]);
  });

  it("берёт фигуру, накрывающую зону целиком", () => {
    // Дракон шире рамки: его центра в зоне нет, а сам он — весь бой.
    expect(
      inZone([token("дракон", 0, 0, { width: 500, height: 500 })]),
    ).toEqual(["дракон"]);
  });

  it("сохраняет порядок и не задваивает", () => {
    expect(
      inZone([
        token("a", 150, 150),
        token("мимо", 900, 900),
        token("b", 200, 200),
      ]),
    ).toEqual(["a", "b"]);
  });
});

describe("схема зоны боя", () => {
  it("требует сцену: прямоугольник без неё — прямоугольник «где-то»", () => {
    const { sceneId: _omitted, ...withoutScene } = zone;
    expect(battleZoneSchema.safeParse(withoutScene).success).toBe(false);
  });

  it("не принимает вырожденную зону", () => {
    // Нулевая ширина не отбирает никого, но выглядит как заданная зона —
    // мастер решил бы, что обвёл поле, и получил бы пустой бой.
    expect(battleZoneSchema.safeParse({ ...zone, width: 0 }).success).toBe(
      false,
    );
    expect(battleZoneSchema.safeParse({ ...zone, height: -10 }).success).toBe(
      false,
    );
  });

  it("не пропускает лишние поля", () => {
    expect(battleZoneSchema.safeParse({ ...zone, rotation: 45 }).success).toBe(
      false,
    );
  });
});

describe("пополнение очереди по зоне", () => {
  const participant = (
    id: string,
    tokenId: string | null,
    value: number | null = null,
  ) => ({
    id,
    tokenId,
    name: null as string | null,
    initiative: value,
  });
  const make = (tokenId: string) => participant(`строка-${tokenId}`, tokenId);

  it("добавляет тех, кого ещё нет", () => {
    expect(
      recruitFromZone(
        [participant("a", "токен-a")],
        [{ id: "токен-b" }],
        make,
      ).map((row) => row.tokenId),
    ).toEqual(["токен-a", "токен-b"]);
  });

  it("не задваивает уже введённого", () => {
    // Повторное нажатие «обновить по зоне» — самое обычное действие: мастер
    // подвинул фигуры и нажал ещё раз.
    expect(
      recruitFromZone([participant("a", "токен-a")], [{ id: "токен-a" }], make),
    ).toHaveLength(1);
  });

  it("сохраняет уже внесённые броски", () => {
    // Пересборка вместо пополнения стирала бы числа, которые мастер вносил с
    // физических кубов, — и это заметили бы только посреди боя.
    const [existing] = recruitFromZone(
      [participant("a", "токен-a", 17)],
      [{ id: "токен-b" }],
      make,
    );
    expect(existing!.initiative).toBe(17);
  });

  it("не выбрасывает вышедшего из зоны", () => {
    // Отступивший не выбывает из боя. Стереть его строку значило бы потерять и
    // его бросок, и его место в очереди.
    expect(
      recruitFromZone(
        [participant("a", "ушёл")],
        [{ id: "токен-b" }],
        make,
      ).map((row) => row.tokenId),
    ).toEqual(["ушёл", "токен-b"]);
  });

  it("не трогает участника без токена", () => {
    // «Волк №3» за столом: на карте его нет, и любой пересчёт по геометрии
    // потерял бы его.
    expect(
      recruitFromZone([participant("вне карты", null)], [], make).map(
        (row) => row.id,
      ),
    ).toEqual(["вне карты"]);
  });
});
