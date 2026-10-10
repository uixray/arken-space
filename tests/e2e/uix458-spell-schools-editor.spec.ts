import { expect, test } from "./react-console-guard";
import type { SpellProgressionGraph } from "@arken/contracts";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const width of [390, 1280]) {
  test(`UIX-458 GM creates, reloads and edits a spell draft at ${width}px (mock API)`, async ({
    page,
  }) => {
    const snapshot = gmSnapshot({ schemaVersion: 2 });
    const versions: SpellProgressionGraph[] = [];
    const writes: string[] = [];
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (request.method() !== "GET")
        writes.push(`${request.method()} ${pathname}`);
      if (pathname === "/api/bootstrap")
        return route.fulfill({ json: snapshot });
      if (pathname === "/api/soundpad")
        return route.fulfill({
          json: { packs: [], playerPlaybackEnabled: true },
        });
      if (pathname === "/api/spell-packs" && request.method() === "GET")
        return route.fulfill({
          json: {
            packs: versions.length
              ? [
                  {
                    id: versions.at(-1)!.packId,
                    latestVersionId: versions.at(-1)!.versionId,
                    latestVersion: versions.at(-1)!.version,
                    lifecycle: versions.at(-1)!.lifecycle,
                    title: versions.at(-1)!.title,
                    createdAt: "2026-10-09T00:00:00.000Z",
                  },
                ]
              : [],
          },
        });
      if (pathname === "/api/spell-packs/validate")
        return route.fulfill({
          json: { valid: true, errors: [], warnings: [] },
        });
      if (pathname === "/api/spell-packs" && request.method() === "POST") {
        const body = request.postDataJSON() as { graph: SpellProgressionGraph };
        versions.push(body.graph);
        return route.fulfill({
          status: 201,
          json: {
            packId: body.graph.packId,
            versionId: body.graph.versionId,
            version: body.graph.version,
            lifecycle: body.graph.lifecycle,
            graph: body.graph,
            warnings: [],
            createdAt: "2026-10-09T00:00:00.000Z",
          },
        });
      }
      const appendPath = pathname.match(
        /^\/api\/spell-packs\/([^/]+)\/versions$/,
      );
      if (appendPath && request.method() === "POST") {
        const body = request.postDataJSON() as {
          graph: SpellProgressionGraph;
          expectedVersion: number;
        };
        expect(body.expectedVersion).toBe(versions.at(-1)?.version);
        versions.push(body.graph);
        return route.fulfill({
          status: 201,
          json: {
            packId: body.graph.packId,
            versionId: body.graph.versionId,
            version: body.graph.version,
            lifecycle: body.graph.lifecycle,
            graph: body.graph,
            warnings: [],
            createdAt: "2026-10-09T00:00:00.000Z",
          },
        });
      }
      const versionPath = pathname.match(
        /^\/api\/spell-packs\/([^/]+)\/versions\/([^/]+)$/,
      );
      if (versionPath && request.method() === "GET") {
        const graph = versions.find(
          (version) => version.versionId === versionPath[2],
        );
        return graph
          ? route.fulfill({
              json: {
                packId: graph.packId,
                versionId: graph.versionId,
                version: graph.version,
                lifecycle: graph.lifecycle,
                graph,
                warnings: [],
                createdAt: "2026-10-09T00:00:00.000Z",
              },
            })
          : route.fulfill({
              status: 404,
              json: { error: "SPELL_PACK_VERSION_NOT_FOUND" },
            });
      }
      if (versionPath && request.method() === "POST") {
        const body = request.postDataJSON() as {
          graph: SpellProgressionGraph;
          expectedVersion: number;
        };
        expect(body.expectedVersion).toBe(versions.at(-1)?.version);
        versions.push(body.graph);
        return route.fulfill({
          status: 201,
          json: {
            packId: body.graph.packId,
            versionId: body.graph.versionId,
            version: body.graph.version,
            lifecycle: body.graph.lifecycle,
            graph: body.graph,
            warnings: [],
            createdAt: "2026-10-09T00:00:00.000Z",
          },
        });
      }
      if (pathname === "/api/client-logs")
        return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: [] });
    });

    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await openWorkspaceSection(page, "Школы заклинаний");
    await expect(
      page.getByRole("heading", { name: "Школы и ветки заклинаний" }),
    ).toBeVisible();
    await page.getByLabel("Название набора").fill("Черновик испытания");
    await page.getByLabel("Название первой школы").fill("Искры");
    await page.getByRole("button", { name: "Создать черновик школы" }).click();
    await expect(
      page.getByRole("button", { name: "Добавить узел" }),
    ).toBeVisible();
    await page.getByLabel("Новый узел").fill("Свет");
    await page.getByRole("button", { name: "Добавить узел" }).click();
    await page.getByLabel("Новый узел").fill("Проблеск");
    await page.getByRole("button", { name: "Добавить узел" }).click();
    await page
      .getByLabel("Целевой узел группы")
      .selectOption({ label: "Проблеск" });
    await page.getByRole("button", { name: "Добавить группу" }).click();
    await page.getByLabel("Требуемый узел").selectOption({ label: "Свет" });
    await page
      .getByLabel("Группа назначения")
      .selectOption({ label: "Проблеск · ALL" });
    await page.getByRole("button", { name: "Добавить связь" }).click();
    const schoolDescription = page
      .locator(".spell-school-card")
      .first()
      .getByLabel("Описание")
      .first();
    await expect(schoolDescription).toBeVisible();
    await schoolDescription.fill("Описательный текст школы");
    await page
      .getByRole("button", { name: "Проверить и сохранить черновик" })
      .click();
    await expect(
      page.locator(".spell-schools-message.is-success"),
    ).toContainText("Сохранена версия 1");
    await expect.poll(() => versions).toHaveLength(1);

    await page.getByRole("button", { name: /Черновик испытания/ }).click();
    await expect(page.getByLabel("Новый узел")).toHaveValue("");
    await page
      .locator(".spell-school-card")
      .first()
      .getByLabel("Описание")
      .first()
      .fill("Описание после повторной загрузки");
    await page.getByLabel("Новая школа").fill("Вторая школа");
    await page.getByRole("button", { name: "Добавить школу" }).click();
    await page.getByLabel("Новый узел").nth(1).fill("Независимый узел");
    await page.getByRole("button", { name: "Добавить узел" }).nth(1).click();
    await page
      .getByRole("button", { name: "Проверить и сохранить новую версию" })
      .click();
    await expect(
      page.locator(".spell-schools-message.is-success"),
    ).toContainText("Сохранена версия 2");
    await expect.poll(() => versions).toHaveLength(2);
    expect(versions[0]!.schools).toHaveLength(1);
    expect(versions[0]!.nodes).toHaveLength(2);
    expect(versions[0]!.edges).toHaveLength(1);
    expect(versions[1]!.schools).toHaveLength(2);
    expect(versions[1]!.nodes).toHaveLength(3);
    expect(versions[1]!.edges).toHaveLength(1);
    expect(writes.filter((path) => path.includes("spell-packs"))).toHaveLength(
      4,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);

    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
  });
}

