import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const viteEntry = path.join(webRoot, "node_modules", "vite", "bin", "vite.js");
const screenshotRoot = "D:/AI/personal/experiments/arken-space/docs/plans";
const expectedComponentSha =
  "667E2E6F7498DF58D540425553FD940192F9048B5DBDAD9DA5349E6F67F6CD9A";
const server = spawn(
  process.execPath,
  [viteEntry, "--host", "127.0.0.1", "--port", "0"],
  {
    cwd: webRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
server.stdout.setEncoding("utf8");
server.stderr.setEncoding("utf8");
server.stdout.on("data", (chunk) => {
  output += chunk;
});
server.stderr.on("data", (chunk) => {
  output += chunk;
});

async function waitForUrl(timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const url = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
    if (url) return url;
    if (server.exitCode != null)
      throw new Error(`Vite exited ${server.exitCode}: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite readiness timeout: ${output}`);
}

let browser;
try {
  const url = await waitForUrl();
  const port = new URL(url).port;
  const componentBytes = await (
    await import("node:fs/promises")
  ).readFile(path.resolve(webRoot, "src/CatalogEntryForm.tsx"));
  const { createHash } = await import("node:crypto");
  const actualSha = createHash("sha256")
    .update(componentBytes)
    .digest("hex")
    .toUpperCase();
  assert.equal(
    actualSha,
    expectedComponentSha,
    "Component source changed after the final QA gate SHA.",
  );
  console.log(
    `Vite isolated loopback server PID=${server.pid}, address=127.0.0.1:${port}; CatalogEntryForm SHA256=${actualSha}`,
  );

  browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({
    viewport: { width: 1331, height: 1100 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${url}catalog-entry-form.browser.html`, {
    waitUntil: "networkidle",
  });
  const form = page.getByRole("form", { name: "Новая запись каталога" });
  await form.waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  const details = form.locator("details").first();
  assert.equal(
    await details.evaluate((node) => node.open),
    false,
    "Optional parameters disclosure should be closed by default.",
  );
  await details.locator("summary").click();
  assert.equal(
    await details.evaluate((node) => node.open),
    true,
    "Disclosure should open by click.",
  );
  await details.locator("summary").press("Enter");
  assert.equal(
    await details.evaluate((node) => node.open),
    false,
    "Disclosure should close from keyboard.",
  );

  const name = form.getByLabel("Название *");
  const description = form.getByLabel("Описание (необязательно)");
  const submit = form.getByRole("button", { name: "Сохранить" });
  assert.equal(
    await name.evaluate((input) => input.required && !input.checkValidity()),
    true,
    "Required-name native validation must be active.",
  );
  await submit.click();
  assert.equal(
    await page.getByTestId("callback-attempts").textContent(),
    "0",
    "Invalid empty name must not invoke the synthetic callback.",
  );

  await name.fill("QA: навык изолированной формы");
  await description.fill(
    "Черновик сохраняется после намеренной ошибки callback.",
  );
  await submit.click();
  assert.match(
    await page.getByRole("alert").textContent(),
    /QA synthetic callback rejection/,
  );
  assert.equal(
    await name.inputValue(),
    "QA: навык изолированной формы",
    "Name draft should survive callback rejection.",
  );
  assert.equal(
    await description.inputValue(),
    "Черновик сохраняется после намеренной ошибки callback.",
    "Description draft should survive callback rejection.",
  );
  assert.equal(await page.getByTestId("callback-attempts").textContent(), "1");

  await page.screenshot({
    path: path.join(screenshotRoot, "catalog-entry-form-desktop1331.png"),
    fullPage: true,
  });
  await name.focus();
  await name.press("Enter");
  assert.match(
    await page.getByTestId("callback-status").textContent(),
    /SYNTHETIC_SUCCESS/,
  );
  assert.equal(
    await page.getByTestId("callback-attempts").textContent(),
    "2",
    "Enter should submit the completed form.",
  );
  const payload = JSON.parse(
    await page.getByTestId("callback-payload").textContent(),
  );
  assert.equal(payload.name, "QA: навык изолированной формы");
  assert.equal(
    payload.description,
    "Черновик сохраняется после намеренной ошибки callback.",
  );

  const legacyForm = page.getByRole("form", {
    name: "Редактирование записи каталога",
  });
  const legacyName = legacyForm.getByLabel("Название *");
  await legacyName.fill("Новое имя");
  await legacyForm.getByRole("button", { name: "Сохранить" }).click();
  const legacyPayload = JSON.parse(
    await page.getByTestId("legacy-payload").textContent(),
  );
  assert.equal(legacyPayload.name, "Новое имя");
  assert.deepEqual(
    legacyPayload.data.activation,
    {
      consumeUse: false,
      cost: { type: "magic", amount: 2 },
      legacyMetadata: { source: "imported", note: "retain untouched fields" },
    },
    "Rename-only edit should preserve the full legacy activation object.",
  );
  assert.equal(legacyPayload.data.rollActions[0].id, "browser-legacy-roll");
  console.log(
    "PASS legacy mixed ABILITY desktop: rename-only submit preserves complete activation metadata and roll ID.",
  );
  assert.equal(
    errors.length,
    0,
    `No page runtime errors expected: ${errors.join("; ")}`,
  );
  console.log(
    "PASS desktop 1331px: default disclosure, click+keyboard toggle, required validation, draft retention after synthetic failure, Enter submit, local payload contents.",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(80);
  const overflow = await page.evaluate(() => ({
    inner: innerWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(
    overflow.doc <= overflow.inner && overflow.body <= overflow.inner,
    `Horizontal overflow at mobile 390px: ${JSON.stringify(overflow)}`,
  );
  await page.screenshot({
    path: path.join(screenshotRoot, "catalog-entry-form-mobile390.png"),
    fullPage: true,
  });
  console.log(
    `PASS mobile 390px: no horizontal overflow ${JSON.stringify(overflow)}; screenshot saved.`,
  );
  await page.close();
} finally {
  if (browser) await browser.close();
  const pid = server.pid;
  if (server.exitCode == null && pid != null) {
    server.kill(); // terminate only the exact Vite child PID created by this harness
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  console.log(
    `Vite child cleanup requested for exact PID=${pid}; exitCode=${server.exitCode}`,
  );
}
