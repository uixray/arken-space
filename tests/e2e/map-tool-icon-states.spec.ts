import type { Locator } from "@playwright/test";
import {
  paintedIconContrast,
  settleIconState,
} from "./helpers/painted-icon-contrast";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

const modeNames: Record<string, string> = {
  PAN: "Перемещение",
  DRAW: "Рисование",
  RULER: "Линейка",
  PING: "Пинг",
  FOG: "Открыть туман",
  COVER: "Закрыть туман",
  FOG_BRUSH: "Открыть туман кистью",
  COVER_BRUSH: "Закрыть туман кистью",
  FOG_POLYGON: "Открыть туман полигоном",
  COVER_POLYGON: "Закрыть туман полигоном",
};
async function iconContract(control: Locator, name: string, width: number) {
  await expect(control).toHaveAccessibleName(name);
  const icon = control.locator(":scope > svg.arken-icon");
  await expect(icon).toHaveCount(1);
  for (const [attribute, value] of [
    ["aria-hidden", "true"],
    ["focusable", "false"],
    ["stroke", "currentColor"],
    ["stroke-width", "2"],
  ])
    await expect(icon).toHaveAttribute(attribute, value);
  await control.scrollIntoViewIfNeeded();
  const box = (await control.boundingBox())!;
  expect(Number(box.width.toFixed(3)), `${name}: width`).toBeGreaterThanOrEqual(
    width === 360 ? 44 : 24,
  );
  expect(
    Number(box.height.toFixed(3)),
    `${name}: height`,
  ).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
  expect(
    await control.evaluate((n) => {
      const r = n.getBoundingClientRect();
      return n.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
    `${name}: reachable center`,
  ).toBe(true);
  return icon;
}

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 360]) {
    test(`UIX-645 expanded map tools ${role} ${width}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 850 });
      const errors: string[] = [];
      const writes: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const snapshot = buildGameSnapshot(role);
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
      const toolbar = page.getByRole("toolbar", { name: "Инструменты карты" });
      const collapse = toolbar.locator(".map-toolbar__collapse");
      const expected = [
        "PAN",
        "DRAW",
        "RULER",
        "PING",
        ...(role === "GM"
          ? [
              "FOG",
              "COVER",
              "FOG_BRUSH",
              "COVER_BRUSH",
              "FOG_POLYGON",
              "COVER_POLYGON",
            ]
          : []),
      ];
      const samples: object[] = [];
      const collapseGlyphs: string[] = [];
      for (const expanded of [true, false]) {
        if ((await collapse.getAttribute("aria-expanded")) !== String(expanded))
          await collapse.click();
        await expect(collapse).toHaveAttribute(
          "aria-expanded",
          String(expanded),
        );
        collapseGlyphs.push(
          await (
            await iconContract(
              collapse,
              expanded
                ? "Свернуть панель до значков"
                : "Показать подписи инструментов",
              width,
            )
          ).innerHTML(),
        );
        const modeTools = toolbar.locator(
          'button.map-tool[data-tool][aria-pressed]:not([data-tool="CURSOR_PRESENCE"])',
        );
        expect(
          await modeTools.evaluateAll((ns) =>
            ns.map((n) => n.getAttribute("data-tool")).sort(),
          ),
        ).toEqual([...expected].sort());
        const modeGlyphs: string[] = [];
        for (const tool of expected) {
          const control = toolbar.locator(`button[data-tool="${tool}"]`);
          const icon = await iconContract(control, modeNames[tool], width);
          await control.focus();
          await control.press("Enter");
          await expect(control).toHaveAttribute("aria-pressed", "true");
          expect(
            await modeTools.evaluateAll((ns) =>
              ns
                .filter((n) => n.getAttribute("aria-pressed") === "true")
                .map((n) => n.getAttribute("data-tool")),
            ),
          ).toEqual([tool]);
          modeGlyphs.push(await icon.innerHTML());
          await expect(control).toBeFocused();
          await page.mouse.move(width - 1, 849);
          await settleIconState(control);
          expect(await control.evaluate((n) => n.matches(":hover"))).toBe(
            false,
          );
          const normal = await paintedIconContrast(icon);
          expect(
            normal,
            `${tool}: selected normal contrast`,
          ).toBeGreaterThanOrEqual(3);
          await control.hover();
          await settleIconState(control);
          expect(await control.evaluate((n) => n.matches(":hover"))).toBe(true);
          const hover = await paintedIconContrast(icon);
          expect(
            hover,
            `${tool}: selected hover contrast`,
          ).toBeGreaterThanOrEqual(3);
          samples.push({ expanded, tool, normal, hover });
        }
        expect(new Set(modeGlyphs).size).toBe(expected.length);
        await toolbar.locator('[data-tool="PAN"]').press("Enter");
        if (role === "GM") {
          for (const [first, second] of [
            ["FOG", "COVER"],
            ["FOG_BRUSH", "COVER_BRUSH"],
            ["FOG_POLYGON", "COVER_POLYGON"],
          ]) {
            expect(
              await toolbar.locator(`[data-tool="${first}"] > svg`).innerHTML(),
            ).not.toBe(
              await toolbar
                .locator(`[data-tool="${second}"] > svg`)
                .innerHTML(),
            );
          }
          const summaryGlyphs: string[] = [];
          for (const [selector, name] of [
            [".grid-settings", "Настройки сетки"],
            [".resize-settings", "Настройки размера карты"],
            [".toolbar-overflow", "Дополнительные инструменты"],
          ]) {
            const details = toolbar.locator(selector),
              trigger = details.locator(":scope > summary");
            summaryGlyphs.push(
              await (await iconContract(trigger, name, width)).innerHTML(),
            );
            await trigger.focus();
            await trigger.press("Enter");
            await expect(details).toHaveAttribute("open", "");
            await trigger.press("Escape");
            await expect(details).not.toHaveAttribute("open", "");
            await expect(trigger).toBeFocused();
          }
          expect(new Set(summaryGlyphs).size).toBe(3);
        } else {
          await expect(
            toolbar.locator(
              ".grid-settings,.resize-settings,.toolbar-overflow",
            ),
          ).toHaveCount(0);
        }
        const controls = toolbar
          .locator("button:visible,summary:visible")
          .filter({ has: page.locator("svg.arken-icon") });
        const pending = new Set<number>();
        for (const [index, control] of (await controls.all()).entries()) {
          await control.evaluate(
            (n, id) => n.setAttribute("data-toolbar-gate", String(id)),
            index,
          );
          if (await control.isEnabled()) pending.add(index);
        }
        await collapse.focus();
        // Programmatic focus after pointer input need not be :focus-visible.
        // Enter the measured sequence through an actual keyboard Tab.
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        for (let step = 0; step < 80 && pending.size; step++) {
          const focused = page.locator(":focus");
          if (await focused.count()) {
            const key = await focused.getAttribute("data-toolbar-gate");
            if (key !== null) {
              expect(
                await focused.evaluate((n) => n.matches(":focus-visible")),
              ).toBe(true);
              const paint = await focused.evaluate((n) => {
                const s = getComputedStyle(n);
                return (
                  (s.outlineStyle !== "none" &&
                    parseFloat(s.outlineWidth) > 0 &&
                    s.outlineColor !== "rgba(0, 0, 0, 0)") ||
                  s.boxShadow !== "none"
                );
              });
              expect(paint).toBe(true);
              pending.delete(Number(key));
            }
          }
          if (pending.size) await page.keyboard.press("Tab");
        }
        expect(
          [...pending],
          "All enabled toolbar icons in real Tab order",
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(
            `map-tools-${role}-${width}-${expanded}.png`,
          ),
        });
      }
      expect(new Set(collapseGlyphs).size).toBe(2);
      await testInfo.attach("map-tool-states", {
        body: JSON.stringify({ role, width, samples, errors, writes }),
        contentType: "application/json",
      });
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    });
  }
