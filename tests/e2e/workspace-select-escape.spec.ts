import type { Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

async function install(
  page: Page,
  role: "GM" | "PLAYER",
  withCharacter = false,
  withSetup = false,
) {
  const snapshot = buildGameSnapshot(role, { schemaVersion: 2 });
  if (withCharacter)
    snapshot.characters = [
      {
        id: "1acf0103-1111-4111-8111-111111111111",
        name: "Страж образец",
        ownerMembershipId: null,
        controllerMembershipIds: [],
        portraitAssetId: null,
        lifecycle: "ACTIVE",
        archivedAt: null,
        archivedByMembershipId: null,
        stats: {},
        skills: [],
        spells: [],
        notes: "",
        backstory: "",
        inventory: [],
        resources: {},
        wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
        entries: [],
        revision: 1,
      },
    ];
  if (withSetup) {
    snapshot.members.push({
      id: "1acf0104-1111-4111-8111-111111111111",
      role: "PLAYER",
      displayName: "Игрок для проверки",
      characterId: null,
    });
    snapshot.characters.push({
      ...snapshot.characters[0]!,
      id: "1acf0105-1111-4111-8111-111111111111",
      name: "Маг образец",
    });
  }
  const assetId = "1acf0101-1111-4111-8111-111111111111";
  snapshot.assets = [
    {
      id: assetId,
      kind: "TOKEN",
      name: "Портрет стража",
      mimeType: "image/svg+xml",
      sizeBytes: 128,
      width: 64,
      height: 64,
      durationSeconds: null,
      url: `/api/assets/${assetId}/content`,
      createdAt: new Date(0).toISOString(),
    },
  ];
  snapshot.tokenDefinitions = [
    {
      id: "1acf0102-1111-4111-8111-111111111111",
      characterId: null,
      defaultAssetId: assetId,
      name: "Страж",
      ownName: "Страж",
      defaultWidth: 1,
      defaultHeight: 1,
      controllerMembershipIds: [snapshot.me.id],
      revision: 1,
    },
  ];
  const mutations: string[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${path}`);
      return route.fulfill({
        status: 405,
        json: { error: "READ_ONLY_FIXTURE" },
      });
    }
    if (path.endsWith("/content")) {
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#637d72"/></svg>',
      });
    }
    return route.fulfill({
      json:
        path === "/api/bootstrap"
          ? snapshot
          : path === "/api/story/posts"
            ? { posts: [], nextCursor: null }
            : [],
    });
  });
  return mutations;
}

for (const role of ["GM", "PLAYER"] as const) {
  for (const width of [1280, 390]) {
    test(`UIX-644 ${role} ${width}: first Escape belongs to outer token image select`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const mutations = await install(page, role);
      await page.goto("/");
      await openWorkspaceSection(page, "Токены");
      const workspace = page.getByRole("dialog", {
        name: "Токены",
        exact: true,
      });
      const trigger = workspace.getByRole("combobox", {
        name: "Изображение токена Страж",
      });
      const menu = page.locator(".arken-form-select-popup");
      await expect(trigger).toContainText("Портрет стража");
      await trigger.click();
      await expect(menu).toBeVisible();
      const option = menu.getByRole("option", {
        name: "Без изображения",
        exact: true,
      });
      await expect
        .poll(() =>
          option.evaluate((element) => {
            const r = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(
                r.left + r.width / 2,
                r.top + r.height / 2,
              ),
            );
          }),
        )
        .toBe(true);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(workspace).toBeVisible();
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toContainText("Портрет стража");
      expect(mutations).toEqual([]);

      // A closed Select must not swallow the workspace's own Escape action.
      await page.keyboard.press("Escape");
      await expect(workspace).toBeHidden();
      expect(mutations).toEqual([]);
    });
  }
}

for (const width of [1280, 360]) {
  test(`UIX-644 character template modal lifecycle ${width}`, async ({
    page,
  }, testInfo) => {
    const mutations = await install(page, "GM", true);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await openWorkspaceSection(page, "Персонажи");
    const create = page.getByRole("button", {
      name: "Создать персонажа",
      exact: true,
    });
    await create.click();
    const dialog = page.getByRole("dialog", {
      name: "Новый персонаж",
      exact: true,
    });
    const name = dialog.getByRole("textbox", { name: "Имя персонажа" });
    await name.fill("Новый страж");
    const trigger = dialog.getByRole("combobox", { name: /Шаблон/ });
    const popup = page.locator(".arken-form-select-popup");
    await trigger.click();
    const template = popup.getByRole("option", {
      name: "На основе «Страж образец»",
      exact: true,
    });
    await expect(template).toBeVisible();
    await expect
      .poll(() =>
        template.evaluate((element) => {
          const r = element.getBoundingClientRect();
          return (
            r.left >= 0 &&
            r.right <= innerWidth &&
            r.top >= 0 &&
            r.bottom <= innerHeight &&
            element.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            )
          );
        }),
      )
      .toBe(true);
    await template.click();
    await expect(trigger).toContainText("На основе «Страж образец»");
    await expect(popup).toBeHidden();
    await trigger.click();
    await page.setViewportSize({
      width: width === 360 ? 390 : 1180,
      height: 640,
    });
    await expect(template).toBeVisible();
    await template.click();
    await expect(name).toHaveValue("Новый страж");
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(dialog).toBeVisible();
    await expect(trigger).toContainText("На основе «Страж образец»");
    await trigger.press("ArrowDown");
    await expect(popup).toBeVisible();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(trigger).toContainText("Без шаблона (пустой лист)");
    await expect(popup).toBeHidden();
    await trigger.click();
    await dialog.getByText("Новый персонаж", { exact: true }).click();
    await expect(popup).toBeHidden();
    await expect(dialog).toBeVisible();
    await trigger.focus();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(create).toBeVisible();
    await create.click();
    await expect(name).toHaveValue("");
    await expect(trigger).toContainText("Без шаблона (пустой лист)");
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await testInfo.attach("character-template-lifecycle", {
      body: JSON.stringify({ width, mutations, errors }),
      contentType: "application/json",
    });
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const width of [1280, 360]) {
  test(`UIX-644 setup select registry ${width}`, async ({ page }, testInfo) => {
    const mutations = await install(page, "GM", true, true);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await openWorkspaceSection(page, "Подготовка");
    const popup = page.locator(".arken-form-select-popup");
    const tabs = page.getByRole("navigation", { name: "Разделы подготовки" });
    async function expectHiddenSectionsInert() {
      expect(
        await page.locator(".subsection[hidden]").evaluateAll((sections) => {
          if (!sections.length) return false;
          const before = document.activeElement;
          return sections.every((section) => {
            if (section.getClientRects().length) return false;
            return [
              ...section.querySelectorAll<HTMLElement>(
                "button, input, select, textarea, [tabindex]",
              ),
            ].every((control) => {
              control.focus();
              return document.activeElement === before;
            });
          });
        }),
      ).toBe(true);
    }
    await expectHiddenSectionsInert();
    const receipts: string[] = [];
    for (const [label, selected] of [
      ["Игрок", "Игрок для проверки"],
      ["Персонаж для токена", "Маг образец"],
      ["Персонаж", "Маг образец"],
    ]) {
      if (label === "Персонаж для токена")
        await tabs
          .getByRole("button", { name: "Персонажи и доступ", exact: true })
          .click();
      const trigger = page.getByRole("combobox", { name: label, exact: true });
      await trigger.click();
      const option = popup.getByRole("option", { name: selected, exact: true });
      await expect
        .poll(() =>
          option.evaluate((element) => {
            const r = element.getBoundingClientRect();
            return (
              r.left >= 0 &&
              r.right <= innerWidth &&
              r.top >= 0 &&
              r.bottom <= innerHeight &&
              element.contains(
                document.elementFromPoint(
                  r.x + r.width / 2,
                  r.y + r.height / 2,
                ),
              )
            );
          }),
        )
        .toBe(true);
      await option.click();
      await expect(popup).toBeHidden();
      await expect(trigger).toContainText(selected!);
      await trigger.click();
      await page.keyboard.press("Escape");
      await expect(popup).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.press("ArrowDown");
      await expect(popup).toBeVisible();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await expect(trigger).toContainText(selected!);
      await expect(popup).toBeHidden();
      receipts.push(label!);
    }
    const invite = page.getByRole("combobox", {
      name: "Персонаж",
      exact: true,
    });
    await invite.click();
    await page.setViewportSize({
      width: width === 360 ? 390 : 1180,
      height: 640,
    });
    await popup
      .getByRole("option", { name: "Маг образец", exact: true })
      .click();
    await expect(invite).toContainText("Маг образец");
    await invite.click();
    await tabs.getByRole("button", { name: "Обзор", exact: true }).click();
    await expect(popup).toBeHidden();
    await expect(invite).toBeHidden();
    await expectHiddenSectionsInert();
    await expect(
      page.getByRole("combobox", { name: "Игрок", exact: true }),
    ).toContainText("Игрок для проверки");
    await tabs
      .getByRole("button", { name: "Персонажи и доступ", exact: true })
      .click();
    await expect(invite).toContainText("Маг образец");
    await expect(
      page.getByRole("combobox", { name: "Персонаж для токена", exact: true }),
    ).toContainText("Маг образец");
    await testInfo.attach("setup-select-registry", {
      body: JSON.stringify({ width, receipts, mutations, errors }),
      contentType: "application/json",
    });
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  });
}
