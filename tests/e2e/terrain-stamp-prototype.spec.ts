import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("terrain stamp prototype placement, editing, camera, round-trip and density metrics", async ({
  page,
}, testInfo) => {
  const externalRequests: string[] = [];
  const pointerWarnings: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1")
      externalRequests.push(request.url());
  });
  page.on("console", (message) => {
    if (
      message.type() === "warning" &&
      /pointer position is missing/i.test(message.text())
    ) {
      pointerWarnings.push(message.text());
    }
  });
  await page.setViewportSize({ width: 1460, height: 940 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const stage = page.locator("#stage");
  await expect(
    page.getByRole("heading", { name: "Штампы местности" }),
  ).toBeVisible();
  const fontState = await page.evaluate(() => ({
    loaded: document.fonts.check('400 16px "Pragmatica Next"'),
    family: getComputedStyle(document.body).fontFamily,
  }));
  expect(fontState.loaded).toBe(true);
  expect(fontState.family).toMatch(/^"Pragmatica Next"/);
  await expect(page.locator("#app")).toHaveAttribute(
    "data-patterns-ready",
    "3",
  );
  await expect(
    page.getByLabel("Проверка повторения текстуры 2 на 2"),
  ).toBeVisible();
  expect(pointerWarnings).toEqual([]);
  await expect(page.locator("#object-count")).toHaveText("0");

  await page.locator('[data-stamp="forest"]').click();
  await page.locator("#size").fill("96");
  await page.locator("#rotation").fill("35");
  await page.locator("#layer").selectOption("DECORATION_GM");
  const bounds = (await stage.boundingBox())!;
  await page.mouse.click(bounds.x + 140, bounds.y + 160);
  await page.mouse.click(bounds.x + 260, bounds.y + 190);
  await expect(page.locator("#object-count")).toHaveText("2");
  await expect(stage).toHaveAttribute("data-raster-stamp-count", "2");
  await expect(page.locator("#detail-kind")).toHaveText("forest");
  await expect(page.locator("#detail-transform")).toHaveText("96 / 35°");
  await expect(page.locator("#detail-revision")).toContainText(
    "DECORATION_GM / r0",
  );
  await page.getByRole("button", { name: "Проверить JSON round-trip" }).click();
  await expect(page.locator("#roundtrip-result")).toContainText(
    "PASS · 2 stamps",
  );

  await page.locator("#select-mode").click();
  await page.mouse.move(bounds.x + 140, bounds.y + 160);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 180, bounds.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#detail-revision")).toContainText(
    "DECORATION_GM / r1",
  );
  const movedPosition = await page.locator("#detail-position").textContent();
  expect(movedPosition).not.toBe("140, 160");

  await page.getByRole("button", { name: "Копировать" }).click();
  await expect(page.locator("#object-count")).toHaveText("3");
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.locator("#object-count")).toHaveText("2");
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.locator("#object-count")).toHaveText("3");
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(page.locator("#object-count")).toHaveText("2");

  await page.mouse.move(bounds.x + 320, bounds.y + 240);
  await page.mouse.wheel(0, -120);
  await expect(page.locator("#zoom-value")).not.toHaveText("100%");
  const beforePan = await stage.getAttribute("data-camera-x");
  await page.mouse.move(bounds.x + 320, bounds.y + 240);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(bounds.x + 355, bounds.y + 265, { steps: 3 });
  await page.mouse.up({ button: "middle" });
  await expect
    .poll(() => stage.getAttribute("data-camera-x"))
    .not.toBe(beforePan);
  expect(await page.locator("#panzoom-time").textContent()).toMatch(
    /[0-9.]+ ms avg/,
  );

  await page.getByRole("button", { name: "Загрузить 100" }).click();
  await expect(page.locator("#object-count")).toHaveText("100");
  await expect(page.locator("#load-time")).toContainText("ms");
  await expect(page.locator("#draw-time")).toContainText("ms");
  await expect(page.locator("#payload-size")).toContainText("B");
  const hundred = {
    load: await page.locator("#load-time").textContent(),
    draw: await page.locator("#draw-time").textContent(),
    payload: await page.locator("#payload-size").textContent(),
  };
  await page.getByRole("button", { name: "Загрузить 500" }).click();
  await expect(page.locator("#object-count")).toHaveText("500");
  await expect(stage).toHaveAttribute("data-raster-stamp-count", "500");
  await expect(page.locator("#load-time")).toContainText("ms");
  await expect(page.locator("#draw-time")).toContainText("ms");
  await expect(page.locator("#payload-size")).toContainText("B");
  await page.getByRole("button", { name: "Проверить JSON round-trip" }).click();
  await expect(page.locator("#roundtrip-result")).toContainText(
    "PASS · 500 stamps",
  );
  const fiveHundred = {
    load: await page.locator("#load-time").textContent(),
    draw: await page.locator("#draw-time").textContent(),
    payload: await page.locator("#payload-size").textContent(),
    panzoom: await page.locator("#panzoom-time").textContent(),
  };
  expect(externalRequests).toEqual([]);
  const metricsPath = testInfo.outputPath("metrics.json");
  await writeFile(
    metricsPath,
    JSON.stringify({ hundred, fiveHundred, externalRequests }, null, 2),
  );
  await testInfo.attach("terrain-stamp-prototype-metrics", {
    path: metricsPath,
    contentType: "application/json",
  });
  await page.screenshot({
    path: testInfo.outputPath("terrain-stamp-500.png"),
    fullPage: true,
  });
});
