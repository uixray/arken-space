import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { stickerPack } from "../../apps/web/src/test-support/sticker-fixtures";

async function install(page: Page, role: "GM" | "PLAYER") {
  const snapshot = buildGameSnapshot(role, { schemaVersion: 2 });
  const catalog = [stickerPack(36)];
  const reads = { story: 0 };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/story/posts") {
      reads.story += 1;
      // App consumes a paginated envelope here, not the generic list fallback.
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    }
    if (path.endsWith("/content")) {
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#5e8d78"/></svg>',
      });
    }
    return route.fulfill({
      json:
        path === "/api/bootstrap"
          ? snapshot
          : path === "/api/stickers"
            ? catalog
            : [],
    });
  });
  return reads;
}

async function hitTarget(target: Locator) {
  await expect(target).toBeVisible();
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return Boolean(hit && element.contains(hit));
      }),
    )
    .toBe(true);
}

async function fitsViewport(panel: Locator) {
  await expect
    .poll(() =>
      panel.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        return (
          box.width > 0 &&
          box.height > 0 &&
          box.left >= left - 1 &&
          box.top >= top - 1 &&
          box.right <= left + (viewport?.width ?? innerWidth) + 1 &&
          box.bottom <= top + (viewport?.height ?? innerHeight) + 1
        );
      }),
    )
    .toBe(true);
}

// Real app UI + synthetic read-only routes. These test picker layout/lifecycle,
// not server authorization, OS keyboard, physical touch or actual browser zoom.
for (const role of ["GM", "PLAYER"] as const) {
  for (const width of [1280, 390]) {
    test(`UIX644_STICKER_LIFECYCLE: ${role} ${width} search escape outside pointer scroll resize and owner`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const reads = await install(page, role);
      await page.goto("/");
      await expect.poll(() => reads.story).toBeGreaterThan(0);
      if (width === 390) await page.locator("#compact-nav-journal").click();
      await page.locator("#chat-tab-activity").click();
      const trigger = page.locator(".chat-compose .sticker-picker > button");
      const panel = page.getByRole("dialog", { name: "Выбор стикера" });
      const search = panel.getByRole("searchbox");
      const first = panel.getByRole("option", {
        name: "Стикер 1",
        exact: true,
      });

      await trigger.click();
      await expect(search).toBeFocused();
      await expect(trigger).toHaveAttribute(
        "aria-controls",
        (await panel.getAttribute("id")) as string,
      );
      await fitsViewport(panel);
      await hitTarget(first);
      await search.press("Escape");
      await expect(panel).toBeHidden();
      await expect(trigger).toBeFocused();

      await trigger.press("Enter");
      await first.focus();
      await first.press("ArrowRight");
      await expect(
        panel.getByRole("option", { name: "Стикер 2", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(trigger).toBeFocused();

      await trigger.click();
      const composer = page.getByRole("textbox", {
        name: "Сообщение или бросок",
        exact: true,
      });
      await composer.click();
      await expect(panel).toBeHidden();
      // Outside dismissal must not steal focus back from the clicked control.
      await expect(composer).toBeFocused();

      await trigger.click();
      await search.fill("Стикер");
      await expect(panel.getByRole("option")).toHaveCount(36);
      await expect
        .poll(() =>
          panel.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        )
        .toBe(true);
      const last = panel.getByRole("option", {
        name: "Стикер 36",
        exact: true,
      });
      await last.scrollIntoViewIfNeeded();
      await hitTarget(last);
      await search.scrollIntoViewIfNeeded();
      await search.focus();
      await page.setViewportSize({ width: 360, height: 480 });
      await expect(panel).toBeVisible();
      await expect(search).toHaveValue("Стикер");
      await fitsViewport(panel);
      await hitTarget(search);

      await page.locator("#compact-nav-map").click();
      await expect(panel).toBeHidden();
      await expect(page.locator(".sticker-picker-panel")).toHaveCount(0);
      await expect(page.locator("#activity-sidebar")).toHaveAttribute("hidden");
      await page.locator("#compact-nav-journal").click();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await trigger.click();
      await expect(search).toBeFocused();
      await expect(panel).toBeVisible();
    });
  }
}
