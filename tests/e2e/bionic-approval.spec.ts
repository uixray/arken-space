import { expect, test } from "./react-console-guard";
import { fulfillUnmocked } from "./mock-api-contract";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

test("UIX-798 opens an exact campaign draft and writes only on explicit approval", async ({
  page,
}) => {
  const campaignId = "eb6a55c4-a821-4739-8d4a-a1028e9d9092";
  const draftId = "8fde32df-8ec4-4a67-a436-57b6d34bd2b8";
  const fixture = buildGameSnapshot("GM");
  const snapshot = {
    ...fixture,
    campaign: { ...fixture.campaign, id: campaignId },
  };
  const draft = {
    id: draftId,
    target: {
      campaignId,
      kind: "character-stat",
      id: "38bdee5d-3b04-4ab1-a73e-968d2a6c438a",
    },
    expectedRevision: 7,
    before: { strength: 3 },
    after: { strength: 4 },
  };
  let confirmations = 0;
  let campaignSelections = 0;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/account/capabilities")
      return route.fulfill({
        json: { accountAuthEnabled: true, campaignLinkAccessEnabled: false },
      });
    if (pathname === "/api/account/session")
      return route.fulfill({
        json: {
          authenticated: true,
          account: {
            identityKind: "HOSTED",
            login: "amberion",
            passwordChangeRequired: false,
          },
          csrfToken: "test-csrf",
        },
      });
    if (pathname === "/api/account/campaigns/select") {
      expect(request.postDataJSON()).toEqual({ campaignId });
      campaignSelections++;
      return route.fulfill({ json: { selected: true, campaignId } });
    }
    if (pathname === "/api/bootstrap") return route.fulfill({ json: snapshot });
    if (pathname === "/api/soundpad")
      return route.fulfill({
        json: { packs: [], playerPlaybackEnabled: true },
      });
    if (pathname === "/api/client-logs")
      return route.fulfill({ status: 204, body: "" });
    if (
      pathname === `/api/editor/changes/${draftId}` &&
      request.method() === "GET"
    )
      return route.fulfill({ json: draft });
    if (
      pathname === `/api/editor/changes/${draftId}/confirm` &&
      request.method() === "POST"
    ) {
      expect(request.headers()["x-arken-campaign-id"]).toBe(campaignId);
      expect(request.headers()["x-arken-editor-confirm"]).toBe("explicit");
      confirmations++;
      return route.fulfill({ json: { ...draft, committedRevision: 8 } });
    }
    if (pathname === "/api/editor/history" && request.method() === "GET")
      return route.fulfill({
        json: [
          {
            ...draft,
            committedRevision: 8,
            confirmedAt: "2026-11-21T12:00:00Z",
          },
        ],
      });
    return fulfillUnmocked(route, pathname);
  });
  await page.goto(`/campaign/${campaignId}?editor-pilot=${draftId}`);
  const panel = page.getByRole("region", {
    name: "Редактор Bionic",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Предпросмотр", exact: true })
    .click();
  const preview = panel.getByRole("region", { name: "Предпросмотр правки" });
  await expect(preview).toContainText("Было: 3");
  await expect(preview).toContainText("Стало: 4");
  expect(campaignSelections).toBe(1);
  expect(confirmations).toBe(0);
  await preview.getByRole("button", { name: "Подтвердить правку" }).click();
  await expect(panel.getByRole("status")).toHaveText("Правка сохранена");
  await expect(
    panel.getByRole("list", { name: "История правок" }),
  ).toContainText("Версия 8");
  expect(confirmations).toBe(1);
});
