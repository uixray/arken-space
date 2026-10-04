import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "..");
const state = JSON.parse(
  await readFile(join(workspace, ".data/local-qa-sticker-import.json"), "utf8"),
);
if (!state.published || state.target !== "http://127.0.0.1:15180")
  throw new Error("Published isolated QA import required");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1146, height: 918 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    console.error(`Page error: ${error.message}`),
  );
  await page.goto(`${state.target}/play/uixray`);
  await page.getByRole("button", { name: "Войти в игру", exact: true }).click();
  await page.waitForURL(`${state.target}/`);
  await page.getByRole("button", { name: "Стикеры", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Выбор стикера" });
  await dialog.waitFor();
  await dialog.locator(".sticker-option").first().waitFor();
  const count = await dialog.locator(".sticker-option").count();
  if (count !== Object.keys(state.imported).length)
    throw new Error(`Player picker count mismatch: ${count}`);
  await page.waitForFunction(() => {
    const image = document.querySelector(".sticker-option img");
    return (
      image instanceof HTMLImageElement &&
      image.complete &&
      image.naturalWidth > 0
    );
  });
  await mkdir(join(workspace, ".data/sticker-qa"), { recursive: true });
  await page.screenshot({
    path: join(workspace, ".data/sticker-qa/player-picker.png"),
  });
  await dialog.locator(".sticker-option").first().click();
  await dialog.waitFor({ state: "hidden" });
  await page.locator(".chat-sticker img").last().waitFor();
  console.log(
    JSON.stringify({
      player: "uixray",
      pickerCount: count,
      imageDecoded: true,
      sent: true,
    }),
  );
} finally {
  await browser.close();
}
