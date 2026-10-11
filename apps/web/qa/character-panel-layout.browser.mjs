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
  "src/sidebar/CharacterWorkspace.tsx": "599BB3CB9B11F9D2C795C500B8499295CCDBDA3346D49A61F89CF8411AF98DCD",
  "src/styles.css": "063845D1330CB0D9B070A756B8CFFFA303AC1600BCD7BB44C0A0B3DA2736851F",
  "src/main.tsx": "B0937FABCE870EE21534F24697F8A5EA7BFC431D47BB1BD96EBF3C2583E78004",
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
  const sourceHashes = {};
  for (const [relative, expected] of Object.entries(expectedHashes)) {
    const bytes = await readFile(path.join(webRoot, relative));
    const actual = createHash("sha256").update(bytes).digest("hex").toUpperCase();
    assert.equal(actual, expected, `${relative} changed after plan review.`);
    sourceHashes[relative] = actual;
  }
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(address && typeof address === "object", "Vite must bind an isolated loopback port.");
  const url = `http://127.0.0.1:${address.port}/`;
  console.log(`Isolated Vite ${new URL(url).host}; product source SHA256=${JSON.stringify(sourceHashes)}`);
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const page = await browser.newPage({ viewport: { width: 1331, height: 1100 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  let blockedViteHmrWebSocket = false;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("WebSocket connection") || message.text().includes("[vite] failed to connect to websocket") || message.text().includes("Failed to send error to Vite server")) {
      blockedViteHmrWebSocket = true;
      return;
    }
    pageErrors.push(message.text());
  });
  await page.route(`${url}character-panel-layout-browser`, (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/qa/character-panel-layout.browser.tsx"></script></body></html>`,
  }));
  const stubbedApiRequests = [];
  await page.route("**/api/characters/character-layout-browser/media", async (route) => {
    stubbedApiRequests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.goto(`${url}character-panel-layout-browser`, { waitUntil: "networkidle" });
  const root = page.locator(".character-sheet-content");
  await root.waitFor({ timeout: 10000 }).catch(async (error) => {
    throw new Error(`Actual CharacterPanel did not render. ${error.message}\nBody: ${(await page.locator("body").innerText()).slice(0, 1200)}\nErrors: ${pageErrors.join("; ")}`);
  });
  const grid = page.locator(".character-sheet-stat-grid");
  const cardSelectors = {
    stats: ".character-card--stats",
    combat: ".character-card--combat",
    skills: ".character-card--skills",
    abilities: ".character-card--abilities",
  };
  const results = [];
  for (const width of [1331, 1100, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.waitForTimeout(80);
    const dimensions = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
      };
      return {
        viewport: { width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth },
        frame: rect("#qa-frame"),
        root: rect(".character-sheet-content"),
        grid: rect(".character-sheet-stat-grid"),
        computed: { gridDisplay: getComputedStyle(document.querySelector(".character-sheet-stat-grid")).display, alignItems: getComputedStyle(document.querySelector(".character-sheet-stat-grid")).alignItems },
        cards: Object.fromEntries(Object.entries({ stats: ".character-card--stats", combat: ".character-card--combat", skills: ".character-card--skills", abilities: ".character-card--abilities" }).map(([key, selector]) => [key, rect(selector)])),
      };
    });
    const { stats, combat, skills, abilities } = dimensions.cards;
    assert.ok(dimensions.viewport.documentWidth <= width && dimensions.viewport.bodyWidth <= width, `${width}px document overflow: ${JSON.stringify(dimensions.viewport)}`);
    assert.ok(dimensions.root.x >= -1 && dimensions.root.right <= width + 1, `${width}px root clipped horizontally: ${JSON.stringify(dimensions.root)}`);
    for (const [name, box] of Object.entries(dimensions.cards)) {
      assert.ok(box.x >= dimensions.root.x - 1 && box.right <= dimensions.root.x + dimensions.root.width + 1, `${width}px ${name} escapes root horizontally: ${JSON.stringify({ root: dimensions.root, box })}`);
      assert.ok(box.scrollWidth <= box.clientWidth + 1, `${width}px ${name} has internal horizontal overflow: ${JSON.stringify(box)}`);
    }
    if (width >= 540) {
      assert.equal(dimensions.computed.gridDisplay, "grid", `${width}px grid must use two-column card layout.`);
      assert.ok(Math.abs(stats.y - combat.y) <= 2, `${width}px stats/combat must share row one: ${JSON.stringify(dimensions.cards)}`);
      assert.ok(Math.abs(skills.y - abilities.y) <= 2, `${width}px skills/abilities must share row two: ${JSON.stringify(dimensions.cards)}`);
      assert.ok(skills.y >= Math.max(stats.bottom, combat.bottom) - 1, `${width}px lower row overlaps first row: ${JSON.stringify(dimensions.cards)}`);
      assert.ok(Math.abs(skills.height - abilities.height) > 1, `${width}px fixture should expose natural unequal lower-card heights: ${JSON.stringify(dimensions.cards)}`);
      assert.equal(dimensions.computed.alignItems, "start", `${width}px cards must not stretch to equal row height.`);
    } else {
      assert.notEqual(dimensions.computed.gridDisplay, "grid", `${width}px container must switch to natural stacked flow.`);
      assert.ok(stats.y < combat.y && combat.y < skills.y && skills.y < abilities.y, `${width}px stats/combat/skills/abilities must follow natural document order: ${JSON.stringify(dimensions.cards)}`);
      assert.ok(combat.y >= stats.bottom - 1 && skills.y >= combat.bottom - 1 && abilities.y >= skills.bottom - 1, `${width}px stacked cards overlap: ${JSON.stringify(dimensions.cards)}`);
    }
    const skillControl = page.locator(`${cardSelectors.skills} button`).first();
    const abilityControl = page.locator(`${cardSelectors.abilities} button`).first();
    assert.equal(await skillControl.isVisible(), true, `${width}px real skill control must be visible.`);
    assert.equal(await skillControl.isEnabled(), true, `${width}px real skill control must be enabled.`);
    assert.equal(await abilityControl.isVisible(), true, `${width}px real ability control must be visible.`);
    assert.equal(await abilityControl.isEnabled(), true, `${width}px real ability control must be enabled.`);
    await skillControl.focus();
    assert.equal(await skillControl.evaluate((element) => document.activeElement === element), true, `${width}px skill control must receive keyboard focus.`);
    await abilityControl.focus();
    assert.equal(await abilityControl.evaluate((element) => document.activeElement === element), true, `${width}px ability control must receive keyboard focus.`);
    const shot = path.join(screenshotRoot, `character-panel-${width}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    results.push({ width, ...dimensions, skillControl: await skillControl.getAttribute("aria-label"), abilityControl: (await abilityControl.innerText()).trim(), screenshot: shot });
    console.log(`${width}px: ${JSON.stringify(results.at(-1))}`);
  }
  assert.deepEqual(pageErrors, [], `Application errors: ${pageErrors.join("; ")}`);
  assert.ok(stubbedApiRequests.length >= 1, "The mounted self-fetching gallery must be isolated by the exact fixture API stub.");
  assert.ok(stubbedApiRequests.every((request) => request.endsWith("/api/characters/character-layout-browser/media")), "Only the fixture gallery request may be stubbed.");
  console.log(`PASS actual CharacterPanel layout: ${results.length}/3 viewports; pageErrors=0; blockedViteHmrWebSocket=${blockedViteHmrWebSocket}`);
} finally {
  await browser?.close();
  await vite.close();
}


