import { expect, test } from "@playwright/test";
import { inspectIconStructure } from "./helpers/icon-structure";

test("batched icon structure retains attribute, geometry and hit-area negative controls", async ({
  page,
}) => {
  const markup =
    `<style>button{width:40px;height:40px}svg{width:16px;height:16px}</style>` +
    Array.from(
      { length: 6 },
      () =>
        `<button aria-label="Sample"><svg class="arken-icon" aria-hidden="true" focusable="false" stroke="currentColor" stroke-width="2"><path d="M0 0L16 16"/></svg></button>`,
    ).join("");
  const inspect = () =>
    inspectIconStructure(page.locator("svg"), page.locator("button"));
  await page.setContent(markup);
  expect((await inspect()).svg).toHaveLength(6);
  for (const [attribute, value] of [
    ["aria-hidden", "false"],
    ["focusable", "true"],
    ["stroke", "red"],
    ["stroke-width", "1"],
  ]) {
    await page
      .locator("svg")
      .first()
      .evaluate(
        (element, [key, value]) => element.setAttribute(key, value),
        [attribute, value],
      );
    await expect(inspect()).rejects.toThrow("SVG contract violation");
    await page.setContent(markup);
  }
  await page
    .locator("svg")
    .first()
    .evaluate((element) => ((element as SVGElement).style.width = "0px"));
  await expect(inspect()).rejects.toThrow("Invisible SVG geometry");
  await page.setContent(markup);
  await page
    .locator("button")
    .first()
    .evaluate((element) => {
      element.style.width = "20px";
      element.style.padding = "0";
    });
  await expect(inspect()).rejects.toThrow("hit area");
});