test("UIX-458 PLAYER cannot open or preload the GM spell-school editor", async ({
  page,
}) => {
  const snapshot = gmSnapshot({ schemaVersion: 2 });
  snapshot.me.role = "PLAYER";
  const requested: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
    if (path === "/api/soundpad")
      return route.fulfill({
        json: { packs: [], playerPlaybackEnabled: true },
      });
    if (path === "/api/client-logs")
      return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: [] });
  });
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Школы заклинаний", exact: true }),
  ).toHaveCount(0);
  expect(
    requested.some(
      (path) =>
        path === "/api/spell-packs" || path.startsWith("/api/spell-packs/"),
    ),
  ).toBe(false);
  await expect(page.locator(".spell-schools-workspace")).toHaveCount(0);
});

test("UIX-458 ambiguous save keeps the actual workspace open until exact retry succeeds", async ({
  page,
}) => {
  const snapshot = gmSnapshot({ schemaVersion: 2 });
  const attempts: Array<{ actionId: string; graph: SpellProgressionGraph }> = [];
  let releaseFirstSave!: () => void;
  const firstSaveGate = new Promise<void>((resolve) => {
    releaseFirstSave = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/bootstrap")
      return route.fulfill({ json: snapshot });
    if (pathname === "/api/soundpad")
      return route.fulfill({
        json: { packs: [], playerPlaybackEnabled: true },
      });
    if (pathname === "/api/spell-packs" && request.method() === "GET")
      return route.fulfill({ json: { packs: [] } });
    if (pathname === "/api/spell-packs/validate")
      return route.fulfill({
        json: { valid: true, errors: [], warnings: [] },
      });
    if (pathname === "/api/spell-packs" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        actionId: string;
        graph: SpellProgressionGraph;
      };
      attempts.push(body);
      if (attempts.length === 1) {
        await firstSaveGate;
        return route.fulfill({
          status: 503,
          json: { error: "temporary transport uncertainty" },
        });
      }
      expect(body).toEqual(attempts[0]);
      return route.fulfill({
        status: 201,
        json: {
          packId: body.graph.packId,
          versionId: body.graph.versionId,
          version: body.graph.version,
          lifecycle: body.graph.lifecycle,
          graph: body.graph,
          warnings: [],
          createdAt: "2026-10-09T00:00:00.000Z",
        },
      });
    }
    if (pathname === "/api/client-logs")
      return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: [] });
  });

  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await openWorkspaceSection(page, "Школы заклинаний");
  const dialog = page.getByRole("dialog", { name: "Школы заклинаний" });
  await page.getByLabel("Название набора").fill("Неподтверждённый набор");
  await page.getByLabel("Название первой школы").fill("Искры");
  await page.getByRole("button", { name: "Создать черновик школы" }).click();
  await page.getByLabel("Новый узел").fill("Свет");
  await page.getByRole("button", { name: "Добавить узел" }).click();
  await page.getByRole("button", { name: "Проверить и сохранить черновик" }).click();
  await expect(page.getByRole("button", { name: "Проверка…" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(dialog).toBeVisible();
  releaseFirstSave();
  await expect(page.locator(".spell-schools-message.is-error")).toContainText(
    "Не удалось выполнить запрос",
  );
  await expect(
    page.getByRole("button", { name: "Повторить тот же запрос" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();

  await page.getByRole("button", { name: "Повторить тот же запрос" }).click();
  await expect(page.locator(".spell-schools-message.is-success")).toContainText(
    "Сохранена версия 1",
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.getByRole("button", { name: "Закрыть", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
