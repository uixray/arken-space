import type { WorldContentInstanceDto } from "@arken/contracts";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";

const canonical = {
  id: "world-content-delete-test",
  slug: "harbor-instance-delete",
  type: "ITEM" as const,
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
  test(`UIX-264 confirmed campaign-instance delete preserves canon/sibling ${width}px (mock API)`, async ({ page }) => {
    const snapshot = gmSnapshot({ schemaVersion: 2 });
    const instance = (id: string, displayNameOverride: string): WorldContentInstanceDto => ({
      id,
      campaignId: snapshot.campaign.id,
      worldContentId: canonical.id,
      displayNameOverride,
      currentState: null,
      gmNotes: null,
      portraitAssetId: null,
      ownerMembershipId: null,
      currentLocationId: null,
      quantity: null,
      condition: null,
      discovered: false,
      revision: 7,
      createdAt: "2026-10-09T00:00:00.000Z",
      updatedAt: "2026-10-09T00:00:00.000Z",
    });
    const target = instance("instance-to-delete", "Пост охраны");
    const sibling = instance("instance-to-keep", "Соседний пост");
    let rows = [target, sibling];
    const deleteBodies: Array<{ actionId: string; revision: number }> = [];
    const canonReads: string[] = [];

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const { pathname, searchParams } = new URL(request.url());
      if (pathname === "/api/bootstrap") return route.fulfill({ json: snapshot });
      if (pathname === "/api/soundpad")
        return route.fulfill({ json: { packs: [], playerPlaybackEnabled: true } });
      if (pathname === "/api/client-logs") return route.fulfill({ json: { ok: true } });
      if (pathname === "/api/world-content" && request.method() === "GET") {
        canonReads.push("GET canonical");
        return route.fulfill({ json: [canonical] });
      }
      if (pathname.endsWith("/relations") || pathname.endsWith("/media"))
        return route.fulfill({ json: [] });
      if (pathname === "/api/world-content-instances" && request.method() === "GET")
        return route.fulfill({ json: rows.filter((row) => row.worldContentId === searchParams.get("worldContentId")) });
      if (pathname === `/api/world-content-instances/${target.id}` && request.method() === "DELETE") {
        const body = request.postDataJSON() as { actionId: string; revision: number };
        deleteBodies.push(body);
        expect(body).toMatchObject({ actionId: expect.any(String), revision: target.revision });
        rows = rows.filter((row) => row.id !== target.id);
        return route.fulfill({ status: 204, body: "" });
      }
      return route.fulfill({ json: [] });
    });

    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await openWorkspaceSection(page, "Редактор мира");
    await page.getByRole("button", { name: "Порт" }).click();
    const panel = page.getByRole("region", { name: "Экземпляры в кампании" });
    await expect(panel.getByRole("button", { name: /Пост охраны/ })).toBeVisible();

    const trigger = panel.getByRole("button", { name: "Удалить экземпляр…" });
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Удаление экземпляра" });
    await expect(dialog).toContainText("«Пост охраны»");
    await expect(dialog).toContainText("Каноническая сущность и другие экземпляры не изменятся.");
    await expect(dialog.getByRole("button", { name: "Удалить экземпляр" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(deleteBodies).toHaveLength(0);

    await trigger.press("Enter");
    const confirm = dialog.getByRole("button", { name: "Удалить экземпляр" });
    await confirm.focus();
    await page.keyboard.press("Enter");
    await expect(panel.getByRole("button", { name: /Соседний пост/ })).toBeVisible();
    await expect(panel.getByText("Экземпляр удалён из этой кампании.")).toBeVisible();
    await expect(panel.getByRole("button", { name: /Пост охраны/ })).toHaveCount(0);
    expect(deleteBodies).toHaveLength(1);
    expect(canonReads.length).toBeGreaterThan(0);

    await page.reload();
    await openWorkspaceSection(page, "Редактор мира");
    await page.getByRole("button", { name: "Порт" }).click();
    const reloadedPanel = page.getByRole("region", { name: "Экземпляры в кампании" });
    await expect(reloadedPanel.getByRole("button", { name: /Соседний пост/ })).toBeVisible();
    await expect(reloadedPanel.getByRole("button", { name: /Пост охраны/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Порт", exact: true })).toBeVisible();
    expect(rows.map((row) => row.id)).toEqual([sibling.id]);
    expect(rows[0]!.worldContentId).toBe(canonical.id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
