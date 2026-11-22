import { expect, test } from "./react-console-guard";
import { fulfillUnmocked } from "./mock-api-contract";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const scenario of [
  {
    kind: "character-stat",
    changes: { before: { strength: 3 }, after: { strength: 4 } },
    preview: [/Сила\s*3 → 4/],
    button: "Подтвердить правку",
    receipt: "Правка сохранена",
    revision: 8,
  },
  {
    kind: "skill",
    changes: { before: {}, after: { name: "Янтарный шаг" }, creates: true },
    preview: ["Новая запись", "Янтарный шаг"],
    button: "Подтвердить создание",
    receipt: "Запись создана",
    revision: 0,
  },
  {
    kind: "bug-report",
    changes: {
      before: {},
      after: {
        title: "Карта не открывается",
        steps: "Нажать кнопку карты",
        expected: "Появилась карта",
        actual: "Кнопка осталась на месте",
      },
      creates: true,
    },
    preview: ["Шаги воспроизведения", "Нажать кнопку карты"],
    button: "Отправить баг-репорт",
    receipt: "Баг-репорт отправлен",
    revision: 0,
  },
])
  test(`Bionic ${scenario.kind} writes only on explicit approval`, async ({
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
        kind: scenario.kind,
        id: "38bdee5d-3b04-4ab1-a73e-968d2a6c438a",
      },
      expectedRevision: scenario.kind === "character-stat" ? 7 : 0,
      ...scenario.changes,
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
      if (pathname === "/api/bootstrap")
        return route.fulfill({ json: snapshot });
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
        return route.fulfill({
          json: { ...draft, committedRevision: scenario.revision },
        });
      }
      if (pathname === "/api/editor/history" && request.method() === "GET")
        return route.fulfill({
          json: [
            {
              ...draft,
              committedRevision: scenario.revision,
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
    for (const expected of scenario.preview)
      await expect(preview).toContainText(expected);
    expect(campaignSelections).toBe(1);
    expect(confirmations).toBe(0);
    await preview.getByRole("button", { name: scenario.button }).click();
    await expect(panel.getByRole("status")).toContainText(scenario.receipt);
    await expect(
      panel.getByRole("list", { name: "История правок" }),
    ).toContainText(`Версия ${scenario.revision}`);
    expect(confirmations).toBe(1);
  });
