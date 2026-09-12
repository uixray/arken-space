import { randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { type GameSnapshot } from "@arken/contracts";
import { expect, test } from "./campaign-fixture";
import { openWorkspaceSection } from "./workspace-nav-helper";
import { assertModalFocusCycle } from "./modal-focus";

/**
 * UIX-624 / P1: четыре настоящих GM/PLAYER × viewport journey, по одному
 * изолированному campaign-fixture на тест. Оба проекта Playwright дают 8 runs
 * основного пула + 4 runs отдельных desktop-first/preview регрессий.
 * Нет routes/bootstrap mocks, default seed, React/Konva internals или production.
 * Это Chromium/Firefox desktop viewport + keyboard automation, не физический
 * touch, Safari, экранная клавиатура или доказательство мобильного P2–P6.
 */
const roots = {
  map: "#main-content",
  journal: "#activity-sidebar",
  character: "#character-workspace",
} as const;
type Surface = keyof typeof roots;
const listSelector = "#activity-message-list";
const playerName = "Игрок мобильной проверки";

async function bootstrap(page: Page): Promise<GameSnapshot> {
  const response = await page.request.get("/api/bootstrap");
  await expect(response).toBeOK();
  return response.json() as Promise<GameSnapshot>;
}

async function postLog(
  page: Page,
  count: number,
  prefix: string,
  request = page.request,
) {
  const messages: GameSnapshot["messages"] = [];
  for (let index = 0; index < count; index += 1) {
    const response = await request.post("/api/chat", {
      data: {
        actionId: randomUUID(),
        stream: "TABLE",
        body: `${prefix} ${index} — достаточно длинная запись для настоящего переполнения журнала и проверки позиции читателя.`,
      },
    });
    await expect(response).toBeOK();
    messages.push((await response.json()) as GameSnapshot["messages"][number]);
  }
  return messages;
}

async function scrollMetrics(page: Page) {
  return page.locator(listSelector).evaluate((element) => ({
    top: element.scrollTop,
    overflow: element.scrollHeight - element.clientHeight,
    bottom: element.scrollHeight - element.clientHeight - element.scrollTop,
  }));
}

async function assertSurface(
  page: Page,
  active: Surface,
  characterMounted = true,
) {
  const nav = page.getByRole("navigation", { name: "Основные области" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button")).toHaveCount(3);
  for (const surface of Object.keys(roots) as Surface[]) {
    const button = page.locator(`#compact-nav-${surface}`);
    await expect(button).toHaveAttribute(
      "aria-pressed",
      String(surface === active),
    );
    const root = page.locator(roots[surface]);
    if (surface === "character" && !characterMounted) {
      await expect(root).toHaveCount(0);
      // До первого mount никакой ссылки на несуществующий ARIA target.
      await expect(button).not.toHaveAttribute("aria-controls");
      continue;
    }
    await expect(button).toHaveAttribute(
      "aria-controls",
      roots[surface].slice(1),
    );
    await expect(root).toHaveCount(1);
    if (surface === active) {
      await expect(root).toBeVisible();
      await expect(root).not.toHaveAttribute("hidden");
      await expect(root).not.toHaveAttribute("inert");
    } else {
      await expect(root).toBeHidden();
      await expect(root).toHaveAttribute("hidden");
      await expect(root).toHaveAttribute("inert");
    }
  }
}

async function switchSurface(page: Page, surface: Surface, keyboard = false) {
  const button = page.locator(`#compact-nav-${surface}`);
  if (keyboard) {
    await button.focus();
    await page.keyboard.press("Enter");
  } else await button.click();
  await expect
    .poll(() =>
      page.evaluate(
        ({ root, buttonId }) =>
          Boolean(
            document.activeElement?.closest(root) ||
            document.activeElement?.id === buttonId,
          ),
        { root: roots[surface], buttonId: `compact-nav-${surface}` },
      ),
    )
    .toBe(true);
}

async function assertTabExcludesHiddenRoots(page: Page, surface: Surface) {
  await page.locator(`#compact-nav-${surface}`).focus();
  // Начинаем с известной точки; обязательно проверяем фактический activeElement,
  // а не только tabindex: браузер сам исключает hidden/inert поддеревья.
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest("[hidden], [inert]")),
      ),
      `Tab ${index + 1} попал в скрытую область`,
    ).toBe(false);
  }
}

