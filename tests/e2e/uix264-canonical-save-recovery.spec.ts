import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

const entityId = "26400000-0000-4000-8000-000000000001";
const otherId = "26400000-0000-4000-8000-000000000002";
const entity = (overrides: Record<string, unknown> = {}) => ({
  id: entityId,
  slug: "silver-coast",
  type: "LOCATION",
  subtype: "Port",
  name: "Silver Coast",
  aliases: ["The Coast"],
  summary: "Original summary",
  publicText: "Public v1",
  gmOnlyText: "GM v1",
  tags: ["coast"],
  coverAssetId: null,
  provenance: {
    sourceUrl: null,
    sourceExternalId: null,
    retrievedAt: null,
    rawContentHash: null,
    attribution: null,
    rightsReviewStatus: null,
    editorialApprovalStatus: null,
  },
  lifecycle: "DRAFT",
  revision: 4,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

for (const width of [390, 1280]) {
  test(`UIX-245 canonical save recovery uses explicit compare/reapply at ${width}px (mocked API)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const snapshot = gmSnapshot({ schemaVersion: 2 });
    let patchCount = 0;
    const patchBodies: Record<string, unknown>[] = [];
    await page.route("**/api/bootstrap", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(snapshot),
      }),
    );
    await page.route("**/api/player-access", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    await page.route("**/api/world-content**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/world-content-instances") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        });
        return;
      }
      if (
        url.pathname.endsWith("/relations") ||
        url.pathname.endsWith("/media")
      ) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        });
        return;
      }
      if (request.method() === "PATCH") {
        patchCount += 1;
        patchBodies.push(request.postDataJSON() as Record<string, unknown>);
        if (patchCount === 1) {
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: "WORLD_CONTENT_CONFLICT",
              message: "Conflict",
            }),
          });
          return;
        }
        const latestRequest = patchBodies.at(-1)!;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            entity({
              ...latestRequest,
              revision: 6,
              summary: "Concurrent summary",
              gmOnlyText: "Concurrent GM text",
            }),
          ),
        });
        return;
      }
      if (url.pathname === `/api/world-content/${entityId}`) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            entity({
              revision: 5,
              summary: "Concurrent summary",
              gmOnlyText: "Concurrent GM text",
            }),
          ),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          entity(),
          entity({ id: otherId, slug: "other-port", name: "Other Port" }),
        ]),
      });
    });

    await page.goto("/");
    await openWorkspaceSection(page, "Редактор мира");
    const workspace = page.getByRole("dialog", { name: "Редактор мира" });
    await workspace.getByRole("button", { name: /Silver Coast/ }).click();
    await workspace.getByLabel("Название").fill("Local title");
    await workspace.getByRole("button", { name: "Сохранить" }).click();
    const conflict = workspace.getByRole("region", {
      name: "Сверка конфликта версии",
    });
    await expect(conflict).toBeVisible();
    await expect(workspace.getByLabel("Название")).toHaveValue("Local title");
    await expect(conflict).toContainText("На сервере: Silver Coast");
    await conflict
      .getByRole("button", {
        name: "Перенести мои изменения на версию 5 и сохранить",
      })
      .click();
    await expect(workspace.getByText("Сохранено.")).toBeVisible();
    expect(patchCount).toBe(2);
    expect(patchBodies[0]).toMatchObject({ revision: 4, name: "Local title" });
    expect(patchBodies[1]).toMatchObject({ revision: 5, name: "Local title" });
    expect(patchBodies[1]).not.toHaveProperty("summary");
    expect(patchBodies[1].actionId).not.toBe(patchBodies[0].actionId);

    await workspace.getByLabel("Название").fill("Uncommitted title");
    await workspace.getByRole("button", { name: /Other Port/ }).click();
    const leavePrompt = page.getByRole("dialog", {
      name: "Покинуть редактор?",
    });
    await expect(leavePrompt).toBeVisible();
    await leavePrompt.getByRole("button", { name: "Остаться" }).click();
    await expect(workspace.getByLabel("Название")).toHaveValue(
      "Uncommitted title",
    );
  });
}
