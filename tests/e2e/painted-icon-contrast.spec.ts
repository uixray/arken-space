import { expect, test } from "@playwright/test";
import {
  paintedIconContrast,
  settleIconState,
} from "./helpers/painted-icon-contrast";

test("icon contrast oracle models settled Gravity backing and rejects unsupported paint", async ({
  page,
}) => {
  await page.setContent(`<style>
    body { background:white; margin:0; }
    button { width:40px; height:40px; position:relative; transform:scale(1); color:black; background:transparent; border:0; }
    button::before { content:""; position:absolute; inset:0; z-index:-1; border-radius:4px; background:rgba(0,0,0,0); transition:background-color .15s linear; }
    button:hover::before { background:rgba(0,0,0,.5); }
    svg { display:block; width:16px; height:16px; margin:auto; }
  </style><button class="g-button" aria-label="Oracle"><svg stroke="currentColor" fill="none"><path d="M2 2L14 14"/></svg></button>`);
  const control = page.getByRole("button");
  const icon = control.locator("svg");
  await page.mouse.move(300, 300);
  await settleIconState(control);
  expect(await paintedIconContrast(icon)).toBeCloseTo(21, 3);
  await control.hover();
  await settleIconState(control);
  expect(await paintedIconContrast(icon)).toBeCloseTo(5.2808, 3);
  await page.mouse.move(300, 300);
  await settleIconState(control);
  expect(await paintedIconContrast(icon)).toBeCloseTo(21, 3);
  await icon.locator("path").evaluate((el) => el.setAttribute("stroke", "red"));
  await expect(paintedIconContrast(icon)).rejects.toThrow(
    "Unmodelled SVG descendant paint",
  );
  await icon.locator("path").evaluate((el) => el.removeAttribute("stroke"));
  await control.evaluate((el) => (el.style.opacity = "0.5"));
  await expect(paintedIconContrast(icon)).rejects.toThrow("opacity-aware");
  await control.evaluate((el) => {
    el.style.opacity = "1";
    el.style.backgroundImage = "linear-gradient(white, black)";
  });
  await expect(paintedIconContrast(icon)).rejects.toThrow(
    "image/opacity-aware",
  );
  await control.evaluate((el) => {
    el.style.backgroundImage = "none";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:40px;height:40px";
    el.append(canvas);
  });
  await expect(paintedIconContrast(icon)).rejects.toThrow(
    "crosses a media surface",
  );
});

test("contrast oracle converts opaque Lab and still rejects unsupported paint", async ({
  page,
}) => {
  await page.setContent(
    `<div style="background:lab(100 0 0)"><svg style="color:lab(0 0 0)" width="16" height="16"><path d="M0 8H16" stroke="currentColor" fill="none" /></svg></div>`,
  );
  const icon = page.locator("svg");
  expect(await paintedIconContrast(icon)).toBeCloseTo(21, 1);
  await icon.evaluate((node) => {
    (node as SVGElement).style.color = "lab(50 0 0)";
  });
  expect(await paintedIconContrast(icon)).toBeCloseTo(4.48, 1);
  await icon.evaluate((node) => {
    (node as SVGElement).style.color = "lab(0 0 0 / .5)";
  });
  await expect(paintedIconContrast(icon)).rejects.toThrow(
    "Unsupported computed color",
  );
  await icon.evaluate((node) => {
    (node as SVGElement).style.color = "black";
    (node.parentElement as HTMLElement).style.backgroundImage =
      "linear-gradient(white, black)";
  });
  await expect(paintedIconContrast(icon)).rejects.toThrow(
    "image/opacity-aware",
  );
});
