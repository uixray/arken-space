import { chromium } from "@playwright/test";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const artifacts = resolve(root, "test-results/uix682-ruler-renderer");
const viteBin = resolve(root, "apps/web/node_modules/vite/bin/vite.js");
const webRoot = resolve(root, "apps/web");
let vite;
let browser;
let viteOutput = "";
let tempConfig;
async function reservePort() {
  const server = createServer();
  await new Promise((ok, fail) =>
    server.listen(0, "127.0.0.1", ok).once("error", fail),
  );
  const port = server.address().port;
  await new Promise((ok, fail) =>
    server.close((error) => (error ? fail(error) : ok())),
  );
  return port;
}
async function waitForVite(url) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (vite.exitCode !== null)
      throw new Error(
        "Isolated Vite exited, code " + vite.exitCode + "\n" + viteOutput,
      );
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* Retry startup until the bounded deadline. */
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for isolated Vite");
}
async function signature(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".map-viewport canvas")).reduce(
      (total, node) => {
        const canvas = node;
        const data = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i] > 205 && data[i + 1] > 125 && data[i + 2] < 110) count++;
        return total + count;
      },
      0,
    ),
  );
}
async function main() {
  await mkdir(artifacts, { recursive: true });
  const port = await reservePort();
  const url =
    "http://127.0.0.1:" + port + "/uix682-ruler-renderer-harness.html";
  tempConfig = resolve(webRoot, ".uix682-ruler-vite.config.mts");
  const adapterPath = resolve(
    webRoot,
    "src/qa/uix682-ruler-socket-adapter.ts",
  ).replaceAll("\\", "/");
  const configSource =
    "import { mergeConfig } from 'vite'; import base from './vite.config.ts'; export default mergeConfig(base, { resolve: { alias: [{ find: './realtime', replacement: '" +
    adapterPath +
    "' }] } });";
  await writeFile(tempConfig, configSource);
  vite = spawn(
    process.execPath,
    [
      viteBin,
      webRoot,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
      "--config",
      tempConfig,
    ],
    {
      cwd: root,
      env: { ...process.env, BROWSER: "none" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  vite.stdout.on("data", (chunk) => {
    viteOutput += String(chunk);
  });
  vite.stderr.on("data", (chunk) => {
    viteOutput += String(chunk);
  });
  await waitForVite(url);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
    deviceScaleFactor: 1,
  });
  const alpha = await context.newPage();
  const beta = await context.newPage();
  await Promise.all([
    alpha.goto(url + "?client=alpha"),
    beta.goto(url + "?client=beta"),
  ]);
  await Promise.all([
    alpha.getByTestId("client").waitFor(),
    beta.getByTestId("client").waitFor(),
  ]);
  await Promise.all([
    alpha.waitForFunction(
      () =>
        document.querySelector("[data-testid=connected]")?.textContent ===
        "ONLINE",
    ),
    beta.waitForFunction(
      () =>
        document.querySelector("[data-testid=connected]")?.textContent ===
        "ONLINE",
    ),
  ]);
  const canvas = alpha.locator(".map-viewport canvas").first();
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Renderer canvas has no browser bounds");
  const start = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.35 };
  const end = { x: box.x + box.width * 0.72, y: box.y + box.height * 0.68 };
  const alphaClean = await signature(alpha);
  const betaClean = await signature(beta);
  await alpha.mouse.move(start.x, start.y);
  await alpha.mouse.down();
  await alpha.mouse.move(end.x, end.y, { steps: 8 });
  await delay(200);
  const peerDuring = await signature(beta);
  await beta.screenshot({ path: resolve(artifacts, "beta-during-ruler.png") });
  const updateSeen = await alpha.evaluate(() =>
    window.__rulerEvents.some((e) => e.event === "out:ruler:update"),
  );
  if (!updateSeen || peerDuring <= betaClean)
    throw new Error(
      "Pointer drag did not produce a visible peer ruler; harness invalid",
    );
  await alpha.mouse.up();
  await delay(200);
  const clearAt = Date.now();
  const alphaClear = await signature(alpha);
  const betaClear = await signature(beta);
  await alpha.screenshot({ path: resolve(artifacts, "alpha-after-clear.png") });
  await beta.screenshot({ path: resolve(artifacts, "beta-after-clear.png") });
  if (alphaClear > 0 || betaClear > 0)
    throw new Error(
      "Ruler remained visible immediately after clear: alphaPixels=" +
        alphaClear +
        " betaPixels=" +
        betaClear +
        " events=" +
        JSON.stringify(await alpha.evaluate(() => window.__rulerEvents)) +
        " peer=" +
        JSON.stringify(await beta.evaluate(() => window.__rulerEvents)),
    );
  await delay(3000);
  const alphaIdle = await signature(alpha);
  const betaIdle = await signature(beta);
  await alpha.screenshot({ path: resolve(artifacts, "alpha-idle-3s.png") });
  await beta.screenshot({ path: resolve(artifacts, "beta-idle-3s.png") });
  if (alphaIdle > 0 || betaIdle > 0)
    throw new Error("Ruler reappeared or remained visible after 3s");
  await beta.getByTestId("reconnect").click();
  await delay(1000);
  await beta.evaluate(() => window.scrollTo(0, 0));
  const betaCanvasCount = await beta.locator(".map-viewport canvas").count();
  if (betaCanvasCount < 2)
    throw new Error(
      "Renderer canvases absent after reconnect: " + betaCanvasCount,
    );
  const betaReconnect = await signature(beta);
  await beta.screenshot({
    path: resolve(artifacts, "beta-after-reconnect-1s.png"),
  });
  if (betaReconnect > 0)
    throw new Error("Ruler visible after synthetic peer reconnect +1s");
  console.log(
    JSON.stringify(
      {
        evidenceTier:
          "real Chromium rendering and pointer input; synthetic BroadcastChannel transport/reconnect, not Socket.IO/server/auth proof",
        origin: new URL(url).origin,
        screenshots: [
          "beta-during-ruler.png",
          "alpha-after-clear.png",
          "beta-after-clear.png",
          "alpha-idle-3s.png",
          "beta-idle-3s.png",
          "beta-after-reconnect-1s.png",
        ],
        alphaBaselineYellowPixels: alphaClean,
        betaBaselineYellowPixels: betaClean,
        peerDuringYellowPixels: peerDuring,
        alphaClearYellowPixels: alphaClear,
        betaClearYellowPixels: betaClear,
        alphaIdleYellowPixels: alphaIdle,
        betaIdleYellowPixels: betaIdle,
        betaReconnectYellowPixels: betaReconnect,
        betaCanvasCountAfterReconnect: betaCanvasCount,
        clearObservedAtUnixMs: clearAt,
        alphaEvents: await alpha.evaluate(() => window.__rulerEvents),
        betaEvents: await beta.evaluate(() => window.__rulerEvents),
        vitePid: vite.pid,
      },
      null,
      2,
    ),
  );
  await context.close();
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    if (vite && vite.exitCode === null) {
      vite.kill("SIGTERM");
      await Promise.race([
        new Promise((ok) => vite.once("exit", ok)),
        delay(3000),
      ]);
      if (vite.exitCode === null && vite.pid)
        spawnSync("taskkill", ["/PID", String(vite.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
    }
    await rm(tempConfig ?? "", { force: true }).catch(() => undefined);
    console.error("isolated Vite PID " + (vite?.pid ?? "none") + " cleaned up");
  });
