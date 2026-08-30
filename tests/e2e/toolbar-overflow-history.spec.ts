import { randomUUID } from "node:crypto";
import { type Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";
import { selectViewedScene } from "./workspace-nav-helper";

/**
 * UIX-503 — панель карты называет, что отменит.
 *
 * Кнопки отмены и повтора были подписаны «Отменить последнее действие»: верно и
 * бесполезно. На карте боя за минуту происходит десяток правок, и вслепую
 * отменённое движение стоит хода.
 *
 * Спек идёт на живой стенд, а историю подменяет **точечно** — только маршрут
 * `/api/canvas/history`. Полностью замоканный снапшот здесь не подошёл: вид
 * мастера тяжелее игрокского и требует согласованных определений токенов,
 * сцен и сокета, так что падение говорило бы о полноте фикстуры, а не о
 * подписи. Подменять же саму историю необходимо: иначе её пришлось бы сперва
 * создать действиями на канвасе, и проверка подписи упиралась бы в проверку
 * рисования.
 *
 * Вторая половина задачи — пустое меню «•••» у игрока — проверяется настоящим
 * PLAYER-сеансом. Тест сначала входит мастером в отдельную кампанию фикстуры,
 * выпускает приглашение через сервер и затем принимает его как игрок. Роль не
 * подменяется в `/api/bootstrap`: иначе проверка могла бы пройти на состоянии,
 * которое реальная авторизация никогда не выдаёт.
 */
async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
}

async function signInAsPlayer(page: Page, gmToken: string) {
  await signInAsGm(page, gmToken);

  const gmBootstrap = await page.request.get("/api/bootstrap");
  await expect(gmBootstrap).toBeOK();
  const gmSnapshot = (await gmBootstrap.json()) as {
    characters: Array<{ id: string }>;
  };
  const character = gmSnapshot.characters[0];
  if (!character) throw new Error("В тестовой кампании нет персонажа");

  const invitationResponse = await page.request.post("/api/invites", {
    data: {
      actionId: randomUUID(),
      characterId: character.id,
      label: "Игрок UIX-503",
      expiresInHours: 1,
    },
  });
  await expect(invitationResponse).toBeOK();
  const invitation = (await invitationResponse.json()) as {
    url: string | null;
  };
  if (!invitation.url) throw new Error("Сервер не вернул ссылку игрока");

  const logoutResponse = await page.request.post("/api/auth/logout");
  await expect(logoutResponse).toBeOK();
  await page.goto(new URL(invitation.url).pathname);
  await page.getByLabel("Имя").fill("Игрок UIX-503");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");

  const playerBootstrap = await page.request.get("/api/bootstrap");
  await expect(playerBootstrap).toBeOK();
  const playerSnapshot = (await playerBootstrap.json()) as {
    me: { role: string };
  };
  expect(playerSnapshot.me.role).toBe("PLAYER");
}

const historyEntry = (overrides: Record<string, unknown> = {}) => ({
  sequence: 10,
  type: "TOKEN_MOVE",
  targetType: "TOKEN",
  targetId: "token-1",
  status: "APPLIED",
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

async function withHistory(
  page: Page,
  entries: ReturnType<typeof historyEntry>[],
) {
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(entries),
    }),
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("меню дополнительных инструментов доступно мастеру", async ({
  page,
  gmToken,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsGm(page, gmToken);
  // Локатор по классу, а не по роли: `<summary>` не имеет роли кнопки, и
  // `getByRole("button")` не находит его никогда. Проверка «у игрока меню нет»,
  // написанная через роль, была бы зелёной при любом поведении — вакуумной.
  await expect(page.locator(".toolbar-overflow > summary")).toBeVisible();
  await expect(page.locator(".toolbar-overflow > summary")).toHaveAttribute(
    "aria-label",
    "Дополнительные инструменты",
  );
  await page.locator(".toolbar-overflow > summary").click();
  await expect(
    page.getByText("Показывать сетку", { exact: true }),
  ).toBeVisible();
});

test("узкий PLAYER не получает пустое меню в DOM и Tab-обходе", async ({
  page,
  gmToken,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsPlayer(page, gmToken);

  const toolbar = page.getByRole("toolbar", { name: "Инструменты карты" });
  await expect(toolbar).toBeVisible();

  // У игрока «Курсоры» — последняя доступная кнопка перед историей. Пустые
  // Undo/Redo пропускаются Tab, поэтому прежняя пустая кнопка «•••» получала
  // фокус сразу после неё. Проверяем именно переход, а не только CSS-видимость.
  const lastPlayerTool = toolbar.locator('[data-tool="CURSOR_PRESENCE"]');
  await lastPlayerTool.focus();
  await expect(lastPlayerTool).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(lastPlayerTool).not.toBeFocused();
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest(".toolbar-overflow")),
    ),
  ).toBe(false);

  // Элемент не просто скрыт на узком экране: его вообще нет в дереве.
  await expect(toolbar.locator(".toolbar-overflow")).toHaveCount(0);
});

