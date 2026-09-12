import { stripVTControlCharacters } from "node:util";
import { expect, test } from "./react-console-guard";
import { playerSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { assertModalFocusCycle } from "./modal-focus";

for (const width of [360, 820]) {
  test(`UIX-644 modal focus wraps through owned guards without background escape ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1180 });
    const snapshot = playerSnapshot({ schemaVersion: 2 });
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({
        json: path === "/api/bootstrap" ? snapshot : [],
      });
    });
    await page.goto("/");
    await page.getByLabel("Меню сеанса", { exact: true }).click();
    await page
      .locator(".account-menu")
      .getByRole("button", {
        name: "Сменить игрока",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Сменить игрока?",
      exact: true,
    });
    expect(await assertModalFocusCycle(page, dialog)).toBeGreaterThan(0);
    expect(
      await assertModalFocusCycle(page, dialog, "Shift+Tab"),
    ).toBeGreaterThan(0);
    // Controlled diversion: block only this modal's guard redirection. The
    // oracle must reject a guard that never returns focus into the dialog.
    const blockedGuard = await dialog.evaluateHandle((element) => {
      const wrapper = element.parentElement;
      const stopGuard = (event: FocusEvent) => {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.parentElement === wrapper &&
          target.matches('[data-floating-ui-focus-guard][data-type="inside"]')
        ) {
          event.stopImmediatePropagation();
        }
      };
      document.addEventListener("focusin", stopGuard, true);
      return () => document.removeEventListener("focusin", stopGuard, true);
    });
    try {
      let failure: unknown;
      try {
        await assertModalFocusCycle(page, dialog);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      const message = stripVTControlCharacters((failure as Error).message);
      expect(message).toContain("Expected: true");
      expect(message).toContain("Received: false");
      expect(message).toContain("while waiting on the predicate");
    } finally {
      await blockedGuard.evaluate((dispose) => dispose());
      await blockedGuard.dispose();
    }
    await dialog.getByRole("button", { name: "Отмена", exact: true }).focus();
    expect(await assertModalFocusCycle(page, dialog)).toBeGreaterThan(0);
    await expect(
      page.locator("#compact-nav-map").click({ trial: true, timeout: 600 }),
    ).rejects.toThrow();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("navigation", { name: "Основные области" }),
    ).toBeVisible();
  });
}
