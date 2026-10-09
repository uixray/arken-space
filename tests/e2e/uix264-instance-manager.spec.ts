import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

const canonical = {
  id: "world-content-test-1",
  slug: "harbor",
  type: "LOCATION" as const,
  subtype: null,
  name: "Порт",
  aliases: [],
  summary: "",
  publicText: "",
  gmOnlyText: "",
  tags: [],
  coverAssetId: null,
  lifecycle: "PUBLISHED" as const,
  revision: 1,
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
};

for (const width of [390, 1280]) {
  test(`UIX-264 GM instance manager mocked CRUD and conflict at ${width}px`, async ({ page }) => {
    const snapshot = gmSnapshot({ schemaVersion: 2 });
    let instances: Array<Record<string, unknown>> = [];
    let id = 0;
    let conflictOnce = false;
    let failCreateOnce = true;
    const writes: string[] = [];
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${path}`);
      if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
      if (path === "/api/world-content") return route.fulfill({ json: [canonical] });
      if (path.endsWith("/relations") || path.endsWith("/media")) return route.fulfill({ json: [] });
      if (path === "/api/world-content-instances" && request.method() === "GET") {
        return route.fulfill({ json: instances.filter((item) => item.worldContentId === url.searchParams.get("worldContentId")) });
      }
      if (path === "/api/world-content-instances" && request.method() === "POST") {
        if (failCreateOnce) {
          failCreateOnce = false;
          return route.abort("failed");
        }
        const body = request.postDataJSON();
        const created = {
          id: `instance-${++id}`, campaignId: snapshot.campaign.id, worldContentId: body.worldContentId,
          displayNameOverride: body.displayNameOverride, currentState: body.currentState, gmNotes: body.gmNotes,
          portraitAssetId: null, ownerMembershipId: null, currentLocationId: null, quantity: null,
          condition: null, discovered: false, revision: 1, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
        };
        instances = [created, ...instances];
        return route.fulfill({ json: created });
      }
      if (path.startsWith("/api/world-content-instances/") && request.method() === "GET") {
        return route.fulfill({ json: instances.find((item) => item.id === path.split("/").at(-1)) ?? {}, status: 200 });
      }
      if (path.startsWith("/api/world-content-instances/") && request.method() === "PATCH") {
        if (!conflictOnce) {
          conflictOnce = true;
          return route.fulfill({ status: 409, json: { error: "WORLD_CONTENT_INSTANCE_CONFLICT" } });
        }
        const current = instances.find((item) => item.id === path.split("/").at(-1))!;
        const body = request.postDataJSON();
        const updated = { ...current, ...body, revision: Number(current.revision) + 1 };
        instances = instances.map((item) => item.id === updated.id ? updated : item);
        return route.fulfill({ json: updated });
      }
      if (path.endsWith("/api/operator/feedback/capability")) return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      if (path === "/api/client-logs") return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: [] });
    });
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await openWorkspaceSection(page, "Редактор мира");
    await page.getByRole("button", { name: "Порт" }).click();
    const panel = page.getByRole("region", { name: "Экземпляры в кампании" });
    await expect(panel.getByText("В этой кампании пока нет экземпляров этой сущности.")).toBeVisible();
    await panel.getByRole("button", { name: "Создать экземпляр" }).click();
    await panel.getByLabel("Имя в этой кампании").fill("Северный порт");
    await panel.getByLabel("Состояние").fill("Открыт");
    await panel.getByLabel("Заметки мастера").fill("Ключ у смотрителя");
    await panel.getByRole("button", { name: /^Создать$/ }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("Имя в этой кампании")).toBeDisabled();
    await expect(panel.getByRole("button", { name: "Создать экземпляр" })).toBeDisabled();
    await panel.getByRole("button", { name: "Повторить тот же запрос" }).click();
    await expect(panel.getByRole("button", { name: /Северный порт/ })).toBeVisible();
    await panel.getByRole("button", { name: "Изменить выбранный экземпляр" }).click();
    await panel.getByLabel("Заметки мастера").fill("Изменено мастером");
    await panel.getByRole("button", { name: /^Сохранить$/ }).click();
    await expect(panel.getByRole("alert")).toContainText("Актуальная версия");
    await expect(panel.getByLabel("Заметки мастера")).toHaveValue("Изменено мастером");
    await panel.getByRole("button", { name: /Сохранить черновик поверх ревизии/ }).click();
    await expect(panel.getByText("Изменения сохранены.")).toBeVisible();
    await panel.getByRole("button", { name: "Отмена" }).click();
    await panel.getByRole("button", { name: "Обновить список" }).click();
    await panel.getByRole("button", { name: "Изменить выбранный экземпляр" }).click();
    await expect(panel.getByLabel("Заметки мастера")).toHaveValue("Изменено мастером");
    expect(writes.filter((entry) => entry.includes("world-content-instances"))).toHaveLength(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("UIX-264 PLAYER bootstrap does not preload campaign instances", async ({ page }) => {
  const snapshot = gmSnapshot({ schemaVersion: 2 });
  snapshot.me.role = "PLAYER";
  const requested: string[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
    return route.fulfill({ json: [] });
  });
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByRole("button", { name: "Редактор мира", exact: true })).toHaveCount(0);
  expect(requested.some((path) => path.includes("world-content-instances"))).toBe(false);
  await expect(page.locator(".world-content-instances")).toHaveCount(0);
});
