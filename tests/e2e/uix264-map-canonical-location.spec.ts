import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

const mapId = "11111111-1111-4111-8111-111111111111";
const nodeId = "22222222-2222-4222-8222-222222222222";
const canonicalId = "33333333-3333-4333-8333-333333333333";

for (const width of [390, 1280]) {
  test(`UIX-264 canonical location picker saves an explicit node reference at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    const snapshot = gmSnapshot({ schemaVersion: 2 });
    snapshot.worldMaps = {
      maps: [
        {
          id: mapId,
          name: "Карта кампании",
          scope: "REGION",
          visibility: "CAMPAIGN",
          lifecycle: "DRAFT",
          backgroundAssetId: null,
          revision: 0,
        },
      ],
      locations: [
        {
          id: nodeId,
          mapId,
          canonicalLocationId: null,
          name: "Местная пристань",
          kind: "LANDMARK",
          summary: "Подпись узла",
          visibility: "PUBLIC",
          x: 0.3,
          y: 0.4,
          revision: 0,
          sceneIds: [],
        },
      ],
      gmLocations: [
        {
          id: nodeId,
          mapId,
          canonicalLocationId: null,
          name: "Местная пристань",
          kind: "LANDMARK",
          summary: "Подпись узла",
          visibility: "PUBLIC",
          x: 0.3,
          y: 0.4,
          revision: 0,
          sceneIds: [],
          gmNotes: "",
        },
      ],
      partyPosition: null,
    };
    let patchBody: Record<string, unknown> | null = null;
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
    await page.route("**/api/world-content?type=LOCATION", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: canonicalId, name: "Канонический маяк" }]),
      }),
    );
    await page.route(`**/api/world-maps/locations/${nodeId}`, async (route) => {
      patchBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...snapshot.worldMaps!.locations[0],
          canonicalLocationId: canonicalId,
          revision: 1,
        }),
      });
    });
    await page.goto("/");
    await openWorkspaceSection(page, "Карты мира");
    const workspace = page.getByRole("dialog", { name: "Карты мира" });
    await workspace.getByRole("button", { name: "Редактировать" }).click();
    const editor = page.getByRole("dialog", { name: "Локация" });
    await editor
      .getByRole("combobox", { name: "Каноническая локация" })
      .selectOption(canonicalId);
    await editor.getByRole("button", { name: "Сохранить" }).click();
    await expect.poll(() => patchBody?.canonicalLocationId).toBe(canonicalId);
    expect(patchBody).toMatchObject({ canonicalLocationId: canonicalId });
    expect(snapshot.worldMaps.locations[0]).toMatchObject({
      name: "Местная пристань",
      summary: "Подпись узла",
    });
  });
}
