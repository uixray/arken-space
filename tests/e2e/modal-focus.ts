import { expect, type Locator, type Page } from "@playwright/test";

/** Base UI wraps focus through its own guard spans beside the dialog popup. */
export async function assertModalFocusCycle(
  page: Page,
  dialog: Locator,
  key: "Tab" | "Shift+Tab" = "Tab",
  presses = 8,
) {
  await expect(dialog).toBeVisible();
  const recorder = await dialog.evaluateHandle((element) => {
    const wrapper = element.closest(".g-modal__content-wrapper");
    if (!wrapper) throw new Error("Modal focus owner is missing");
    const state = { guardVisits: 0, violations: [] as string[] };
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || element.contains(target)) return;
      if (
        target instanceof HTMLElement &&
        target.matches("[data-base-ui-focus-guard]") &&
        target.parentElement === wrapper
      ) {
        state.guardVisits += 1;
        return;
      }
      state.violations.push(`${target.tagName}#${target.id}`);
    };
    document.addEventListener("focusin", onFocus, true);
    return {
      state,
      dispose: () => document.removeEventListener("focusin", onFocus, true),
    };
  });
  const assertInside = () =>
    expect
      .poll(() =>
        dialog.evaluate((element) => element.contains(document.activeElement)),
      )
      .toBe(true);
  const assertNoEscape = async () =>
    expect(await recorder.evaluate(({ state }) => state.violations)).toEqual(
      [],
    );
  try {
    await assertInside();
    await assertNoEscape();
    for (let index = 0; index < presses; index += 1) {
      await page.keyboard.press(key);
      // A background focus hop is a failure even if the trap later recovers.
      await assertNoEscape();
      await assertInside();
      await assertNoEscape();
    }
    return await recorder.evaluate(({ state }) => state.guardVisits);
  } finally {
    await recorder.evaluate(({ dispose }) => dispose());
    await recorder.dispose();
  }
}