test("отмена и повтор называют действие, которое тронут", async ({
  page,
  gmToken,
}) => {
  await withHistory(page, [
    // После двух Undo запись с меньшим исходным sequence может быть последней
    // по transitionSequence. Сервер уже отдаёт историю в порядке переходов.
    historyEntry({
      sequence: 10,
      status: "UNDONE",
      type: "DRAWING_CREATE",
      nextDirection: "redo",
    }),
    historyEntry({
      sequence: 11,
      status: "APPLIED",
      type: "TOKEN_RESIZE",
      nextDirection: "undo",
    }),
    historyEntry({ sequence: 12, status: "UNDONE", type: "TOKEN_MOVE" }),
  ]);
  await signInAsGm(page, gmToken);

  // Берётся первая подходящая в авторитетном порядке переходов — та же запись,
  // которую выберет сервер. Исходный sequence намеренно не определяет выбор.
  const undo = page.locator('[data-tool="UNDO"]');
  await expect(undo).toHaveAttribute(
    "aria-label",
    "Отменить: размер токена изменён",
  );
  // Подсказка и доступное имя — один текст: всплывающая подсказка недоступна
  // ни клавиатуре, ни программе чтения с экрана.
  await expect(undo).toHaveAttribute(
    "title",
    "Отменить: размер токена изменён",
  );

  await expect(page.locator('[data-tool="REDO"]')).toHaveAttribute(
    "aria-label",
    "Повторить: рисунок создан",
  );
});

test("история очищается при смене сцены и игнорирует запоздалый ответ", async ({
  page,
  gmToken,
}) => {
  await signInAsGm(page, gmToken);
  const bootstrapResponse = await page.request.get("/api/bootstrap");
  await expect(bootstrapResponse).toBeOK();
  const snapshot = (await bootstrapResponse.json()) as {
    scenes: Array<{
      id: string;
      name: string;
      active: boolean;
      revision: number;
    }>;
  };
  const primaryScene =
    snapshot.scenes.find((scene) => scene.active) ?? snapshot.scenes[0];
  if (!primaryScene) throw new Error("В тестовой кампании нет сцены");
  const createSceneResponse = await page.request.post("/api/scenes", {
    data: {
      actionId: randomUUID(),
      name: "Сцена истории B",
    },
  });
  await expect(createSceneResponse).toBeOK();
  const secondaryScene = (await createSceneResponse.json()) as {
    id: string;
    name: string;
  };

  const secondaryResponses = deferred();
  const delayedPrimaryResponses = deferred();
  let blockSecondary = false;
  let blockPrimary = false;
  let delayedPrimarySent = 0;
  const callCounts = new Map<string, number>();
  await page.route("**/api/canvas/history**", async (route) => {
    const sceneId = new URL(route.request().url()).searchParams.get("sceneId");
    if (!sceneId) throw new Error("History-запрос без sceneId");
    const call = (callCounts.get(sceneId) ?? 0) + 1;
    callCounts.set(sceneId, call);
    if (sceneId === secondaryScene.id && blockSecondary)
      await secondaryResponses.promise;
    const isDelayedPrimary = sceneId === primaryScene.id && blockPrimary;
    if (isDelayedPrimary) await delayedPrimaryResponses.promise;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        historyEntry({
          sequence: sceneId === secondaryScene.id ? 20 : 10,
          type: isDelayedPrimary
            ? "TOKEN_RESIZE"
            : sceneId === secondaryScene.id
              ? "DRAWING_CREATE"
              : "TOKEN_MOVE",
          nextDirection: "undo",
        }),
      ]),
    });
    if (isDelayedPrimary) delayedPrimarySent += 1;
  });

  await page.reload();
  const undo = page.locator('[data-tool="UNDO"]');
  await expect(undo).toHaveAttribute("aria-label", "Отменить: токен перемещён");

  // Пока история B задержана, история A не должна ни называться, ни разрешать
  // команду уже для нового sceneId.
  blockSecondary = true;
  const secondaryCallsBeforeSwitch = callCounts.get(secondaryScene.id) ?? 0;
  await selectViewedScene(page, secondaryScene.name);
  await expect
    .poll(() => callCounts.get(secondaryScene.id) ?? 0)
    .toBeGreaterThan(secondaryCallsBeforeSwitch);
  await expect(undo).toBeDisabled();
  await expect(undo).toHaveAttribute(
    "aria-label",
    "Отменить последнее действие",
  );
  blockSecondary = false;
  secondaryResponses.resolve();
  await expect(undo).toHaveAttribute("aria-label", "Отменить: рисунок создан");

  // Старый запрос A остаётся в полёте. После B снова открываем A и получаем её
  // свежий ответ с тем же requestKey, затем выпускаем прежний A: одной проверки
  // ключа здесь недостаточно, нужен generation guard.
  blockPrimary = true;
  const primaryCallsBeforeSwitch = callCounts.get(primaryScene.id) ?? 0;
  await selectViewedScene(page, primaryScene.name);
  await expect
    .poll(() => callCounts.get(primaryScene.id) ?? 0)
    .toBeGreaterThan(primaryCallsBeforeSwitch);
  await expect(undo).toBeDisabled();
  const secondaryCallsBeforeReturn = callCounts.get(secondaryScene.id) ?? 0;
  await selectViewedScene(page, secondaryScene.name);
  await expect
    .poll(() => callCounts.get(secondaryScene.id) ?? 0)
    .toBeGreaterThan(secondaryCallsBeforeReturn);
  await expect(undo).toHaveAttribute("aria-label", "Отменить: рисунок создан");
  blockPrimary = false;
  const primaryCallsBeforeReturn = callCounts.get(primaryScene.id) ?? 0;
  await selectViewedScene(page, primaryScene.name);
  await expect
    .poll(() => callCounts.get(primaryScene.id) ?? 0)
    .toBeGreaterThan(primaryCallsBeforeReturn);
  await expect(undo).toHaveAttribute("aria-label", "Отменить: токен перемещён");
  delayedPrimaryResponses.resolve();
  await expect.poll(() => delayedPrimarySent).toBeGreaterThan(0);
  await page.waitForTimeout(100);
  await expect(undo).toHaveAttribute("aria-label", "Отменить: токен перемещён");
});

