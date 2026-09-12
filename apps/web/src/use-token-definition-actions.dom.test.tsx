// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameSnapshot, SceneDto } from "@arken/contracts";
import { renderComponent } from "./test-support/render";
import type { OptimisticTokenPlacer } from "./optimistic-token-placement";

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
const scene = { id: "сцена-1", width: 1024, height: 768 } as SceneDto;

const actions = (
  snapshot: GameSnapshot | null = null,
  placeOptimistically?: OptimisticTokenPlacer,
) => {
  const run = vi.fn(async (action: () => Promise<unknown>) => {
    await action();
  });
  let captured!: ReturnType<typeof useTokenDefinitionActions>;
  function Probe() {
    captured = useTokenDefinitionActions({
      run: run as never,
      snapshotRef: { current: snapshot },
      activeSceneRef: { current: scene },
      placeOptimistically,
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
  const input = {
    name: "Страж",
    characterId: null,
    defaultAssetId: "asset-1",
    defaultWidth: 64,
    defaultHeight: 64,
    controllerMembershipIds: [],
  };

  it("обычное размещение по-прежнему завершается до optimistic outcome", async () => {
    const place = vi.fn<OptimisticTokenPlacer>(() => new Promise(() => {}));
    const commands = actions(null, place);
    await commands.onPlaceTokenDefinition("definition-1");
    expect(place).toHaveBeenCalledOnce();
    expect(place.mock.calls[0]?.[0]).toMatchObject({
      path: "/api/token-definitions/definition-1/placements",
      body: { definitionId: "definition-1", sceneId: scene.id },
    });
    expect(place.mock.calls[0]).toHaveLength(1);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("create-and-place ждёт accepted outcome и владеет ошибкой формы", async () => {
    let accept!: (outcome: Awaited<ReturnType<OptimisticTokenPlacer>>) => void;
    const place = vi.fn<OptimisticTokenPlacer>(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    );
    const commands = actions(null, place);
    const finished = vi.fn();
    const pending = commands
      .onCreateAndPlaceTokenDefinition(input)
      .then(finished);
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    expect(place.mock.calls[0]?.[0]).toMatchObject({
      path: "/api/tokens",
      body: {
        name: "Страж",
        assetId: "asset-1",
        width: 64,
        height: 64,
        x: 480,
        y: 352,
        sceneId: scene.id,
      },
    });
    expect(place.mock.calls[0]?.[1]).toEqual({ errorOwner: "caller" });
    accept({ status: "accepted" });
    await pending;
    expect(finished).toHaveBeenCalledOnce();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "failed", reason: new Error("Отказ сервера") }, "Отказ сервера"],
    [{ status: "cancelled" }, "Сессия изменилась"],
    [
      { status: "skipped", reason: "not-ready" },
      "Данные кампании ещё не загружены",
    ],
    [{ status: "skipped", reason: "paused" }, "Игра приостановлена"],
    [
      { status: "skipped", reason: "missing-scene" },
      "Активная сцена недоступна",
    ],
  ] satisfies [Awaited<ReturnType<OptimisticTokenPlacer>>, string][])(
    "create-and-place не считает outcome %j успешным",
    async (outcome, message) => {
      const place = vi.fn<OptimisticTokenPlacer>().mockResolvedValue(outcome);
      await expect(
        actions(null, place).onCreateAndPlaceTokenDefinition(input),
      ).rejects.toThrow(message);
      expect(apiMock).not.toHaveBeenCalled();
    },
  );

  it("исчезнувшая активная сцена не даёт ложного успеха без запроса", async () => {
    const place = vi.fn<OptimisticTokenPlacer>();
    // An explicit ref is needed: the helper's default scene is only fixture data.
    let captured!: ReturnType<typeof useTokenDefinitionActions>;
    function Probe() {
      captured = useTokenDefinitionActions({
        run: async (action) => {
          await action();
        },
        snapshotRef: { current: null },
        activeSceneRef: { current: undefined },
        placeOptimistically: place,
      });
      return null;
    }
    renderComponent(<Probe />);
    await expect(
      captured.onCreateAndPlaceTokenDefinition(input),
    ).rejects.toThrow("Активная сцена недоступна");
    expect(place).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();
  });
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
