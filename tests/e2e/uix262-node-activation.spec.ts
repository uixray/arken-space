import { expect, test } from "./react-console-guard";
import type { SpellProgressionGraph } from "../../packages/contracts/src/spell-schools";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const width of [390, 1280]) test(`UIX-262 activation edits round-trip in mock GM browser at ${width}px`, async ({ page }) => {
  const snapshot = gmSnapshot({ schemaVersion: 2 });
  const versions: SpellProgressionGraph[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
    if (path === "/api/soundpad") return route.fulfill({ json: { packs: [], playerPlaybackEnabled: true } });
    if (path === "/api/spell-packs" && request.method() === "GET") return route.fulfill({ json: { packs: versions.length ? [{ id: versions.at(-1)!.packId, latestVersionId: versions.at(-1)!.versionId, latestVersion: versions.at(-1)!.version, lifecycle: "DRAFT", title: versions.at(-1)!.title, createdAt: "2026-10-09T00:00:00.000Z" }] : [] } });
    if (path === "/api/spell-packs/validate") return route.fulfill({ json: { valid: true, errors: [], warnings: [] } });
    if (path === "/api/spell-packs" && request.method() === "POST") {
      const graph = (request.postDataJSON() as { graph: SpellProgressionGraph }).graph; versions.push(graph);
      return route.fulfill({ status: 201, json: { packId: graph.packId, versionId: graph.versionId, version: graph.version, lifecycle: graph.lifecycle, graph, warnings: [], createdAt: "2026-10-09T00:00:00.000Z" } });
    }
    const versionParts = path.split("/");
    if (versionParts.length === 5 && versionParts[1] === "api" && versionParts[2] === "spell-packs" && versionParts[4] === "versions" && request.method() === "POST") {
      const graph = (request.postDataJSON() as { graph: SpellProgressionGraph }).graph;
      versions.push(graph);
      return route.fulfill({ status: 201, json: { packId: graph.packId, versionId: graph.versionId, version: graph.version, lifecycle: graph.lifecycle, graph, warnings: [], createdAt: "2026-10-09T00:00:00.000Z" } });
    }
    const versionId = versionParts.at(-1);
    if (versionParts.length === 6 && versionParts[1] === "api" && versionParts[2] === "spell-packs" && versionParts[4] === "versions" && request.method() === "GET") {
      const graph = versions.find((item) => item.versionId === versionId);
      if (graph) return route.fulfill({ json: { packId: graph.packId, versionId: graph.versionId, version: graph.version, lifecycle: graph.lifecycle, graph, warnings: [], createdAt: "2026-10-09T00:00:00.000Z" } });
    }
    if (path === "/api/client-logs") return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: [] });
  });
  await page.setViewportSize({ width, height: 850 }); await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible(); await openWorkspaceSection(page, "Школы заклинаний");
  await page.getByLabel("Название набора").fill("Activation QA"); await page.getByLabel("Название первой школы").fill("Искры"); await page.getByRole("button", { name: "Создать черновик школы" }).click();
  await page.getByLabel("Новый узел").fill("Узел A"); await page.getByRole("button", { name: "Добавить узел" }).click();
  const card = page.locator(".spell-node-card").first();
  await card.getByLabel("Пассивная способность").focus();
  await page.keyboard.press("Space");
  await card.getByRole("button", { name: /Добавить условие/ }).click();
  await card.getByLabel("Тип активации 1").selectOption("OTHER");
  await page.getByRole("button", { name: "Проверить и сохранить черновик" }).click();
  await expect(card.getByRole("alert")).toContainText("Для типа «Другое»");
  expect(versions).toHaveLength(0);
  await card.getByLabel("Текст источника 1").fill("При наступлении особого условия");
  await page.getByRole("button", { name: "Проверить и сохранить черновик" }).click();
  await expect(page.locator(".spell-schools-message.is-success")).toContainText("Сохранена версия 1");
  expect(versions).toHaveLength(1);
  expect(versions[0]!.nodes[0]!.activation).toEqual({ passive: false, triggers: [{ kind: "OTHER", rawText: "При наступлении особого условия" }] });
  await page.getByRole("button", { name: /Activation QA/ }).click();
  await expect(card.getByLabel("Пассивная способность")).not.toBeChecked();
  await expect(card.getByLabel("Тип активации 1")).toHaveValue("OTHER");
  await expect(card.getByLabel("Текст источника 1")).toHaveValue("При наступлении особого условия");
  await card.getByLabel("Название условия 1").fill("Обновлённое условие");
  await page.getByRole("button", { name: "Проверить и сохранить новую версию" }).click();
  await expect(page.locator(".spell-schools-message.is-success")).toContainText("Сохранена версия 2");
  expect(versions).toHaveLength(2);
  expect(versions[0]!.nodes[0]!.activation.triggers[0]!.rawText).toBe("При наступлении особого условия");
  expect(versions[0]!.nodes[0]!.activation.triggers[0]!.label).toBeUndefined();
  expect(versions[1]!.nodes[0]!.activation.triggers[0]!.label).toBe("Обновлённое условие");
  await expect(page.evaluate(() => document.documentElement.scrollWidth)).resolves.toBeLessThanOrEqual(width);
  await page.keyboard.press("Tab"); await expect(page.locator(":focus")).toBeVisible();
});

test("UIX-262 PLAYER does not receive activation editor or draft fetch", async ({ page }) => {
  const snapshot = gmSnapshot({ schemaVersion: 2 }); snapshot.me.role = "PLAYER"; const requested: string[] = [];
  await page.route("**/api/**", async (route) => { const path = new URL(route.request().url()).pathname; requested.push(path); if (path === "/api/bootstrap") return route.fulfill({ json: snapshot }); if (path === "/api/soundpad") return route.fulfill({ json: { packs: [], playerPlaybackEnabled: true } }); if (path === "/api/client-logs") return route.fulfill({ json: { ok: true } }); return route.fulfill({ json: [] }); });
  await page.setViewportSize({ width: 390, height: 850 }); await page.goto("/"); await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByRole("button", { name: "Школы заклинаний", exact: true })).toHaveCount(0);
  expect(requested.some((path) => path === "/api/spell-packs" || path.startsWith("/api/spell-packs/"))).toBe(false);
  await expect(page.locator(".spell-activation-editor")).toHaveCount(0);
});