test("realtime-правка с немаксимальной ревизией обновляет подпись", async ({
  page,
  gmToken,
}) => {
  await signInAsGm(page, gmToken);
  const bootstrapResponse = await page.request.get("/api/bootstrap");
  await expect(bootstrapResponse).toBeOK();
  const snapshot = (await bootstrapResponse.json()) as {
    scenes: Array<{ id: string; active: boolean }>;
  };
  const scene =
    snapshot.scenes.find((candidate) => candidate.active) ?? snapshot.scenes[0];
  if (!scene) throw new Error("В тестовой кампании нет сцены");

  const createDrawing = async (color: string) => {
    const response = await page.request.post("/api/drawings", {
      data: {
        actionId: randomUUID(),
        sceneId: scene.id,
        points: [0, 0, 16, 16],
        color,
      },
    });
    await expect(response).toBeOK();
    return (await response.json()) as { id: string; revision: number };
  };

  const lowRevision = await createDrawing("#111111");
  let highRevision = await createDrawing("#222222");
  for (const color of ["#333333", "#444444"]) {
    const response = await page.request.patch(
      `/api/drawings/${highRevision.id}`,
      {
        data: {
          actionId: randomUUID(),
          revision: highRevision.revision,
          color,
        },
      },
    );
    await expect(response).toBeOK();
    highRevision = (await response.json()) as {
      id: string;
      revision: number;
    };
  }

  const undo = page.locator('[data-tool="UNDO"]');
  await expect(undo).toHaveAttribute("aria-label", "Отменить: рисунок изменён");

  // У второй фигуры revision=2. Перенос первой 0→1 не менял прежний ключ
  // `length + max(revision)`, поэтому история оставалась на предыдущем
  // DRAWING_UPDATE. Новый отпечаток обязан заметить именно эту правку.
  const moved = await page.request.post("/api/canvas/bulk", {
    data: {
      actionId: randomUUID(),
      sceneId: scene.id,
      operation: "MOVE",
      deltaX: 1,
      deltaY: 1,
      targets: [
        {
          targetType: "DRAWING",
          targetId: lowRevision.id,
          revision: lowRevision.revision,
        },
      ],
    },
  });
  await expect(moved).toBeOK();
  await expect(undo).toHaveAttribute(
    "aria-label",
    "Отменить: объекты перемещены",
  );
});

test("недоступная кнопка не обещает действия, которого нет", async ({
  page,
  gmToken,
}) => {
  await withHistory(page, []);
  await signInAsGm(page, gmToken);
  const undo = page.locator('[data-tool="UNDO"]');
  await expect(undo).toBeDisabled();
  await expect(undo).toHaveAttribute(
    "aria-label",
    "Отменить последнее действие",
  );
});
