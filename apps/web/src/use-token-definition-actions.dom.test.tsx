// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameSnapshot, SceneDto } from "@arken/contracts";
import { renderComponent } from "./test-support/render";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: apiMock }));

const { useTokenDefinitionActions } =
  await import("./use-token-definition-actions");

/**
 * UIX-532 — проверяется провод, а не его концы.
 *
 * Хук собирает тела запросов вручную: `withAction({ … })` перечисляет поля по
 * одному. Ровно из такого списка выпал `pinned` в UIX-466 — панель ставила
 * поле, сервер его хранил, оба теста были зелёными, а по дороге значение
 * терялось. Здесь та же сборка в пяти местах, и до сих пор её не проверял
 * никто.
 *
 * Поэтому проверяется именно **отправленное тело**: путь, метод и каждое поле,
 * которое человек задал в редакторе. Не «вызвался ли обработчик» и не «что
 * ответил сервер» — они оба остались бы зелёными и при потерянном поле.
 */
const scene = { id: "сцена-1" } as SceneDto;

const actions = (snapshot: GameSnapshot | null = null) => {
  const run = vi.fn(async (action: () => Promise<unknown>) => {
    await action();
  });
  let captured!: ReturnType<typeof useTokenDefinitionActions>;
  function Probe() {
    captured = useTokenDefinitionActions({
      run: run as never,
      snapshotRef: { current: snapshot },
      activeSceneRef: { current: scene },
    });
    return null;
  }
  renderComponent(<Probe />);
  return captured;
};

/** Тело последнего запроса — разобранное, а не строкой. */
const sentBody = () => JSON.parse(apiMock.mock.calls.at(-1)![1].body);
const sentPath = () => apiMock.mock.calls.at(-1)![0];
const sentMethod = () => apiMock.mock.calls.at(-1)![1].method;

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue(undefined);
});

describe("тело запроса определения токена", () => {
  it("создание везёт все поля, которые задал мастер", async () => {
    // Каждое поле здесь — то, что человек выставил в редакторе. Потерянное по
    // дороге выглядит как «сохранил, а не применилось», и найти это можно
    // только руками: типы такую потерю не видят.
    await actions().onCreateTokenDefinition({
      name: "Страж",
      characterId: "персонаж-7",
      defaultAssetId: "ассет-3",
      defaultWidth: 128,
      defaultHeight: 64,
      controllerMembershipIds: ["участник-1", "участник-2"],
    });

    expect(sentPath()).toBe("/api/token-definitions");
    expect(sentMethod()).toBe("POST");
    expect(sentBody()).toMatchObject({
      name: "Страж",
      characterId: "персонаж-7",
      defaultAssetId: "ассет-3",
      defaultWidth: 128,
      defaultHeight: 64,
      controllerMembershipIds: ["участник-1", "участник-2"],
    });
  });

  it("создание с размещением использует атомарный POST /api/tokens", async () => {
    const activeScene = {
      id: "сцена-1",
      width: 1000,
      height: 800,
    } as SceneDto;
    const run = vi.fn(async (action: () => Promise<unknown>) => action());
    let captured!: ReturnType<typeof useTokenDefinitionActions>;
    function Probe() {
      captured = useTokenDefinitionActions({
        run: run as never,
        snapshotRef: { current: null },
        activeSceneRef: { current: activeScene },
      });
      return null;
    }
    renderComponent(<Probe />);

    await captured.onCreateAndPlaceTokenDefinition({
      name: "Страж",
      characterId: null,
      defaultAssetId: "ассет-3",
      defaultWidth: 128,
      defaultHeight: 64,
      controllerMembershipIds: ["участник-1"],
    });

    expect(sentPath()).toBe("/api/tokens");
    expect(sentMethod()).toBe("POST");
    expect(sentBody()).toMatchObject({
      sceneId: "сцена-1",
      assetId: "ассет-3",
      name: "Страж",
      x: 436,
      y: 368,
      width: 128,
      height: 64,
      controllerMembershipIds: ["участник-1"],
    });
  });

  it("правка везёт ревизию и ровно те поля, которые меняют", async () => {
    await actions().onPatchTokenDefinition("токен-1", 4, {
      name: null,
      defaultWidth: 96,
    });

    expect(sentPath()).toBe("/api/token-definitions/токен-1");
    expect(sentMethod()).toBe("PATCH");
    const body = sentBody();
    expect(body).toMatchObject({ revision: 4, defaultWidth: 96 });
    // `null` — это «зовусь как мой персонаж» (UIX-400), а не «не трогать».
    // Пропажа такого поля молча вернула бы собственное имя.
    expect(body.name).toBeNull();
    // Поля, которых мастер не касался, отправлять нечего: сервер обновляет
    // присланное, и лишнее поле затёрло бы чужую правку.
    expect(body).not.toHaveProperty("characterId");
  });

  it("замена управляющих везёт список целиком, а не по одному", async () => {
    await actions().onReplaceTokenControllers("токен-9", 2, [
      "участник-4",
      "участник-5",
    ]);

    expect(sentPath()).toBe("/api/token-definitions/токен-9/controllers");
    expect(sentMethod()).toBe("PUT");
    expect(sentBody()).toMatchObject({
      revision: 2,
      controllerMembershipIds: ["участник-4", "участник-5"],
    });
  });

  it("удаление везёт ревизию — иначе сервер не отличит устаревший запрос", async () => {
    await actions().onDeleteTokenDefinition("токен-3", 11);

    expect(sentMethod()).toBe("DELETE");
    expect(sentBody()).toMatchObject({ revision: 11 });
  });

  it("размещение везёт сцену, на которую кладут", async () => {
    await actions().onPlaceTokenDefinition("токен-2");

    expect(sentPath()).toBe("/api/token-definitions/токен-2/placements");
    expect(sentBody()).toMatchObject({
      definitionId: "токен-2",
      sceneId: "сцена-1",
    });
  });

  it("каждое тело несёт actionId — на нём держится защита от повтора", async () => {
    // Повторная отправка без него применилась бы дважды: сервер узнаёт
    // дубликат только по этому полю.
    await actions().onDeleteTokenDefinition("токен-3", 1);
    expect(typeof sentBody().actionId).toBe("string");
    expect(sentBody().actionId.length).toBeGreaterThan(10);
  });
});
