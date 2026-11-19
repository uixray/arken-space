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
