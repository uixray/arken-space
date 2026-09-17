import type { Locator } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { stickerPack } from "../../apps/web/src/test-support/sticker-fixtures";
import {
  paintedIconContrast,
  settleIconState,
} from "./helpers/painted-icon-contrast";

const sendName =
  "Отправить. Enter — отправить всем. Ctrl+Enter — отправить только мастеру.";
async function contract(control: Locator, name: string, width: number) {
  await expect(control).toHaveAccessibleName(name);
  const icon = control.locator("svg.arken-icon");
  await expect(icon).toHaveCount(1);
  for (const [a, v] of [
    ["aria-hidden", "true"],
    ["focusable", "false"],
    ["stroke", "currentColor"],
    ["stroke-width", "2"],
  ])
    await expect(icon).toHaveAttribute(a, v);
  await control.scrollIntoViewIfNeeded();
  const box = (await control.boundingBox())!;
  expect(Number(box.width.toFixed(3))).toBeGreaterThanOrEqual(
    width === 360 ? 44 : 24,
  );
  expect(Number(box.height.toFixed(3))).toBeGreaterThanOrEqual(
    width === 360 ? 44 : 24,
  );
  expect(
    await control.evaluate((n) => {
      const r = n.getBoundingClientRect();
      return n.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
  ).toBe(true);
  await control.page().mouse.move(width - 1, 1);
  await settleIconState(control);
  expect(await control.evaluate((n) => n.matches(":hover"))).toBe(false);
  const normal = await paintedIconContrast(icon);
  expect(normal).toBeGreaterThanOrEqual(3);
  await control.hover();
  await settleIconState(control);
  expect(await control.evaluate((n) => n.matches(":hover"))).toBe(true);
  const hover = await paintedIconContrast(icon);
  expect(hover).toBeGreaterThanOrEqual(3);
  return { name, normal, hover, glyph: await icon.innerHTML() };
}

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 360]) {
    test(`UIX-645 chat icon states ${role} ${width}`, async ({
      page,
    }, info) => {
      const snapshot = buildGameSnapshot(role, { schemaVersion: 2 });
      const errors: string[] = [],
        unexpectedWrites: string[] = [],
        sent: Array<Record<string, unknown>> = [];
      let release!: () => void;
      const pending = new Promise<void>((r) => {
        release = r;
      });
      let completed = 0;
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/**", async (route) => {
        const req = route.request(),
          path = new URL(req.url()).pathname;
        if (path === "/api/chat" && req.method() === "POST") {
          sent.push(req.postDataJSON());
          if (sent.length === 1) await pending;
          await route.fulfill({ json: { ok: true } });
          completed++;
          return;
        }
        if (path === "/api/chat/read")
          return route.fulfill({ json: { ok: true } });
        if (req.method() !== "GET") {
          unexpectedWrites.push(`${req.method()} ${path}`);
          return route.fulfill({
            status: 405,
            json: { error: "READ_ONLY_FIXTURE" },
          });
        }
        if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
        if (path === "/api/story/posts")
          return route.fulfill({ json: { posts: [], nextCursor: null } });
        if (path === "/api/stickers")
          return route.fulfill({ json: [stickerPack(1)] });
        if (path.endsWith("/content"))
          return route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#5e8d78"/></svg>',
          });
        if (path === "/api/operator/feedback/capability")
          return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
        return route.fulfill({ json: [] });
      });
      await page.routeWebSocket(/\/socket\.io\//, (s) => {
        s.onMessage((m) => {
          if (m.toString() === "40") s.send('40{"sid":"chat-icons"}');
        });
        s.send(
          '0{"sid":"chat-icons","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
        );
      });
      try {
        await page.setViewportSize({ width, height: 850 });
        await page.goto("/");
        if (width === 360) await page.locator("#compact-nav-journal").click();
        await page.locator("#chat-tab-activity").click();

        const composer = page.getByRole("textbox", {
          name: "Сообщение или бросок",
          exact: true,
        });
        const send = page.locator(
          ".chat-compose .composer-send-action:visible",
        );
        const sticker = page.locator(
          ".chat-compose .sticker-picker > button:visible",
        );
        const filter = page.locator(".activity-filters-menu > summary:visible");
        const samples = [];
        samples.push(
          await contract(send, sendName, width),
          await contract(sticker, "Стикеры", width),
          await contract(filter, "Показывать: включены все потоки", width),
        );
        expect(new Set(samples.map((x) => x.glyph)).size).toBe(3);
        const controls = [send, sticker, filter];
        for (const [i, c] of controls.entries())
          await c.evaluate(
            (n, id) => n.setAttribute("data-chat-icon-gate", String(id)),
            i,
          );
        const pendingFocus = new Set([0, 1, 2]);
        const focusTrail: string[] = [];
        // Start before all sampled controls, not after the filter. Browser chrome
        // does not guarantee a cyclic Tab route back into the document.
        await page.locator("#chat-tab-activity").focus();
        for (let n = 0; n < 100 && pendingFocus.size; n++) {
          await page.keyboard.press("Tab");
          const focused = page.locator(":focus");
          if (!(await focused.count())) continue;
          focusTrail.push(
            await focused.evaluate((n) =>
              JSON.stringify({
                hasFocus: document.hasFocus(),
                node: n.outerHTML.slice(0, 250),
              }),
            ),
          );
          const key = await focused.getAttribute("data-chat-icon-gate");
          if (key === null) continue;
          expect(
            await focused.evaluate((n) => {
              const s = getComputedStyle(n);
              return (
                n.matches(":focus-visible") &&
                ((s.outlineStyle !== "none" &&
                  parseFloat(s.outlineWidth) > 0 &&
                  s.outlineColor !== "rgba(0, 0, 0, 0)") ||
                  s.boxShadow !== "none")
              );
            }),
          ).toBe(true);
          pendingFocus.delete(Number(key));
        }
        await info.attach("focus-trail", {
          body: JSON.stringify(focusTrail),
          contentType: "application/json",
        });
        expect([...pendingFocus]).toEqual([]);
        await filter.focus();
        await filter.press("Enter");
        const rolls = page
          .locator(".activity-filters-menu")
          .getByRole("checkbox", { name: "Броски", exact: true });
        await rolls.uncheck();
        await rolls.press("Escape");
        await expect(filter).toBeFocused();
        await expect(filter).toHaveAccessibleName("Показывать. Скрыто: Броски");
        await expect(filter.locator(".activity-filters-badge")).toHaveText("1");
        samples.push(
          await contract(filter, "Показывать. Скрыто: Броски", width),
        );
        await sticker.focus();
        await sticker.press("Enter");
        const search = page
          .getByRole("dialog", { name: "Выбор стикера" })
          .getByRole("searchbox");
        await expect(search).toBeFocused();
        await search.press("Escape");
        await expect(sticker).toBeFocused();
        // Empty input is validated locally, not an invented disabled-state contract.
        await send.press("Enter");
        await expect(composer).toHaveAttribute("aria-invalid", "true");
        expect(sent).toHaveLength(0);
        await composer.fill("Проверка отправки");
        await expect(sticker).toHaveCount(0);
        await send.press("Enter");
        await expect.poll(() => sent.length).toBe(1);
        await expect(composer).toHaveValue("");
        await expect(sticker).toBeVisible();
        await composer.fill("Следующее сообщение");
        await expect(send).toBeEnabled();
        samples.push(await contract(send, sendName, width));
        expect(sent).toHaveLength(1);
        const response = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/chat" &&
            r.request().method() === "POST",
        );
        release();
        await (await response).finished();
        // Let fetch/json continuations and the resulting React paint settle,
        // rather than treating route.fulfill() as client-side completion.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        await expect.poll(() => completed).toBe(1);
        await expect(composer).toHaveValue("Следующее сообщение");
        expect(sent[0]).toMatchObject({
          body: "Проверка отправки",
          visibility: "PUBLIC",
          stream: "TABLE",
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`chat-icons-${role}-${width}.png`),
        });
        await info.attach("chat-icon-states", {
          body: JSON.stringify({
            role,
            width,
            samples,
            sent,
            errors,
            unexpectedWrites,
          }),
          contentType: "application/json",
        });
        expect(errors).toEqual([]);
        expect(unexpectedWrites).toEqual([]);
      } finally {
        release();
      }
    });
  }