async function assertModalOwnsFocus(page: Page, dialog: Locator) {
  await assertModalFocusCycle(page, dialog);
  // Не force-click: реальный pointer action должен быть недоступен под модалом.
  await expect(
    page.locator("#compact-nav-map").click({ trial: true, timeout: 600 }),
  ).rejects.toThrow();
}

for (const role of ["GM", "PLAYER"] as const) {
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 820, height: 1180 },
  ]) {
    test(`${role} ${viewport.width}×${viewport.height}: compact entry, retained surfaces and handoff`, async ({
      page,
      gmToken,
      playwright,
    }, testInfo) => {
      test.setTimeout(120_000);
      const geometry: unknown[] = [];
      let peer: APIRequestContext | undefined;
      let readPhase = "unobserved";
      const readRequests: Array<{
        phase: string;
        threadId: string;
        sequence: number;
      }> = [];
      const observeReadRequests = (request: Request) => {
        if (
          request.method() !== "POST" ||
          new URL(request.url()).pathname !== "/api/chat/read"
        )
          return;
        const { threadId, sequence } = request.postDataJSON() as {
          threadId: string;
          sequence: number;
        };
        readRequests.push({ phase: readPhase, threadId, sequence });
      };
      page.on("request", observeReadRequests);
      async function recordLayout(phase: string, entry = false) {
        const measurement = await page.evaluate(() => {
          const rect = (selector: string) => {
            const element = document.querySelector(selector);
            if (!(element instanceof HTMLElement)) return null;
            const box = element.getBoundingClientRect();
            return {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              hidden: element.hidden,
              inert: element.inert,
              scrollWidth: element.scrollWidth,
              scrollHeight: element.scrollHeight,
            };
          };
          return {
            viewport: { width: innerWidth, height: innerHeight },
            visualViewport: window.visualViewport && {
              width: window.visualViewport.width,
              height: window.visualViewport.height,
              offsetTop: window.visualViewport.offsetTop,
            },
            document: {
              width: document.documentElement.scrollWidth,
              height: document.documentElement.scrollHeight,
            },
            body: {
              width: document.body.scrollWidth,
              height: document.body.scrollHeight,
            },
            roots: {
              map: rect("#main-content"),
              journal: rect("#activity-sidebar"),
              character: rect("#character-workspace"),
              nav: rect(".compact-navigation"),
            },
          };
        });
        geometry.push({ phase, ...measurement });
        expect(
          measurement.document.width,
          `${phase}: document x-overflow`,
        ).toBeLessThanOrEqual(measurement.viewport.width + 1);
        expect(
          measurement.body.width,
          `${phase}: body x-overflow`,
        ).toBeLessThanOrEqual(measurement.viewport.width + 1);
        if (!entry) {
          expect(
            measurement.document.height,
            `${phase}: document y-overflow`,
          ).toBeLessThanOrEqual(measurement.viewport.height + 1);
          expect(
            measurement.body.height,
            `${phase}: body y-overflow`,
          ).toBeLessThanOrEqual(measurement.viewport.height + 1);
        }
      }
      async function targetGeometry(target: Locator, label: string) {
        await expect(target).toBeVisible();
        await target.scrollIntoViewIfNeeded();
        const box = await target.boundingBox();
        expect(box).not.toBeNull();
        geometry.push({ phase: label, target: box });
        expect(box!.width, `${label}: width`).toBeGreaterThanOrEqual(44);
        expect(box!.height, `${label}: height`).toBeGreaterThanOrEqual(44);
        expect(box!.x, `${label}: left clipping`).toBeGreaterThanOrEqual(-1);
        expect(box!.y, `${label}: top clipping`).toBeGreaterThanOrEqual(-1);
        expect(
          box!.x + box!.width,
          `${label}: right clipping`,
        ).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
        expect(
          box!.y + box!.height,
          `${label}: bottom clipping`,
        ).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
      }

      try {
        await page.setViewportSize(viewport);
        await test.step("Персональная ссылка и настоящая роль", async () => {
          await page.goto(`/gm/${gmToken}`);
          await targetGeometry(
            page.getByRole("button", { name: "Войти", exact: true }),
            "gm-entry",
          );
          await recordLayout("gm-entry", true);
          await page
            .getByRole("button", { name: "Войти", exact: true })
            .click();
          await expect(page).toHaveURL("/");
          if (role === "PLAYER") {
            const gm = await bootstrap(page);
            expect(gm.characters.length).toBeGreaterThan(0);
            const response = await page.request.post("/api/invites", {
              data: {
                actionId: randomUUID(),
                characterId: gm.characters[0].id,
                label: playerName,
                expiresInHours: 1,
              },
            });
            await expect(response).toBeOK();
            const invitation = (await response.json()) as { url: string };
            await expect(await page.request.post("/api/auth/logout")).toBeOK();
            await page.goto(new URL(invitation.url).pathname);
            const name = page.getByLabel("Имя", { exact: true });
            await targetGeometry(name, "player-entry-name");
            await name.fill(playerName);
            await expect(name).toBeFocused();
            await page.keyboard.press("Tab");
            const enter = page.getByRole("button", {
              name: "Войти",
              exact: true,
            });
            await expect(enter).toBeFocused();
            await targetGeometry(enter, "player-entry-submit");
            await recordLayout("player-entry", true);
            await page.keyboard.press("Enter");
            await expect(page).toHaveURL("/");
          }
          expect((await bootstrap(page)).me.role).toBe(role);
          await assertSurface(page, "map", false);
        });

        const snapshot = await bootstrap(page);
        const preferenceKey = `arken.sidebarCollapsed:${encodeURIComponent(snapshot.campaign.id)}:${encodeURIComponent(snapshot.me.id)}`;
        const preference = () =>
          page.evaluate((key) => localStorage.getItem(key), preferenceKey);
        await test.step("Compact не переписывает desktop collapse preference", async () => {
          await page.setViewportSize({ width: 1440, height: 900 });
          await page
            .getByRole("button", {
              name: "Свернуть боковую панель",
              exact: true,
            })
            .click();
          await expect.poll(preference).toBe("true");
          await page.setViewportSize(viewport);
          await assertSurface(page, "map", false);
          await recordLayout("map");
          for (const surface of Object.keys(roots) as Surface[]) {
            await targetGeometry(
              page.locator(`#compact-nav-${surface}`),
              `nav-${surface}`,
            );
          }
          await targetGeometry(
            page.getByLabel("Меню сеанса", { exact: true }),
            "account-trigger",
          );
          await targetGeometry(
            page.getByRole("button", { name: "Разделы", exact: true }),
            "sections-trigger",
          );
        });

        const canvas = page.locator("#main-content canvas").first();
        await expect(canvas).toBeVisible();
        const canvasIdentity = await canvas.elementHandle();
        const zoom = page.locator(
          '#main-content input[aria-label="Масштаб карты"]',
        );
        const initialZoom = await zoom.inputValue();
        await page
          .getByRole("button", { name: "Увеличить масштаб", exact: true })
          .click();
        await expect(zoom).not.toHaveValue(initialZoom);
        const retainedZoom = await zoom.inputValue();
        geometry.push({
          phase: "camera-observable",
          zoom: retainedZoom,
          limitation:
            "DOM zoom + canvas identity; pan is not exposed by public DOM",
        });

        await test.step("Разделы сохраняют существующий utility путь", async () => {
          await openWorkspaceSection(page, "Токены");
          const tokens = page.getByRole("dialog", {
            name: "Токены",
            exact: true,
          });
          await expect(tokens).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(tokens).toBeHidden();
          await assertSurface(page, "map", false);
        });

        const chatDraft = "Несохранённый текст мобильного журнала";
        const compose = page.locator(
          "#activity-sidebar .chat-compose textarea",
        );
        await test.step("Журнал: draft, follow и позиция читающего переживают display:none", async () => {
          // Другой настоящий отправитель нужен для unreadCount: свои сообщения
          // сервер намеренно исключает. Только API cookie jar, без второй page.
          peer = await playwright.request.newContext({
            baseURL: new URL(page.url()).origin,
          });
          if (role === "GM") {
            const invitationResponse = await page.request.post("/api/invites", {
              data: {
                actionId: randomUUID(),
                characterId: snapshot.characters[0].id,
                label: "Собеседник P1",
                expiresInHours: 1,
              },
            });
            await expect(invitationResponse).toBeOK();
            const invitation = (await invitationResponse.json()) as {
              url: string;
            };
            await expect(
              await peer.post("/api/auth/invite", {
                data: {
                  token: new URL(invitation.url).pathname.split("/").at(-1),
                  displayName: "Собеседник P1",
                },
              }),
            ).toBeOK();
          } else {
            await expect(
              await peer.post("/api/auth/gm", { data: { token: gmToken } }),
            ).toBeOK();
          }
          const tableState = async () => {
            const state = (await bootstrap(page)).chatThreadStates.find(
              (thread) => thread.stream === "TABLE",
            );
            if (!state) throw new Error("Нет TABLE read state");
            return state;
          };
          async function receiveWhileHidden(prefix: string, phase: string) {
            await expect
              .poll(async () => {
                const state = await tableState();
                return state.latestSequence - state.lastReadSequence;
              })
              .toBe(0);
            const before = await tableState();
            readPhase = phase;
            await switchSurface(page, "map");
            await assertSurface(page, "map", false);
            const [message] = await postLog(page, 1, prefix, peer);
            // DOM receipt доказывает доставку по реальному socket, а не только
            // успешную запись API. Read-запросы наблюдаем, маршруты не подменяем.
            await expect(
              page
                .locator(listSelector)
                .getByText(message.body, { exact: true }),
            ).toHaveCount(1);
            // Отрицательная проверка включает существующий 350ms read debounce
            // ChatPanels; мгновенный assert пропустил бы отложенный hidden read.
            await page.waitForTimeout(500);
            expect(
              readRequests.filter((request) => request.phase === phase),
              "Скрытый журнал отправил read POST",
            ).toEqual([]);
            const hidden = await tableState();
            expect(hidden.latestSequence).toBeGreaterThanOrEqual(
              message.sequence,
            );
            expect(hidden.lastReadSequence).toBe(before.lastReadSequence);
            expect(hidden.unreadCount).toBeGreaterThan(0);
            geometry.push({
              phase,
              readBefore: before,
              hiddenReadState: hidden,
            });
            readPhase = `${phase}-reopen`;
            await switchSurface(page, "journal");
            await expect
              .poll(() =>
                readRequests.some(
                  (request) =>
                    request.phase === `${phase}-reopen` &&
                    request.threadId === message.threadId &&
                    request.sequence >= message.sequence,
                ),
              )
              .toBe(true);
            await expect
              .poll(async () => (await tableState()).lastReadSequence)
              .toBeGreaterThanOrEqual(message.sequence);
            await expect
              .poll(async () => (await tableState()).unreadCount)
              .toBe(0);
            readPhase = "unobserved";
          }
          await postLog(page, 30, "Мобильный журнал");
          await switchSurface(page, "journal");
          await assertSurface(page, "journal", false);
          await page.locator("#chat-tab-activity").click();
          const list = page.locator(listSelector);
          await expect(list.getByText(/^Мобильный журнал 29 —/)).toHaveCount(1);
          await expect
            .poll(async () => (await scrollMetrics(page)).overflow)
            .toBeGreaterThan(200);
          await expect
            .poll(async () => (await scrollMetrics(page)).bottom)
            .toBeLessThanOrEqual(4);
          await compose.fill(chatDraft);
          await targetGeometry(compose, "chat-compose");
          await targetGeometry(
            page
              .locator("#activity-sidebar .activity-quick-rolls > .g-button")
              .first(),
            "journal-quick-roll",
          );
          await expect(compose).toBeFocused();
          const composeIdentity = await compose.elementHandle();
          await recordLayout("journal");
          await receiveWhileHidden(
            "Новая запись при слежении",
            "hidden-follow",
          );
          // Pointer сначала переводит фокус в nav, до React onClick. Последнее
          // поле должно запоминаться раньше, иначе вернётся только aside/body.
          await expect(compose).toBeFocused();
          await expect
            .poll(async () => (await scrollMetrics(page)).bottom)
            .toBeLessThanOrEqual(4);
          await expect(compose).toHaveValue(chatDraft);
          expect(
            await compose.evaluate(
              (element, original) => element === original,
              composeIdentity,
            ),
          ).toBe(true);
          // Отдельно keyboard activation nav: фокус перемещён на кнопку,
          // Enter меняет поверхность. Это не заявление о физической клавиатуре.
          await switchSurface(page, "map", true);
          await switchSurface(page, "journal", true);
          await expect(compose).toBeFocused();
          await list.evaluate((element) => element.scrollTo({ top: 120 }));
          await expect
            .poll(async () => (await scrollMetrics(page)).top)
            .toBe(120);
          const readerTop = (await scrollMetrics(page)).top;
          await expect
            .poll(async () => (await scrollMetrics(page)).bottom)
            .toBeGreaterThan(100);
          await receiveWhileHidden("Новая запись при чтении", "hidden-reader");
          await expect
            .poll(async () =>
              Math.abs((await scrollMetrics(page)).top - readerTop),
            )
            .toBeLessThanOrEqual(4);
          await assertTabExcludesHiddenRoots(page, "journal");
          await expect.poll(preference).toBe("true");
        });

        const character = snapshot.characters[0];
        expect(character).toBeTruthy();
        const resourceDraft = "Ресурс ещё не добавлен";
        const draftInput = page
          .locator(roots.character)
          .getByPlaceholder("Новый ресурс", { exact: true });
        await test.step("Персонаж: несохранённое поле и nested modal не теряют владельца", async () => {
          await switchSurface(page, "character", true);
          await assertSurface(page, "character");
          const sheet = page.locator(
            `[data-character-sheet-id="${character.id}"]`,
          );
          if (!(await sheet.isVisible())) {
            await page
              .locator(".character-rail__item")
              .filter({ hasText: character.name })
              .getByRole("button")
              .first()
              .click();
          }
          await expect(sheet).toBeVisible();
          await draftInput.fill(resourceDraft);
          await recordLayout("character");
          await sheet
            .getByRole("button", { name: "Переименовать", exact: true })
            .click();
          const rename = page.getByRole("dialog", {
            name: "Переименовать персонажа",
            exact: true,
          });
          await assertModalOwnsFocus(page, rename);
          await page.keyboard.press("Escape");
          await expect(rename).toBeHidden();
          await assertSurface(page, "character");
          await expect(draftInput).toHaveValue(resourceDraft);
          await assertTabExcludesHiddenRoots(page, "character");
        });

        const draftIdentity = await draftInput.elementHandle();
        await test.step("Portrait → landscape → desktop → назад без remount и потери выбора", async () => {
          for (const [phase, size] of [
            ["landscape", { width: viewport.height, height: viewport.width }],
            ["desktop", { width: 1440, height: 900 }],
            ["portrait-return", viewport],
          ] as const) {
            await page.setViewportSize(size);
            if (size.width <= 1023) await assertSurface(page, "character");
            else {
              await expect(page.locator(".compact-navigation")).toBeHidden();
              await expect(page.locator(roots.character)).toBeVisible();
              await expect(page.locator(".workbench")).toHaveClass(
                /is-sidebar-collapsed/,
              );
              await expect(page.locator(roots.journal)).toBeHidden();
            }
            await expect(draftInput).toHaveValue(resourceDraft);
            expect(
              await draftInput.evaluate(
                (element, original) => element === original,
                draftIdentity,
              ),
            ).toBe(true);
            await expect.poll(preference).toBe("true");
            await recordLayout(phase);
          }
          await switchSurface(page, "map");
          await assertSurface(page, "map");
          await expect(zoom).toHaveValue(retainedZoom);
          expect(
            await canvas.evaluate(
              (element, original) => element === original,
              canvasIdentity,
            ),
          ).toBe(true);
          await assertTabExcludesHiddenRoots(page, "map");
          await switchSurface(page, "journal");
          await assertSurface(page, "journal");
          await expect(compose).toHaveValue(chatDraft);
          // Кэшированный скрытый CharacterWorkspace не владеет Escape.
          await page.keyboard.press("Escape");
          await assertSurface(page, "journal");
          await switchSurface(page, "character");
          await assertSurface(page, "character");
          await expect(draftInput).toHaveValue(resourceDraft);
          expect(
            (await bootstrap(page)).characters.find(
              (item) => item.id === character.id,
            )?.resources,
          ).not.toHaveProperty(resourceDraft);
        });

        await test.step("Видимый account control, отмена и реальный выход/handoff", async () => {
          await page.getByLabel("Меню сеанса", { exact: true }).click();
          const action = page.locator(".account-menu").getByRole("button", {
            name: role === "PLAYER" ? "Сменить игрока" : "Выйти",
            exact: true,
          });
          await targetGeometry(action, "account-session-action");
          await action.click();
          if (role === "PLAYER") {
            const handoff = page.getByRole("dialog", {
              name: "Сменить игрока?",
              exact: true,
            });
            await expect(handoff).toContainText("несохранённые данные");
            await assertModalOwnsFocus(page, handoff);
            await page.keyboard.press("Escape");
            await expect(handoff).toBeHidden();
            await expect(draftInput).toHaveValue(resourceDraft);
            // Escape закрывает только confirmation; меню может быть закрыто
            // собственным outside/focus handler, поэтому открываем при нужде.
            if (!(await action.isVisible()))
              await page.getByLabel("Меню сеанса", { exact: true }).click();
            await action.click();
            const confirm = handoff.getByRole("button", {
              name: "Сменить игрока",
              exact: true,
            });
            await targetGeometry(confirm, "handoff-confirm");
            await confirm.click();
          }
          await expect(
            page.getByRole("heading", { name: "Выберите игрока", exact: true }),
          ).toBeVisible();
          await expect
            .poll(async () =>
              (await page.request.get("/api/bootstrap")).status(),
            )
            .toBe(401);
          for (const selector of Object.values(roots))
            await expect(page.locator(selector)).toHaveCount(0);
          await recordLayout("signed-out", true);
          await page.reload();
          await expect(
            page.getByRole("heading", { name: "Выберите игрока", exact: true }),
          ).toBeVisible();
          await expect(
            page.getByText(`Вы играете как: ${playerName}`, { exact: true }),
          ).toHaveCount(0);
        });
      } finally {
        page.off("request", observeReadRequests);
        await peer?.dispose();
        geometry.push({
          phase: "read-request-observer",
          requests: readRequests,
        });
        await testInfo.attach("mobile-foundation-geometry.json", {
          body: Buffer.from(
            JSON.stringify(
              {
                project: testInfo.project.name,
                role,
                viewport,
                measurements: geometry,
              },
              null,
              2,
            ),
          ),
          contentType: "application/json",
        });
      }
    });
  }
}

