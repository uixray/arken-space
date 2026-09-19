import {
  paintedIconContrast,
  settleIconState,
} from "./helpers/painted-icon-contrast";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { PLAYER_THEMES } from "../../apps/web/src/design-system/player-themes";

for (const themeId of ["system", ...PLAYER_THEMES.map(({ id }) => id)])
  for (const role of ["GM", "PLAYER"] as const)
    for (const width of [1280, 390]) {
      test(`UIX-645 shell SVG contract ${role} ${width}${themeId === "system" ? "" : ` theme:${themeId}`}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 850 });
        const errors: string[] = [];
        const writes: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const snapshot = buildGameSnapshot(role);
        snapshot.personalTheme = {
          scopeKey: snapshot.me.id,
          selectedThemeId: themeId,
          defaultThemeId: "forest",
          revision: 0,
          publishedThemes: [...PLAYER_THEMES],
        };
        snapshot.scenes = [
          {
            id: "64500000-0000-4000-8000-000000000001",
            name: "Проверка иконок",
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
        await page.route("**/api/**", (route) => {
          const request = route.request();
          const path = new URL(request.url()).pathname;
          if (request.method() !== "GET") {
            writes.push(`${request.method()} ${path}`);
            return route.fulfill({
              status: 405,
              json: { error: "READ_ONLY_FIXTURE" },
            });
          }
          if (path === "/api/bootstrap")
            return route.fulfill({ json: snapshot });
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
        if (themeId === "system") {
          await expect(page.locator("html")).not.toHaveAttribute(
            "data-player-theme",
          );
        } else {
          await expect(page.locator("html")).toHaveAttribute(
            "data-player-theme",
            themeId,
          );
        }
        const icons = page.locator("svg.arken-icon:visible");
        expect(await icons.count()).toBeGreaterThan(5);
        for (const icon of await icons.all()) {
          await expect(icon).toHaveAttribute("aria-hidden", "true");
          await expect(icon).toHaveAttribute("focusable", "false");
          await expect(icon).toHaveAttribute("stroke", "currentColor");
          await expect(icon).toHaveAttribute("stroke-width", "2");
          const box = await icon.boundingBox();
          expect(box!.width).toBeGreaterThan(0);
          expect(box!.height).toBeGreaterThan(0);
        }
        const controls = page
          .locator("button:visible,summary:visible")
          .filter({ has: page.locator("svg.arken-icon") });
        for (const control of await controls.all()) {
          await expect(control).toHaveAccessibleName(/\S/);
          const box = await control.boundingBox();
          expect(box!.width).toBeGreaterThanOrEqual(24);
          expect(box!.height).toBeGreaterThanOrEqual(24);
        }
        const contrastStates: {
          label: string;
          normal: number;
          hover: number;
        }[] = [];
        const disabledControls: object[] = [];
        for (const control of await controls.all()) {
          const label = await control.evaluate(
            (el) =>
              el.getAttribute("aria-label") ??
              el.getAttribute("title") ??
              el.textContent?.trim() ??
              "",
          );
          if (!(await control.isEnabled())) {
            await expect(control).toHaveJSProperty("disabled", true);
            await control.scrollIntoViewIfNeeded();
            const paint = () =>
              control.evaluate((node) => {
                const style = getComputedStyle(node);
                const icon = node.querySelector("svg.arken-icon");
                if (!icon) throw new Error("Disabled icon missing");
                const svg = getComputedStyle(icon);
                const backing = getComputedStyle(node, "::before");
                return {
                  color: style.color,
                  background: style.backgroundColor,
                  border: style.borderColor,
                  opacity: style.opacity,
                  stroke: svg.stroke,
                  iconOpacity: svg.opacity,
                  backing: backing.backgroundColor,
                  backingOpacity: backing.opacity,
                };
              });
            await page.mouse.move(width - 1, 849);
            await settleIconState(control);
            const normal = await paint();
            const box = await control.boundingBox();
            if (!box) throw new Error(`${label}: missing disabled hit area`);
            expect(
              await control.evaluate((node) => {
                const box = node.getBoundingClientRect();
                return node.contains(
                  document.elementFromPoint(
                    box.x + box.width / 2,
                    box.y + box.height / 2,
                  ),
                );
              }),
              `${label}: disabled control is not obscured`,
            ).toBe(true);
            // Native disabled buttons cannot be clicked through locator.click.
            // Use a real pointer at their visible center, never force/dispatchEvent.
            await page.mouse.move(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            await settleIconState(control);
            const hovered = await paint();
            expect(
              hovered,
              `${label}: disabled hover must not advertise activation`,
            ).toEqual(normal);
            await page.mouse.click(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            await expect(control).not.toBeFocused();
            await expect(control).toBeDisabled();
            disabledControls.push({ label, normal, hovered, box });
            continue; // Inactive controls have no contrast minimum; do not invent a contrast PASS.
          }
          for (const icon of await control
            .locator("svg.arken-icon:visible")
            .all()) {
            await page.mouse.move(width - 1, 849);
            await settleIconState(control);
            expect(
              await control.evaluate((el) => el.matches(":hover")),
              `${label}: normal state`,
            ).toBe(false);
            const normal = await paintedIconContrast(icon);
            expect(
              normal,
              `${label}: settled normal icon contrast`,
            ).toBeGreaterThanOrEqual(3);
            await control.hover();
            await settleIconState(control);
            expect(await control.evaluate((el) => el.matches(":hover"))).toBe(
              true,
            );
            const hover = await paintedIconContrast(icon);
            expect(
              hover,
              `${label}: settled hover icon contrast`,
            ).toBeGreaterThanOrEqual(3);
            contrastStates.push({ label, normal, hover });
          }
        }
        await page.mouse.move(width - 1, 849);
        // Disabled pointer clicks can change the browser's sequential-focus start
        // point even without focusing the button. Start this independent keyboard
        // audit at the page entry, not wherever the last pointer probe left it.
        await page
          .getByRole("link", { name: "Перейти к карте", exact: true })
          .focus();
        // Traverse real Tab/arrow order, never focus each sampled control: SVG must never
        // take focus, disabled controls must be skipped, and enabled icon
        // controls must retain a visible keyboard indicator.
        const pending = new Set<number>();
        for (const [index, control] of (await controls.all()).entries()) {
          await control.evaluate((element, id) => {
            element.setAttribute("data-icon-keyboard-gate", String(id));
          }, index);
          if (await control.isEnabled()) pending.add(index);
        }
        const keyboardControls = pending.size;
        let radioSteps = 0;
        for (let step = 0; step < 120 && pending.size > 0; step += 1) {
          await page.keyboard.press(radioSteps > 0 ? "ArrowRight" : "Tab");
          if (radioSteps > 0) radioSteps -= 1;
          const focused = page.locator(":focus");
          // At the end of the document the browser chrome owns focus for a Tab.
          if ((await focused.count()) === 0) continue;
          await expect(focused).not.toHaveJSProperty("tagName", "svg");
          const id = await focused.getAttribute("data-icon-keyboard-gate");
          if (id === null) continue;
          // Radio groups deliberately have one Tab stop. Visit their other
          // options using their actual arrow-key interaction, then leave by Tab.
          if (
            (await focused.getAttribute("role")) === "radio" &&
            pending.has(Number(id))
          ) {
            radioSteps = Math.max(radioSteps, 2);
          }
          await expect(focused).toBeEnabled();
          const indicator = await focused.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              visible: element.matches(":focus-visible"),
              outline:
                style.outlineStyle !== "none" &&
                parseFloat(style.outlineWidth) > 0 &&
                style.outlineColor !== "rgba(0, 0, 0, 0)",
              shadow: style.boxShadow !== "none",
            };
          });
          expect(indicator.visible).toBe(true);
          expect(indicator.outline || indicator.shadow).toBe(true);
          pending.delete(Number(id));
        }
        const unreachable = await Promise.all(
          [...pending].map((id) =>
            page
              .locator(`[data-icon-keyboard-gate="${id}"]`)
              .evaluate((element) => element.outerHTML),
          ),
        );
        expect(
          unreachable,
          "Icon controls missing from keyboard tab order",
        ).toEqual([]);
        await testInfo.attach("shell-icon-contract", {
          body: JSON.stringify({
            role,
            width,
            icons: await icons.count(),
            controls: await controls.count(),
            keyboardControls,
            contrastStates,
            disabledControls,
            errors,
            writes,
          }),
          contentType: "application/json",
        });
        expect(errors).toEqual([]);
        expect(writes).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`shell-${role}-${width}.png`),
          fullPage: true,
        });
      });
    }
