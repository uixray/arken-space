import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const placementCss = readFileSync(
  new URL("../../apps/web/src/cartographic-label-placement.css", import.meta.url),
  "utf8",
);

// Isolated CSS hit-testing regression, not application/ACL acceptance.
for (const width of [1440, 390]) {
  test(`detached map caption does not steal a neighboring pin at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.setContent(`
      <style>
        .map { position:relative; width:320px; height:200px;
          --world-map-width:320px; }
        .world-map-marker { position:absolute; top:80px; width:32px;
          height:28px; padding:0; }
        .positioned-cartographic-label { width:180px; height:40px;
          background:#eee; color:#111; }
        #first { left:20px; z-index:2; }
        #second { left:90px; z-index:1; }
      </style>
      <div class="map">
        <button id="first" aria-label="First location"
          class="world-map-marker world-map-marker--configured">
          <span aria-hidden="true">●</span>
          <span class="world-map-marker__label--configured">
            <span class="positioned-cartographic-label">First location</span>
          </span>
        </button>
        <button id="second" aria-label="Second location"
          class="world-map-marker world-map-marker--configured">
          <span aria-hidden="true">●</span>
          <span class="world-map-marker__label--configured">
            <span class="positioned-cartographic-label">Second location</span>
          </span>
        </button>
      </div>
      <output aria-label="Selected location"></output>
      <script>
        document.querySelectorAll('button').forEach(button =>
          button.addEventListener('click', () =>
            document.querySelector('output').textContent = button.id));
      </script>
    `);
    await page.addStyleTag({ content: placementCss });
    const second = page.getByRole("button", { name: "Second location" });
    const target = await second.boundingBox();
    const caption = await page
      .locator("#first .positioned-cartographic-label")
      .boundingBox();
    expect(target).not.toBeNull();
    expect(caption).not.toBeNull();
    const center = {
      x: target!.x + target!.width / 2,
      y: target!.y + target!.height / 2,
    };
    // The caption really covers the pin's center: a non-overlapping fixture
    // would give a vacuous PASS if the pointer-events rule were removed.
    expect(center.x).toBeGreaterThan(caption!.x);
    expect(center.x).toBeLessThan(caption!.x + caption!.width);
    expect(center.y).toBeGreaterThan(caption!.y);
    expect(center.y).toBeLessThan(caption!.y + caption!.height);
    await page.mouse.click(center.x, center.y);
    await expect(page.getByLabel("Selected location")).toHaveText("second");
    await expect(second).toBeFocused();
    await page.getByRole("button", { name: "First location" }).press("Enter");
    await expect(page.getByLabel("Selected location")).toHaveText("first");
  });
}

test("plain scene titles use the same opaque text protection outside marker buttons", async ({ page }) => {
  await page.setContent(`
    <style>:root { --palette-ink-900:#181816; --palette-ink-100:#e8e4da;
      --line-strong:#666; --radius-sm:4px; }
      .map { position:relative; width:320px; height:240px; background:#fff; }
    </style>
    <div class="map" data-cartographic-boundary>
      <h2 class="scene-cartographic-title"><span class="positioned-cartographic-label">
        <span>Длинный заголовок освещённой сцены</span>
      </span></h2>
      <div class="world-space" style="transform:translate(40px,20px) scale(2)"></div>
    </div>
  `);
  await page.addStyleTag({ content: placementCss });
  const title = page.getByRole("heading", { name: "Длинный заголовок освещённой сцены" });
  const text = title.locator(".positioned-cartographic-label > span");
  await expect(text).toHaveCSS("background-color", "rgb(24, 24, 22)");
  await expect(text).toHaveCSS("color", "rgb(232, 228, 218)");
  await expect(title).toHaveCSS("pointer-events", "none");
  const before = await title.boundingBox();
  await page.locator(".world-space").evaluate((element: HTMLElement) => {
    element.style.transform = "translate(-70px,50px) scale(.5)";
  });
  expect(await title.boundingBox()).toEqual(before);
});

for (const width of [1440, 390]) {
  test(`configured captions escape control clipping and protect plain text at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.setContent(`
      <style>
        :root { --palette-ink-900:#202820; --palette-ink-100:#f1f0ed;
          --line-strong:#667766; --radius-sm:4px; }
        .map { position:relative; width:320px; height:200px;
          --world-map-width:320px; background:#fff; }
        .world-map-marker { position:absolute; left:20px; top:80px;
          width:32px; height:28px; padding:0; }
        /* The compact dialog's ordinary controls may clip their contents. */
        .world-maps-workspace :is(button) { overflow:hidden; }
      </style>
      <section class="world-maps-workspace"><div class="map">
        <button class="world-map-marker world-map-marker--configured">
          <span aria-hidden="true">●</span>
          <span class="world-map-marker__label--configured">
            <span class="positioned-cartographic-label"><span>Длинное название пристани</span></span>
          </span>
        </button>
      </div></section>
    `);
    const pin = page.getByRole("button", { name: "Длинное название пристани" });
    await expect(pin).toHaveCSS("overflow", "hidden");
    await page.addStyleTag({ content: placementCss });
    await expect(pin).toHaveCSS("overflow", "visible");
    const text = pin.locator(".positioned-cartographic-label > span");
    await expect(text).toHaveCSS("background-color", "rgb(32, 40, 32)");
    await expect(text).toHaveCSS("color", "rgb(241, 240, 237)");
    await expect(text).toHaveCSS("display", "block");
    await expect(pin.locator(".world-map-marker__label--configured"))
      .toHaveCSS("pointer-events", "none");
  });
}
