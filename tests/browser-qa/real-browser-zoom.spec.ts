import { chromium, expect, test } from "@playwright/test";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "../e2e/workspace-nav-helper";

for (const role of ["GM", "PLAYER"] as const) {
  for (const windowWidth of [1600, 1280]) {
    test(`UIX-644 true browser zoom ${role} window ${windowWidth}`, async ({
      baseURL,
    }, testInfo) => {
      const context = await chromium.launchPersistentContext(
        testInfo.outputPath("isolated-profile"),
        {
          channel: "chrome",
          headless: true,
          viewport: null,
          args: [`--window-size=${windowWidth},900`],
        },
      );
      const settings = await context.newPage();
      const page = await context.newPage();
      const errors: string[] = [];
      const mutations: string[] = [];
      const receipts: unknown[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const setZoom = (factor: number) =>
        settings.evaluate((zoom) => {
          const browser = (
            globalThis as unknown as {
              chrome: {
                settingsPrivate: {
                  setDefaultZoom: (factor: number, done: () => void) => void;
                };
                runtime: { lastError?: { message: string } };
              };
            }
          ).chrome;
          return new Promise<void>((resolve, reject) =>
            browser.settingsPrivate.setDefaultZoom(zoom, () =>
              browser.runtime.lastError
                ? reject(new Error(browser.runtime.lastError.message))
                : resolve(),
            ),
          );
        }, factor);
      try {
        await settings.goto("chrome://settings/appearance");
        await setZoom(1);
        const snapshot = buildGameSnapshot(role, { schemaVersion: 2 });
        const assetId = "1acf0201-1111-4111-8111-111111111111";
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
            id: "1acf0202-1111-4111-8111-111111111111",
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
        await page.route("**/api/**", (route) => {
          const request = route.request();
          const path = new URL(request.url()).pathname;
          if (path === "/api/client-logs")
            return route.fulfill({ json: { ok: true } });
          if (request.method() !== "GET") {
            mutations.push(`${request.method()} ${path}`);
            return route.fulfill({
              status: 405,
              json: { error: "READ_ONLY_FIXTURE" },
            });
          }
          if (path.endsWith("/content"))
            return route.fulfill({
              contentType: "image/svg+xml",
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#637d72"/></svg>',
            });
          return route.fulfill({
            json:
              path === "/api/bootstrap"
                ? snapshot
                : path === "/api/story/posts"
                  ? { posts: [], nextCursor: null }
                  : [],
          });
        });
        await page.goto(baseURL!);
        await openWorkspaceSection(page, "Токены");
        const workspace = page.getByRole("dialog", {
          name: "Токены",
          exact: true,
        });
        const trigger = workspace.getByRole("combobox", {
          name: "Изображение токена Страж",
        });
        const popup = page.locator(".arken-form-select-popup");
        const metrics = () =>
          page.evaluate(() => ({
            width: innerWidth,
            dpr: devicePixelRatio,
            visualScale: visualViewport!.scale,
            cssZoom: getComputedStyle(document.documentElement).zoom,
          }));
        const baseline = await metrics();
        for (const factor of [1, 1.25, 1.5, 1]) {
          await trigger.click();
          await expect(popup).toBeVisible();
          await setZoom(factor);
          await expect
            .poll(async () => (await metrics()).dpr / baseline.dpr)
            .toBeCloseTo(factor, 2);
          const current = await metrics();
          expect(
            Math.abs(current.width - baseline.width / factor),
          ).toBeLessThanOrEqual(2);
          expect(current.visualScale).toBe(1);
          expect(current.cssZoom).toBe("1");
          await expect(workspace).toBeVisible();
          await expect(trigger).toContainText("Портрет стража");
          // A layout-mode switch may safely dismiss an overlay. Record it rather
          // than claim that it stayed open; reopening must still work.
          const retainedOpen = await popup.isVisible();
          if (!retainedOpen) await trigger.click();
          const option = popup.getByRole("option", {
            name: "Портрет стража",
            exact: true,
          });
          receipts.push({
            phase: "before-hit",
            factor,
            current,
            retainedOpen,
            trigger: await trigger.boundingBox(),
            popup: await popup.boundingBox(),
            option: await option.boundingBox(),
            workspace: await workspace.boundingBox(),
          });
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
          await trigger.click();
          await page.keyboard.press("Escape");
          await expect(popup).toBeHidden();
          await expect(trigger).toBeFocused();
          await expect(workspace).toBeVisible();
          receipts.push({ factor, current, retainedOpen });
        }
        expect(await metrics()).toEqual(baseline);
        expect(errors).toEqual([]);
        expect(mutations).toEqual([]);
      } finally {
        await testInfo.attach("true-browser-zoom", {
          body: JSON.stringify({
            role,
            windowWidth,
            receipts,
            errors,
            mutations,
          }),
          contentType: "application/json",
        });
        await page
          .screenshot({ path: testInfo.outputPath("final.png") })
          .catch(() => {});
        await setZoom(1).catch(() => {});
        await context.close();
      }
    });
  }
}
