import { expect, type Locator } from "@playwright/test";

/** Actual painted default-theme menu mark, not a source-token assertion. */
export async function expectSelectedMenuIcon(control: Locator) {
  await expect(control).toHaveAttribute("aria-checked", "true");
  const icon = control.locator("svg.arken-icon");
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute("aria-hidden", "true");
  await expect(icon).toHaveAttribute("focusable", "false");
  await expect(icon).toHaveAttribute("stroke", "currentColor");
  await expect(icon).toHaveAttribute("stroke-width", "2");
  // The selected label and its mark share currentColor. Require the stronger
  // normal-text threshold, not just the 3:1 non-text/icon threshold.
  expect(
    await icon.evaluate((element) => getComputedStyle(element).color),
  ).toBe(await control.evaluate((element) => getComputedStyle(element).color));
  const box = await control.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(24);
  expect(box!.height).toBeGreaterThanOrEqual(24);
  const contrast = await icon.evaluate((element) => {
    const parse = (color: string) => {
      const match = color.match(/^rgba?\(([^)]+)\)$/);
      if (!match) throw new Error(`Unsupported computed color: ${color}`);
      const values = match[1].split(/[,\s/]+/).map(Number);
      return [values[0], values[1], values[2], values[3] ?? 1];
    };
    const over = (front: number[], back: number[]) =>
      front
        .slice(0, 3)
        .map((value, i) => value * front[3] + back[i] * (1 - front[3]));
    const backgrounds: number[][] = [];
    let opaque = false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      // Group opacity still affects descendants; backgrounds behind an opaque
      // menu surface (including the map image) do not.
      if (
        Number(style.opacity) !== 1 ||
        (!opaque && style.backgroundImage !== "none")
      )
        throw new Error("Menu contrast needs image/opacity-aware measurement");
      if (!opaque) {
        const color = parse(style.backgroundColor);
        backgrounds.unshift(color);
        opaque = color[3] === 1;
      }
    }
    if (!opaque) throw new Error("No opaque menu backing surface");
    const background = backgrounds.reduce(
      (back, front) => over(front, back),
      [0, 0, 0],
    );
    const foreground = over(parse(getComputedStyle(element).color), background);
    const luminance = (rgb: number[]) =>
      rgb
        .map((value) => {
          const s = value / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        })
        .reduce(
          (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
          0,
        );
    const a = luminance(foreground);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(
    contrast,
    "Selected menu mark contrast against its painted surface",
  ).toBeGreaterThanOrEqual(4.5);
  return contrast;
}
