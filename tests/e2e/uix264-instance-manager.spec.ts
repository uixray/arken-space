import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

const canonical = {
  id: "world-content-test-1",
  slug: "harbor",
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
  test(`UIX-264 GM instance manager mocked CRUD and conflict at ${width}px`, async ({
    page,
  }) => {
    const snapshot = gmSnapshot({ schemaVersion: 2 });
    const portraitA = "50000000-0000-4000-8000-000000000264";
    const portraitB = "50000000-0000-4000-8000-000000000265";
    const mapId = "60000000-0000-4000-8000-000000000264";
    const locationA = "70000000-0000-4000-8000-000000000264";
    const locationB = "70000000-0000-4000-8000-000000000265";
    snapshot.assets = [
      {
        id: portraitA,
        kind: "PORTRAIT",
        name: "Портрет A",
        mimeType: "image/gif",
        sizeBytes: 34,
        width: 1,
        height: 1,
        durationSeconds: null,
        url: `/api/assets/${portraitA}/content`,
        createdAt: new Date(0).toISOString(),
      },
      {
        id: portraitB,
        kind: "IMAGE",
        name: "Портрет B",
        mimeType: "image/gif",
        sizeBytes: 34,
        width: 1,
        height: 1,
        durationSeconds: null,
        url: `/api/assets/${portraitB}/content`,
        createdAt: new Date(0).toISOString(),
      },
    ];
    snapshot.worldMaps = {
      maps: [
        {
          id: mapId,
          name: "Береговая карта",
          scope: "REGION",
          visibility: "CAMPAIGN",
          lifecycle: "PUBLISHED",
          backgroundAssetId: null,
          revision: 1,
        },
      ],
      locations: [
        {
          id: locationA,
          mapId,
          name: "Старая пристань",
          kind: "LANDMARK",
          summary: "",
          visibility: "PUBLIC",
          x: 0.2,
          y: 0.3,
          revision: 1,
          sceneIds: [],
        },
      ],
      gmLocations: [
        {
          id: locationB,
          mapId,
          name: "Туманный маяк",
          kind: "LANDMARK",
          summary: "",
          visibility: "GM_ONLY",
          x: 0.6,
          y: 0.7,
          revision: 1,
          sceneIds: [],
          gmNotes: "",
        },
      ],
      partyPosition: null,
    };
    const otherMember = {
      ...snapshot.me,
      id: "00000000-0000-4000-8000-000000000264",
      displayName: "Другой игрок",
      role: "PLAYER" as const,
      characterId: null,
    };
    snapshot.members = [...snapshot.members, otherMember];
    let instances: Array<Record<string, unknown>> = [];
    let id = 0;
    let failConflictOnce = true;
    let failCreateOnce = true;
    const writes: string[] = [];
    const patchBodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (!["GET", "HEAD"].includes(request.method()))
        writes.push(`${request.method()} ${path}`);
      if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
      if (path === "/api/soundpad")
        return route.fulfill({
          json: { packs: [], playerPlaybackEnabled: true },
        });
      if (path.startsWith("/api/assets/") && path.endsWith("/content"))
        return route.fulfill({
          status: 200,
          contentType: "image/gif",
          body: Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64"),
        });
      if (path === "/api/world-content")
        return route.fulfill({ json: [canonical] });
      if (path.endsWith("/relations") || path.endsWith("/media"))
        return route.fulfill({ json: [] });
      if (
        path === "/api/world-content-instances" &&
        request.method() === "GET"
      ) {
        return route.fulfill({
          json: instances.filter(
            (item) =>
              item.worldContentId === url.searchParams.get("worldContentId"),
          ),
        });
      }
      if (
        path === "/api/world-content-instances" &&
        request.method() === "POST"
      ) {
        if (failCreateOnce) {
          failCreateOnce = false;
          return route.abort("failed");
        }
        const body = request.postDataJSON();
        const created = {
          id: `instance-${++id}`,
          campaignId: snapshot.campaign.id,
          worldContentId: body.worldContentId,
          displayNameOverride: body.displayNameOverride,
          currentState: body.currentState,
          gmNotes: body.gmNotes,
          portraitAssetId: body.portraitAssetId ?? null,
          ownerMembershipId: body.ownerMembershipId ?? null,
          currentLocationId: body.currentLocationId ?? null,
          condition: body.condition ?? null,
          quantity: body.quantity ?? null,
          discovered: false,
          revision: 1,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        };
        instances = [created, ...instances];
        return route.fulfill({ json: created });
      }
      if (
        path.startsWith("/api/world-content-instances/") &&
        request.method() === "GET"
      ) {
        return route.fulfill({
          json:
            instances.find((item) => item.id === path.split("/").at(-1)) ?? {},
          status: 200,
        });
      }
      if (
        path.startsWith("/api/world-content-instances/") &&
        request.method() === "PATCH"
      ) {
        const body = request.postDataJSON();
        patchBodies.push(body);
        if (body.gmNotes === "Изменено мастером" && failConflictOnce) {
          failConflictOnce = false;
          return route.fulfill({
            status: 409,
            json: { error: "WORLD_CONTENT_INSTANCE_CONFLICT" },
          });
        }
        const current = instances.find(
          (item) => item.id === path.split("/").at(-1),
        )!;
        const updated = {
          ...current,
          ...body,
          revision: Number(current.revision) + 1,
        };
        instances = instances.map((item) =>
          item.id === updated.id ? updated : item,
        );
        return route.fulfill({ json: updated });
      }
      if (path.endsWith("/api/operator/feedback/capability"))
        return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      if (path === "/api/client-logs")
        return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: [] });
    });
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await openWorkspaceSection(page, "Редактор мира");
    await page.getByRole("button", { name: "Порт" }).click();
    const panel = page.getByRole("region", { name: "Экземпляры в кампании" });
    await expect(
      panel.getByText("В этой кампании пока нет экземпляров этой сущности."),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Создать экземпляр" }).click();
    await panel.getByLabel("Имя в этой кампании").fill("Северный порт");
    await panel.getByLabel("Состояние", { exact: true }).fill("Открыт");
    await panel.getByLabel("Заметки мастера").fill("Ключ у смотрителя");
    await panel.getByLabel("Количество").fill("0");
    await panel.getByLabel("Состояние предмета").fill("Целое");
    await panel.getByRole("button", { name: "Портрет A" }).click();
    await panel.getByLabel("Текущее место на карте кампании").click();
    await page
      .getByRole("option", {
        name: "Береговая карта — Старая пристань",
      })
      .click();
    await panel.getByLabel("Владелец в этой кампании").click();
    await page
      .getByRole("option", {
        name: `${snapshot.me.displayName} (Мастер)`,
      })
      .click();
    await panel.getByRole("button", { name: /^Создать$/ }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("Имя в этой кампании")).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "Создать экземпляр" }),
    ).toBeDisabled();
    await panel
      .getByRole("button", { name: "Повторить тот же запрос" })
      .click();
    await expect(
      panel.getByRole("button", { name: /Северный порт/ }),
    ).toBeVisible();
    await expect(
      panel.getByRole("img", { name: "Портрет: Северный порт" }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Изменить выбранный экземпляр" })
      .click();
    await expect(panel.getByLabel("Количество")).toHaveValue("0");
    await expect(panel.getByLabel("Состояние предмета")).toHaveValue("Целое");
    await expect(panel.getByLabel("Владелец в этой кампании")).toContainText(
      snapshot.me.displayName,
    );
    await expect(panel.getByLabel("Портрет экземпляра")).toBeVisible();
    await expect(
      panel.getByLabel("Текущее место на карте кампании"),
    ).toContainText("Старая пристань");
    await panel.getByLabel("Владелец в этой кампании").click();
    await page.getByRole("option", { name: "Другой игрок (Игрок)" }).click();
    await panel.getByRole("button", { name: "Портрет B" }).click();
    await panel.getByLabel("Текущее место на карте кампании").click();
    await page
      .getByRole("option", {
        name: "Береговая карта — Туманный маяк",
      })
      .click();
    await panel.getByRole("button", { name: /^Сохранить$/ }).click();
    await expect(panel.getByText("Изменения сохранены.")).toBeVisible();
    await panel.getByRole("button", { name: "Отмена" }).click();
    await panel.getByRole("button", { name: "Обновить список" }).click();
    await expect(
      panel.getByRole("button", { name: /владелец: Другой игрок/ }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", {
        name: /место: Береговая карта — Туманный маяк/,
      }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Изменить выбранный экземпляр" })
      .click();
    await expect(panel.getByLabel("Владелец в этой кампании")).toContainText(
      "Другой игрок",
    );
    await panel.getByLabel("Владелец в этой кампании").click();
    await page.getByRole("option", { name: "Не назначен" }).click();
    await panel.getByRole("button", { name: "Без портрета" }).click();
    await panel.getByLabel("Текущее место на карте кампании").click();
    await page.getByRole("option", { name: "Не указано" }).click();
    await panel.getByRole("button", { name: /^Сохранить$/ }).click();
    await expect(panel.getByText("Изменения сохранены.")).toBeVisible();
    await panel.getByRole("button", { name: "Отмена" }).click();
    await panel.getByRole("button", { name: "Обновить список" }).click();
    await panel
      .getByRole("button", { name: "Изменить выбранный экземпляр" })
      .click();
    await expect(panel.getByLabel("Владелец в этой кампании")).toContainText(
      "Не назначен",
    );
    await expect(
      panel.getByRole("combobox", {
        name: "Текущее место на карте кампании",
      }),
    ).toContainText("Не указано");
    expect(patchBodies[0]).toMatchObject({
      ownerMembershipId: otherMember.id,
      portraitAssetId: portraitB,
      currentLocationId: locationB,
    });
    expect(patchBodies[1]).toMatchObject({
      ownerMembershipId: null,
      portraitAssetId: null,
      currentLocationId: null,
    });
    await panel.getByLabel("Состояние предмета").fill("Поцарапано");
    await panel.getByRole("button", { name: /^Сохранить$/ }).click();
    await expect(panel.getByText("Изменения сохранены.")).toBeVisible();
    await panel.getByRole("button", { name: "Отмена" }).click();
    await panel.getByRole("button", { name: "Обновить список" }).click();
    await panel
      .getByRole("button", { name: "Изменить выбранный экземпляр" })
      .click();
    await expect(panel.getByLabel("Количество")).toHaveValue("0");
    await expect(panel.getByLabel("Состояние предмета")).toHaveValue(
      "Поцарапано",
    );
    await panel.getByLabel("Количество").fill("");
    await panel.getByLabel("Состояние предмета").fill("");
    await panel.getByRole("button", { name: /^Сохранить$/ }).click();
    await expect(panel.getByText("Изменения сохранены.")).toBeVisible();
    await panel.getByRole("button", { name: "Отмена" }).click();
    await panel.getByRole("button", { name: "Обновить список" }).click();
    await panel
      .getByRole("button", { name: "Изменить выбранный экземпляр" })
      .click();
    await expect(panel.getByLabel("Количество")).toHaveValue("");
    await expect(panel.getByLabel("Состояние предмета")).toHaveValue("");
    await panel.getByLabel("Количество").fill("-1");
    await expect(
      panel.getByRole("button", { name: /^Сохранить$/ }),
    ).toBeDisabled();
    await panel.getByLabel("Количество").fill("");
    await panel.getByLabel("Заметки мастера").fill("Изменено мастером");
    await panel.getByRole("button", { name: /^Сохранить$/ }).click();
    await expect(panel.getByRole("alert")).toContainText("Актуальная версия");
    await expect(panel.getByLabel("Заметки мастера")).toHaveValue(
      "Изменено мастером",
    );
    await panel
      .getByRole("button", { name: /Сохранить черновик поверх ревизии/ })
      .click();
    await expect(panel.getByText("Изменения сохранены.")).toBeVisible();
    await panel.getByRole("button", { name: "Отмена" }).click();
    await panel.getByRole("button", { name: "Обновить список" }).click();
    await panel
      .getByRole("button", { name: "Изменить выбранный экземпляр" })
      .click();
    await expect(panel.getByLabel("Заметки мастера")).toHaveValue(
      "Изменено мастером",
    );
    expect(
      writes.filter((entry) => entry.includes("world-content-instances")),
    ).toHaveLength(8);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

test("UIX-264 PLAYER bootstrap does not preload campaign instances", async ({
  page,
}) => {
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
  await expect(
    page.getByRole("button", { name: "Редактор мира", exact: true }),
  ).toHaveCount(0);
  expect(
    requested.some((path) => path.includes("world-content-instances")),
  ).toBe(false);
  await expect(page.locator(".world-content-instances")).toHaveCount(0);
});
