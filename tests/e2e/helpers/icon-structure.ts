import type { Locator } from "@playwright/test";

/** Batch static reads; accessible-name and real keyboard checks stay with Playwright. */
export async function inspectIconStructure(icons: Locator, controls: Locator) {
  const svg = await icons.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        hidden: element.getAttribute("aria-hidden"),
        focusable: element.getAttribute("focusable"),
        stroke: element.getAttribute("stroke"),
        strokeWidth: element.getAttribute("stroke-width"),
        width: box.width,
        height: box.height,
      };
    }),
  );
  const hitAreas = await controls.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  if (svg.length <= 5)
    throw new Error("Expected more than five visible shell icons");
  for (const [index, icon] of svg.entries()) {
    if (
      icon.hidden !== "true" ||
      icon.focusable !== "false" ||
      icon.stroke !== "currentColor" ||
      icon.strokeWidth !== "2"
    )
      throw new Error(`SVG contract violation at ${index}`);
    if (!(icon.width > 0 && icon.height > 0))
      throw new Error(`Invisible SVG geometry at ${index}`);
  }
  for (const [index, area] of hitAreas.entries())
    if (!(area.width >= 24 && area.height >= 24))
      throw new Error(`Icon control hit area below24px at ${index}`);
  return { svg, hitAreas };
}
