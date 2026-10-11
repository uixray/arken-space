import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const screenshotRoot = "D:/AI/personal/experiments/arken-space/docs/qa-prep";
const expectedHashes = {
  "src/sidebar/ActivityInitiativePanel.tsx":
    "1FDAEB496F76E615350FEC746D484526F3DC4415EB529AC60CA672C70B8B8FE8",
  "src/sidebar/InitiativePanel.tsx":
    "737512B96E06ED65CB3658BD27F674C7035C26BFF10306CD91268DE71D8E5227",
};
const vite = await createServer({
  root: webRoot,
  configFile: path.join(webRoot, "vite.config.ts"),
  envDir: false,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false },
});
let browser;
try {
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(
    address && typeof address === "object",
    "Vite must bind an isolated loopback port.",
  );
  const url = `http://127.0.0.1:${address.port}/`;
  const actualHashes = {};
  for (const [relative, expected] of Object.entries(expectedHashes)) {
    const bytes = await readFile(path.join(webRoot, relative));
    const actual = createHash("sha256")
      .update(bytes)
      .digest("hex")
      .toUpperCase();
    assert.equal(
      actual,
      expected,
      `${relative} changed after the reviewed source checkpoint.`,
    );
    actualHashes[relative] = actual;
  }
  console.log(
    `Isolated Vite on ${new URL(url).host}; source SHA256=${JSON.stringify(actualHashes)}`,
  );

  browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({
    viewport: { width: 1331, height: 1000 },
    deviceScaleFactor: 1,
  });
  const pageErrors = [];
  let blockedViteHmrWebSocket = false;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (
      message.text().includes("WebSocket connection") ||
      message.text().includes("[vite] failed to connect to websocket") ||
      message.text().includes("Failed to send error to Vite server")
    ) {
      blockedViteHmrWebSocket = true;
      return;
    }
    pageErrors.push(message.text());
  });

  await page.route(`${url}uix505-initiative-browser`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/qa/uix505-initiative.browser.tsx"></script></body></html>`,
    }),
  );
  await page.goto(`${url}uix505-initiative-browser`, {
    waitUntil: "networkidle",
  });
  const slot = page.getByTestId("initiative-slot");
  const sentinel = page.getByTestId("focus-sentinel");
  const geometryIssues = [];
  await sentinel.waitFor({ timeout: 10000 }).catch(async (error) => {
    throw new Error(
      `Harness did not render. ${error.message}\nBody: ${(await page.locator("body").innerText()).slice(0, 1200)}\nPage errors: ${pageErrors.join("; ")}`,
    );
  });

  async function applySnapshot(scenario) {
    await page.evaluate((value) => {
      window.dispatchEvent(
        new CustomEvent("uix505:authoritative-snapshot", { detail: value }),
      );
    }, scenario);
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector('[data-testid="snapshot-state"]')
          ?.textContent?.includes(expected),
      {
        "gm-prep": "GM:NO_ENCOUNTER",
        "player-inactive": "PLAYER:NO_ENCOUNTER",
        "player-active": "PLAYER:ACTIVE",
        "player-linked-scene": "PLAYER:ACTIVE",
        "player-foreign-encounter": "PLAYER:ACTIVE",
        "player-ended": "PLAYER:ENDED",
      }[scenario],
    );
  }

  async function expectHiddenAndUnfocusedState(label) {
    assert.equal(
      await slot.locator('[aria-label="Очередь ходов"]').count(),
      0,
      `${label}: panel must be absent.`,
    );
    assert.equal(
      await slot.locator(".initiative-panel").count(),
      0,
      `${label}: no empty initiative disclosure.`,
    );
    assert.equal(
      await slot
        .locator(
          "button,input,select,textarea,a,[tabindex]:not([tabindex='-1'])",
        )
        .count(),
      0,
      `${label}: no hidden focusable initiative controls.`,
    );
    assert.equal(
      await slot.evaluate((node) => node.getBoundingClientRect().height),
      0,
      `${label}: no empty vertical block.`,
    );
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("data-testid"),
      ),
      "focus-sentinel",
      `${label}: focus must remain on the neutral scene control.`,
    );
  }

  async function assertNoHorizontalOverflow(width) {
    const dimensions = await page.evaluate(() => ({
      inner: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    assert.ok(
      dimensions.document <= dimensions.inner &&
        dimensions.body <= dimensions.inner,
      `Horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`,
    );
    return dimensions;
  }

  async function runViewport(width, height) {
    await page.setViewportSize({ width, height });
    await applySnapshot("gm-prep");
    assert.equal(
      await slot.getByRole("region", { name: "Очередь ходов" }).count(),
      1,
      `${width}px: GM prep must remain available without an encounter.`,
    );
    assert.equal(
      await slot.getByText("Ввести в бой · 1").count(),
      1,
      `${width}px: GM prep control must remain available.`,
    );
    assert.equal(
      await slot
        .getByText(
          "Обведите зону боя на карте или выделите рамкой тех, кто вступает в бой.",
        )
        .count(),
      1,
    );
    await assertNoHorizontalOverflow(width);
    await page.screenshot({
      path: path.join(screenshotRoot, `uix505-initiative-${width}-gm-prep.png`),
      fullPage: true,
    });

    await sentinel.focus();
    await applySnapshot("player-inactive");
    await expectHiddenAndUnfocusedState(`${width}px PLAYER without ACTIVE`);
    await assertNoHorizontalOverflow(width);
    await page.screenshot({
      path: path.join(
        screenshotRoot,
        `uix505-initiative-${width}-player-inactive.png`,
      ),
      fullPage: true,
    });

    await applySnapshot("player-active");
    const activePanel = slot.getByRole("region", { name: "Очередь ходов" });
    assert.equal(
      await activePanel.count(),
      1,
      `${width}px: authoritative ACTIVE encounter must reveal PLAYER initiative.`,
    );
    assert.equal(
      await activePanel.getByLabel("Инициатива «Игрок»").count(),
      1,
      `${width}px: the player's own server-authorized row should render.`,
    );
    assert.equal(
      await activePanel.getByText("Ввести в бой").count(),
      0,
      `${width}px: PLAYER must not receive GM prep controls.`,
    );
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("data-testid"),
      ),
      "focus-sentinel",
      `${width}px: appearing panel must not steal focus.`,
    );
    const geometry = await activePanel.evaluate((panel) => {
      const selectors = {
        wrapper: ".activity-initiative-panel",
        disclosure: ".initiative-panel",
        row: ".initiative-panel__row",
        name: ".initiative-panel__name",
        valueWrapper: ".initiative-panel__value",
        valueInput: ".initiative-panel__value input",
        actions: ".initiative-panel__actions",
      };
      const elements = Object.fromEntries(
        Object.entries(selectors).map(([key, selector]) => {
          const element = panel.querySelector(selector);
          if (!element) return [key, null];
          const rect = element.getBoundingClientRect();
          return [
            key,
            {
              left: Math.round(rect.left * 100) / 100,
              right: Math.round(rect.right * 100) / 100,
              width: Math.round(rect.width * 100) / 100,
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              overflowX: getComputedStyle(element).overflowX,
            },
          ];
        }),
      );
      const context = document.querySelector(
        '[data-testid="activity-chat-context"]',
      );
      const contextRect = context?.getBoundingClientRect();
      return {
        viewport: innerWidth,
        chatContext: contextRect
          ? {
              left: contextRect.left,
              right: contextRect.right,
              width: contextRect.width,
              clientWidth: context.clientWidth,
              scrollWidth: context.scrollWidth,
            }
          : null,
        panel: {
          clientWidth: panel.clientWidth,
          scrollWidth: panel.scrollWidth,
        },
        elements,
      };
    });
    const outside = Object.entries(geometry.elements).filter(
      ([, rect]) =>
        rect &&
        (rect.left < -1 ||
          rect.right > width + 1 ||
          rect.scrollWidth > rect.clientWidth + 1),
    );
    console.log(`GEOMETRY ${width}px ${JSON.stringify(geometry)}`);
    if (
      outside.length > 0 ||
      geometry.panel.scrollWidth > geometry.panel.clientWidth + 1
    ) {
      geometryIssues.push({ width, outside, panel: geometry.panel, geometry });
    }
    await assertNoHorizontalOverflow(width);
    await page.screenshot({
      path: path.join(
        screenshotRoot,
        `uix505-initiative-${width}-player-active.png`,
      ),
      fullPage: true,
    });

    await page.evaluate(() =>
      window.dispatchEvent(new Event("uix505:remount")),
    );
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="snapshot-state"]')
        ?.textContent?.startsWith("PLAYER:ACTIVE"),
    );
    assert.equal(
      await slot.getByRole("region", { name: "Очередь ходов" }).count(),
      1,
      `${width}px: ACTIVE state remains visible after component remount.`,
    );
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("data-testid"),
      ),
      "focus-sentinel",
      `${width}px: remount must not steal focus.`,
    );

    await applySnapshot("player-linked-scene");
    assert.equal(
      await slot.getByRole("region", { name: "Очередь ходов" }).count(),
      1,
      `${width}px: authorized linked-scene encounter remains visible across scene target change.`,
    );
    assert.match(
      await page.getByTestId("snapshot-state").textContent(),
      /PLAYER:ACTIVE:00000000-0000-4000-8000-000000000004/,
    );
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("data-testid"),
      ),
      "focus-sentinel",
      `${width}px: scene target change must not steal focus.`,
    );

    await applySnapshot("player-foreign-encounter");
    await expectHiddenAndUnfocusedState(
      `${width}px PLAYER foreign-campaign encounter`,
    );
    await applySnapshot("player-active");
    assert.equal(
      await slot.getByRole("region", { name: "Очередь ходов" }).count(),
      1,
    );
    await applySnapshot("player-ended");
    await expectHiddenAndUnfocusedState(`${width}px PLAYER after ENDED`);
    await applySnapshot("gm-prep");
    assert.equal(
      await slot.getByRole("region", { name: "Очередь ходов" }).count(),
      1,
      `${width}px: GM prep remains available after encounter end.`,
    );
    assert.equal(await slot.getByText("Ввести в бой · 1").count(), 1);
    await assertNoHorizontalOverflow(width);
    console.log(
      `PASS ${width}px lifecycle/role/focus/geometry: GM prep, hidden inactive PLAYER, ACTIVE reveal, authorized row, no PLAYER GM controls, remount, linked scene, foreign-campaign hide, ENDED hide, zero-block/no-focusable/focus continuity; ${JSON.stringify(await assertNoHorizontalOverflow(width))}.`,
    );
  }

  await runViewport(1331, 1000);
  await runViewport(390, 844);
  assert.equal(
    geometryIssues.length,
    0,
    `Initiative row content must fit the production wrapper at both widths: ${JSON.stringify(geometryIssues)}`,
  );
  assert.equal(
    pageErrors.length,
    0,
    `No page errors expected: ${pageErrors.join("; ")}`,
  );
  if (blockedViteHmrWebSocket)
    console.log(
      "NOTE Chrome blocked Vite dev-HMR websocket under local-network checks; no application page errors occurred.",
    );
  console.log(
    "PASS all scoped UIX-505 isolated browser predicates; no API/auth/reconnect/real campaign used.",
  );
  await page.close();
} finally {
  if (browser) await browser.close();
  await vite.close();
  console.log(
    "Vite isolated server closed; no child process or exposed port retained.",
  );
}