test("desktop-first Characters survive compact map roundtrip without remount", async ({
  page,
  gmToken,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/gm/${gmToken}`);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL("/");
  const character = (await bootstrap(page)).characters[0];
  expect(character).toBeTruthy();
  await openWorkspaceSection(page, "Персонажи");
  const workspace = page.locator(roots.character);
  await expect(workspace).toBeVisible();
  const sheet = page.locator(`[data-character-sheet-id="${character.id}"]`);
  if (!(await sheet.isVisible())) {
    await page
      .locator(".character-rail__item")
      .filter({ hasText: character.name })
      .getByRole("button")
      .first()
      .click();
  }
  const draft = workspace.getByPlaceholder("Новый ресурс", { exact: true });
  await draft.fill("Desktop draft до compact");
  const identity = await draft.elementHandle();
  await page.setViewportSize({ width: 360, height: 800 });
  await assertSurface(page, "character");
  await switchSurface(page, "map");
  await assertSurface(page, "map");
  await switchSurface(page, "character");
  await assertSurface(page, "character");
  await expect(draft).toHaveValue("Desktop draft до compact");
  await expect(draft).toBeFocused();
  expect(
    await draft.evaluate((element, original) => element === original, identity),
  ).toBe(true);
  // Portal CharacterWorkspace не должен перекрывать header account popup.
  await page.getByLabel("Меню сеанса", { exact: true }).click();
  const shortcuts = page
    .locator(".account-menu")
    .getByRole("button", { name: "Клавиши и команды", exact: true });
  await expect(shortcuts).toBeVisible();
  await shortcuts.click();
  await expect(
    page.getByRole("dialog", { name: "Клавиши и команды", exact: true }),
  ).toBeVisible();
});

test("compact player preview exposes only available surfaces and account exit", async ({
  page,
  gmToken,
  playwright,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/gm/${gmToken}`);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL("/");
  const character = (await bootstrap(page)).characters[0];
  expect(character).toBeTruthy();
  const response = await page.request.post("/api/invites", {
    data: {
      actionId: randomUUID(),
      characterId: character.id,
      label: "Игрок preview",
      expiresInHours: 1,
    },
  });
  await expect(response).toBeOK();
  const invitation = (await response.json()) as { url: string };
  // Только реальный отдельный PLAYER cookie jar; не вторая browser page,
  // которая обходила бы auto console guard основной campaign-fixture.
  const player = await playwright.request.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    await expect(
      await player.post("/api/auth/invite", {
        data: {
          token: new URL(invitation.url).pathname.split("/").at(-1),
          displayName: "Игрок preview",
        },
      }),
    ).toBeOK();
  } finally {
    await player.dispose();
  }
  await page.reload();
  await openWorkspaceSection(page, "Подготовка");
  await page
    .getByRole("dialog", { name: "Подготовка", exact: true })
    .getByRole("button", { name: "Посмотреть глазами игрока", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Глазами игрока", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  const nav = page.getByRole("navigation", { name: "Основные области" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button")).toHaveCount(2);
  await expect(page.locator("#compact-nav-character")).toHaveCount(0);
  await expect(page.locator(roots.character)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Разделы", exact: true }),
  ).toBeDisabled();
  for (const surface of ["map", "journal"] as const) {
    await switchSurface(page, surface);
    await expect(page.locator(roots[surface])).toBeVisible();
    await expect(page.locator(`#compact-nav-${surface}`)).toHaveAttribute(
      "aria-controls",
      roots[surface].slice(1),
    );
  }
  await page.getByLabel("Меню сеанса", { exact: true }).click();
  await expect(
    page.getByText("Просмотр: Игрок preview", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Вернуться к мастеру", exact: true })
    .click();
  await assertSurface(page, "map", false);
  await expect(
    page.getByRole("button", { name: "Разделы", exact: true }),
  ).toBeEnabled();
  expect((await bootstrap(page)).me.role).toBe("GM");
});
