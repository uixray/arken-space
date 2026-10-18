import { expect, test } from "./react-console-guard";
import { observePingOverlay } from "../multiplayer/ping-pixel-observer";

const color = "rgb(240, 80, 160)";

test.beforeEach(async ({ page }) => {
  // Deliberately offset and 2x backing resolution: DOM position and CSS pixels
  // must determine the final composite, not raw canvas-buffer coordinates.
  await page.setContent(`<div class="map-viewport" style="position:relative;margin:30px;width:300px;height:240px">
    <div style="position:absolute;left:20px;top:10px">
      <canvas id="below" width="560" height="460" style="position:absolute;width:280px;height:230px"></canvas>
      <canvas id="fog" width="560" height="460" style="position:absolute;width:280px;height:230px"></canvas>
      <canvas id="above" width="560" height="460" style="position:absolute;width:280px;height:230px;opacity:0.6"></canvas>
    </div></div>`);
  await page.locator("#fog").evaluate((node: HTMLCanvasElement) => {
    const ctx = node.getContext("2d")!;
    ctx.fillStyle = "#080807";
    ctx.fillRect(0, 0, node.width, node.height);
  });
});

test("ping pixel observer retains a visible transient composite frame", async ({
  page,
}) => {
  const observer = await observePingOverlay(
    page.locator(".map-viewport"),
    { x: 150, y: 120 },
    color,
  );
  try {
    await page
      .locator("#above")
      .evaluate(async (node: HTMLCanvasElement, stroke) => {
        const ctx = node.getContext("2d")!;
        ctx.scale(2, 2);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(130, 110, 24, 0, Math.PI * 2);
        ctx.stroke();
        // Clear before the runner reads the result; the exact matched frame,
        // rather than a later screenshot after expiry, must remain as evidence.
        for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
        ctx.clearRect(0, 0, node.width, node.height);
      }, color);
    const result = await observer.result();
    expect(result.elapsedMs).toBeLessThan(3_000);
    expect(result.maxMatchedPixels).toBeGreaterThanOrEqual(24);
    expect(result.after).not.toBe(result.before);
    expect(result.after).toMatch(/^data:image\/png;base64,/);
  } finally {
    await observer.dispose();
  }
});

for (const failure of [
  "missing",
  "below-fog",
  "hidden",
  "wrong-colour",
  "elsewhere",
] as const) {
  test(`ping pixel observer rejects ${failure} overlay`, async ({ page }) => {
    const observer = await observePingOverlay(
      page.locator(".map-viewport"),
      { x: 150, y: 120 },
      color,
    );
    try {
      await page.evaluate(
        ({ failure, color }) => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            failure === "below-fog" ? "#below" : "#above",
          )!;
          if (failure === "hidden") canvas.style.visibility = "hidden";
          const ctx = canvas.getContext("2d")!;
          ctx.scale(2, 2);
          if (failure !== "missing") {
            ctx.strokeStyle =
              failure === "wrong-colour" ? "rgb(80, 240, 120)" : color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(
              failure === "elsewhere" ? 230 : 130,
              110,
              24,
              0,
              Math.PI * 2,
            );
            ctx.stroke();
          }
          // A visible unrelated map change cannot satisfy the local ring oracle.
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, 20, 20);
        },
        { failure, color },
      );
      await expect(observer.result()).rejects.toThrow(
        "Ping pixels not visible over fog within 3000ms (max=0): no matching lower arc",
      );
    } finally {
      await observer.dispose();
    }
  });
}
