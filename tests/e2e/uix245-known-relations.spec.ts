import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";

const subjectId = "24500000-0000-4000-8000-000000000001";
const linkedId = "24500000-0000-4000-8000-000000000002";
const published = (id: string, name: string) => ({
  id,
  slug: name.toLowerCase().replaceAll(" ", "-"),
  type: "PERSON",
  subtype: null,
  name,
  aliases: [],
  summary: `${name} summary`,
  publicText: `${name} article`,
  tags: ["ally"],
  coverAssetId: null,
});

for (const width of [390, 1280]) {
  test(`UIX-245 mounted safe-projection relation filter and reset at ${width}px (mock API)`, async ({
    page,
  }) => {
    const snapshot = gmSnapshot({ schemaVersion: 2 });
    const subject = published(subjectId, "Known Subject");
    const linked = published(linkedId, "Visible Friend");
    const listQueries: URLSearchParams[] = [];

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const { pathname, searchParams } = new URL(request.url());
      if (pathname === "/api/bootstrap")
        return route.fulfill({ json: snapshot });
      if (pathname === "/api/soundpad")
        return route.fulfill({
          json: { packs: [], playerPlaybackEnabled: true },
        });
      if (pathname === "/api/world-content" && request.method() === "GET") {
        listQueries.push(searchParams);
        const relatedTo = searchParams.get("relatedTo");
        return route.fulfill({
          json: relatedTo === subjectId ? [linked] : [subject, linked],
        });
      }
      if (pathname === `/api/world-content/${subjectId}`)
        return route.fulfill({ json: subject });
      if (pathname === `/api/world-content/${linkedId}`)
        return route.fulfill({ json: linked });
      if (pathname === `/api/world-content/${subjectId}/relations`)
        return route.fulfill({
          json: [
            {
              id: "edge-1",
              relationType: "ALLY",
              note: null,
              direction: "OUTGOING",
              entity: {
                id: linkedId,
                slug: "visible-friend",
                type: "PERSON",
                name: "Visible Friend",
              },
            },
          ],
        });
      if (pathname.endsWith("/media") || pathname.endsWith("/relations"))
        return route.fulfill({ json: [] });
      if (pathname === "/api/client-logs")
        return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: [] });
    });

    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await openWorkspaceSection(page, "Справочник мира");
    const subjectRow = page.locator(".world-encyclopedia-workspace__row", {
      hasText: "Known Subject",
    });
    await expect(subjectRow).toBeVisible();
    await subjectRow.click();
    await expect(
      page.getByRole("heading", { name: "Known Subject" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Показать связанные статьи" })
      .click();
    await expect(
      page.locator(".world-encyclopedia-workspace__relation-filter"),
    ).toContainText("Связано с: Known Subject");
    await expect(
      page.locator(".world-encyclopedia-workspace__row", {
        hasText: "Visible Friend",
      }),
    ).toBeVisible();
    expect(listQueries.at(-1)?.get("relatedTo")).toBe(subjectId);

    const search = page.getByRole("textbox", { name: "Поиск" });
    await search.fill("Visible");
    await search.press("Enter");
    await expect.poll(() => listQueries.at(-1)?.get("q")).toBe("Visible");
    expect(listQueries.at(-1)?.get("relatedTo")).toBe(subjectId);
    await page.getByRole("button", { name: "Сбросить связь" }).click();
    await expect(
      page.locator(".world-encyclopedia-workspace__relation-filter"),
    ).toHaveCount(0);
    expect(listQueries.at(-1)?.get("q")).toBe("Visible");
    expect(listQueries.at(-1)?.has("relatedTo")).toBe(false);

    // This file intentionally uses routed synthetic responses; it is not a live API/privacy persistence test.
  });
}
