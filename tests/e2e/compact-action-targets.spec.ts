import type { Locator } from "@playwright/test";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { expect, test } from "./react-console-guard";

for (const role of ["GM", "PLAYER"] as const)
  for (const { width, height } of [
    { width: 360, height: 850 },
    { width: 360, height: 640 },
    { width: 640, height: 360 },
  ]) {
    test(`UIX-624 compact action targets ${role} ${width}x${height}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height });
      const snapshot = buildGameSnapshot(role);
      snapshot.scenes = [
        {
          id: "64500000-0000-4000-8000-000000000001",
          name: "Проверка меню",
          projection: "ORTHOGRAPHIC_2D",
          mapAssetId: null,
          width: 1600,
          height: 1000,
          backgroundFrame: { x: 0, y: 0, width: 1600, height: 1000 },
          grid: {
            enabled: true,
            size: 64,
            offsetX: 0,
            offsetY: 0,
            color: "#c8b78b",
            opacity: 0.22,
          },
          active: true,
        },
      ];
      const mutations: string[] = [];
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== "GET" && path !== "/api/client-logs") {
          mutations.push(`${route.request().method()} ${path}`);
          return route.fulfill({
            status: 405,
            json: { error: "READ_ONLY_FIXTURE" },
          });
        }
        if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
        if (path === "/api/story/posts")
          return route.fulfill({ json: { posts: [], nextCursor: null } });
        if (path === "/api/operator/feedback/capability")
          return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
        return route.fulfill({ json: [] });
      });
      await page.routeWebSocket(/\/socket\.io\//, (socket) => {
        socket.onMessage((message) => {
          if (message.toString() === "40")
            socket.send('40{"sid":"icons-socket"}');
        });
        socket.send(
          '0{"sid":"icons-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
        );
      });
      await page.goto("/");
      await expect(page.locator(".map-viewport")).toBeVisible();
      const failures: object[] = [];
      const measurements: object[] = [];
      const assertVisibleInputTargets = async (
        owner: Locator,
        surface: string,
      ) => {
        const inputs = owner.locator("input:visible:not(:disabled)");
        for (const input of await inputs.all()) {
          const type = (await input.getAttribute("type")) ?? "text";
          const labelledTarget = input.locator("xpath=ancestor::label[1]");
          const mayUseLabel =
            (type === "checkbox" || type === "range") &&
            (await input.evaluate(
              (node) =>
                node instanceof HTMLInputElement &&
                node.closest("label")?.control === node,
            ));
          const target = mayUseLabel ? labelledTarget : input;
          await target.scrollIntoViewIfNeeded();
          const measurement = await target.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return {
              label:
                node.getAttribute("aria-label") ||
                node.textContent?.trim() ||
                node.getAttribute("type"),
              className: node.className,
              width: box.width,
              height: box.height,
              hit: node.contains(
                document.elementFromPoint(
                  box.x + box.width / 2,
                  box.y + box.height / 2,
                ),
              ),
            };
          });
          measurements.push({ surface, inputType: type, ...measurement });
          // Collect the whole connected flyout pool before failing, just like
          // the button audit below. One run should reveal every small target,
          // not stop at the first number input and hide the remaining owners.
          if (
            measurement.width < 44 ||
            measurement.height < 44 ||
            !measurement.hit
          )
            failures.push({ surface, inputType: type, ...measurement });
          if (!measurement.hit) continue;

          if (mayUseLabel) {
            const checkedBefore = await input.isChecked().catch(() => null);
            const valueBefore = await input.inputValue();
            await target.click();
            await expect(input).toBeFocused();
            if (type === "checkbox") {
              expect(await input.isChecked()).toBe(!checkedBefore);
              await target.click();
              expect(await input.isChecked()).toBe(checkedBefore);
            } else if ((await input.inputValue()) !== valueBefore) {
              const { min, step } = await input.evaluate((node) => {
                if (!(node instanceof HTMLInputElement))
                  throw new Error("Expected range input");
                return {
                  min: Number(node.min || 0),
                  step: Number(node.step || 1),
                };
              });
              const presses = Math.round((Number(valueBefore) - min) / step);
              expect(presses).toBeGreaterThanOrEqual(0);
              expect(presses).toBeLessThanOrEqual(100);
              await input.press("Home");
              for (let i = 0; i < presses; i++) await input.press("ArrowRight");
              expect(Number(await input.inputValue())).toBeCloseTo(
                Number(valueBefore),
                5,
              );
            }
          }
        }
      };
      for (const surface of ["map", "journal"] as const) {
        await page.locator(`#compact-nav-${surface}`).click();
        await expect(page.locator(`#compact-nav-${surface}`)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        const controls = page.locator(
          "button:visible, summary:visible, [role=tab]:visible",
        );
        for (const control of await controls.all()) {
          if (await control.isDisabled()) continue;
          await control.scrollIntoViewIfNeeded();
          const measurement = await control.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return {
              label:
                node.getAttribute("aria-label") ||
                node.getAttribute("title") ||
                node.textContent?.trim(),
              className: node.className,
              width: box.width,
              height: box.height,
              hit: node.contains(
                document.elementFromPoint(
                  box.x + box.width / 2,
                  box.y + box.height / 2,
                ),
              ),
            };
          });
          measurements.push({ surface, ...measurement });
          if (
            measurement.width < 44 ||
            measurement.height < 44 ||
            !measurement.hit
          )
            failures.push({ surface, ...measurement });
        }
      }
      await page.locator("#compact-nav-map").click();
      if (role === "GM") {
        for (const selector of [".grid-settings", ".resize-settings"]) {
          const owner = page.locator(`.map-toolbar ${selector}`);
          const trigger = owner.locator("summary");
          await trigger.click();
          const control = owner
            .locator(
              selector === ".resize-settings"
                ? "button:visible:not(:disabled)"
                : "input:visible:not(:disabled)",
            )
            .first();
          await expect(control).toBeVisible();
          await assertVisibleInputTargets(owner, selector);
          await control.scrollIntoViewIfNeeded();
          await expect
            .poll(() =>
              control.evaluate((node) => {
                const r = node.getBoundingClientRect();
                return node.contains(
                  document.elementFromPoint(
                    r.x + r.width / 2,
                    r.y + r.height / 2,
                  ),
                );
              }),
            )
            .toBe(true);
          await control.focus();
          await page.keyboard.press("Escape");
          await expect(control).toBeHidden();
          await expect(trigger).toBeFocused();
          // Switching by keyboard does not emit the outside pointerdown that
          // dismisses a native details menu. Hiding its owner must still close it.
          await trigger.press("Enter");
          await expect(owner).toHaveAttribute("open", "");
          const journalNav = page.locator("#compact-nav-journal");
          await journalNav.focus();
          await journalNav.press("Enter");
          await expect(journalNav).toHaveAttribute("aria-pressed", "true");
          await expect(owner).toBeHidden();
          await expect(owner).not.toHaveAttribute("open", "");
          await expect
            .poll(() =>
              page.evaluate(() =>
                Boolean(
                  document.activeElement?.closest("#activity-sidebar") &&
                  !document.activeElement?.closest("[hidden], [inert]"),
                ),
              ),
            )
            .toBe(true);
          const mapNav = page.locator("#compact-nav-map");
          await mapNav.focus();
          await mapNav.press("Enter");
          await expect(mapNav).toHaveAttribute("aria-pressed", "true");
          await expect
            .poll(() =>
              page.evaluate(() =>
                Boolean(
                  document.activeElement?.closest("#main-content") &&
                  !document.activeElement?.closest("[hidden], [inert]"),
                ),
              ),
            )
            .toBe(true);
          await expect(owner).not.toHaveAttribute("open", "");
        }
        const more = page.locator(".toolbar-overflow summary");
        await more.click();
        const moreAction = page
          .locator(".toolbar-overflow-menu input:visible")
          .first();
        await expect(moreAction).toBeVisible();
        await assertVisibleInputTargets(
          page.locator(".toolbar-overflow-menu"),
          ".toolbar-overflow-menu",
        );
        await moreAction.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            moreAction.evaluate((node) => {
              const b = node.getBoundingClientRect();
              return node.contains(
                document.elementFromPoint(
                  b.x + b.width / 2,
                  b.y + b.height / 2,
                ),
              );
            }),
          )
          .toBe(true);
        await moreAction.focus();
        await page.keyboard.press("Escape");
        await expect(moreAction).toBeHidden();
        await expect(more).toBeFocused();
      }
      await page.screenshot({
        path: testInfo.outputPath(`compact-map-${width}x${height}.png`),
      });
      await testInfo.attach("compact-action-targets", {
        body: JSON.stringify({ role, width, measurements, failures }, null, 2),
        contentType: "application/json",
      });
      expect(failures).toEqual([]);
      expect(mutations).toEqual([]);
    });
  }
