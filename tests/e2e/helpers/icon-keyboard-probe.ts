import type { Locator, Page } from "@playwright/test";

/** One read per real keyboard step; never simulates focus or navigation. */
export async function readIconKeyboardFocus(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector(":focus");
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      tagName: element.tagName,
      id: element.getAttribute("data-icon-keyboard-gate"),
      role: element.getAttribute("role"),
      visible: element.matches(":focus-visible"),
      outline:
        style.outlineStyle !== "none" &&
        parseFloat(style.outlineWidth) > 0 &&
        style.outlineColor !== "rgba(0, 0, 0, 0)",
      shadow: style.boxShadow !== "none",
    };
  });
}

/** Tag in DOM order; Playwright retains native/ARIA enabled assertions. */
export async function tagIconKeyboardControls(controls: Locator) {
  await controls.evaluateAll((elements) => {
    elements.forEach((element, index) => {
      element.setAttribute("data-icon-keyboard-gate", String(index));
    });
  });
}
