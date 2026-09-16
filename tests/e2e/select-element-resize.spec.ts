import { expect, test } from "./react-console-guard";

for (const width of [1280, 390]) {
  test(`UIX-644 open Select follows its field resize at ${width}px`, async ({
    page,
  }, testInfo) => {
    const windowErrors: string[] = [];
    await page.exposeFunction("recordSelectResizeError", (message: string) => {
      windowErrors.push(message);
    });
    await page.addInitScript(() => {
      window.addEventListener("error", (event) => {
        const report = (
          window as Window & {
            recordSelectResizeError: (message: string) => Promise<void>;
          }
        ).recordSelectResizeError;
        void report(event.message);
      });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tests/fixtures/modal-owner/?topology=sibling");
    await page.getByRole("button", { name: "Открыть первое окно" }).click();
    const dialog = page.getByRole("dialog", { name: "Первое окно" });
    const trigger = dialog.getByRole("combobox", { name: "A: вариант" });
    // Only the fixture field's containing block changes size. The real Select,
    // popup, observer scheduling, owner, focus and error handling are untouched.
    const field = trigger.locator(
      "xpath=ancestor::div[span[text()='A: вариант']]",
    );
    const wide = width === 390 ? 240 : 320;
    await field.evaluate((node, size) => {
      (node as HTMLElement).style.width = `${size}px`;
      const select = node.querySelector<HTMLElement>(".g-select");
      if (!select) throw new Error("Missing fixture Select");
      select.style.width = "100%";
    }, wide);
    await trigger.click();
    const popup = page.locator(".arken-form-select-popup");
    const content = popup.locator(".arken-form-select-popup__content");
    await expect(popup).toBeVisible();
    const receipt: Array<Record<string, unknown>> = [];
    for (const target of [160, wide]) {
      await field.evaluate(async (node, size) => {
        const element = node as HTMLElement;
        const from = element.getBoundingClientRect().width;
        const animation = element.animate(
          [{ width: `${from}px` }, { width: `${size}px` }],
          { duration: 240, easing: "linear", fill: "forwards" },
        );
        await animation.finished;
        element.style.width = `${size}px`;
        animation.cancel();
      }, target);
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect
        .poll(async () => {
          const fieldBox = await trigger.boundingBox();
          const popupBox = await content.boundingBox();
          return Math.abs((fieldBox?.width ?? -1000) - (popupBox?.width ?? 0));
        })
        .toBeLessThanOrEqual(2);
      const geometry = await popup.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          x: box.x,
          right: box.right,
          width: box.width,
          viewport: innerWidth,
        };
      });
      expect(geometry.x).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width);
      receipt.push({ target, ...geometry });
      await expect(trigger).toHaveText("A — первый");
    }
    const option = popup.getByRole("option", {
      name: "A — второй",
      exact: true,
    });
    await expect
      .poll(() =>
        option.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            ),
          );
        }),
      )
      .toBe(true);
    await option.click();
    await expect(trigger).toHaveText("A — второй");
    await expect(trigger).toBeFocused();
    await expect(page.getByTestId("a-selections")).toHaveText("1");
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(trigger).toBeFocused();
    await testInfo.attach("select-element-resize", {
      body: JSON.stringify({ width, receipt, windowErrors }),
      contentType: "application/json",
    });
    expect(windowErrors).toEqual([]);
  });
}
