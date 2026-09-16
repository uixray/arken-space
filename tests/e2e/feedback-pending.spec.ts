import { expect, test } from "./react-console-guard";
import type { Route } from "@playwright/test";
for (const width of [1280, 360]) {
  test(`UIX-317 feedback pending fields preserve submitted draft ${width}`, async ({
    page,
  }, info) => {
    const pending: Route[] = [];
    const payloads: unknown[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/bootstrap", (route) =>
      route.fulfill({ status: 401, json: {} }),
    );
    await page.route("**/api/feedback/suggestions", (route) => {
      payloads.push(route.request().postDataJSON());
      pending.push(route);
    });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const text = page.getByLabel("Предложение", { exact: true });
    const contact = page.getByLabel(/Контакт/);
    const send = page.getByRole("button", {
      name: "Отправить предложение",
      exact: true,
    });
    const form = page.locator(".feedback-form");
    try {
      await text.fill("Добавьте удобные заметки");
      await contact.fill("@player");
      await send.click();
      await expect.poll(() => pending.length).toBe(1);
      await expect(text).not.toBeEditable();
      await expect(contact).not.toBeEditable();
      await expect(form).toHaveAttribute("aria-busy", "true");
      await expect(send).toBeDisabled();
      await text.focus();
      await text.press("ControlOrMeta+A");
      await text.press("Backspace");
      await expect(text).toHaveValue("Добавьте удобные заметки");
      expect(
        await text.evaluate(
          (node) => (node as HTMLTextAreaElement).selectionEnd,
        ),
      ).toBe("Добавьте удобные заметки".length);
      expect(payloads).toHaveLength(1);
      await pending
        .shift()!
        .fulfill({
          status: 503,
          json: {
            error: "UNAVAILABLE",
            message: "Отправка временно недоступна",
          },
        });
      await expect(page.getByRole("alert")).toHaveText(
        "Отправка временно недоступна",
      );
      await expect(text).toBeEditable();
      await expect(contact).toBeEditable();
      await expect(form).toHaveAttribute("aria-busy", "false");
      await expect(text).toHaveValue("Добавьте удобные заметки");
      await expect(contact).toHaveValue("@player");
      await text.fill("Уточнённое предложение");
      await send.click();
      await expect.poll(() => pending.length).toBe(1);
      await expect(text).not.toBeEditable();
      await pending.shift()!.fulfill({ status: 201, json: { ok: true } });
      await expect(page.getByRole("status")).toContainText(
        "Спасибо, предложение отправлено",
      );
      await page
        .getByRole("button", { name: "Отправить ещё", exact: true })
        .click();
      await expect(text).toHaveValue("");
      await expect(contact).toHaveValue("");
      await expect(text).toBeEditable();
      expect(payloads).toEqual([
        {
          description: "Добавьте удобные заметки",
          contact: "@player",
          website: "",
        },
        {
          description: "Уточнённое предложение",
          contact: "@player",
          website: "",
        },
      ]);
      expect(errors).toEqual([]);
      await info.attach("feedback-pending", {
        body: JSON.stringify({ width, requests: payloads.length, errors }),
        contentType: "application/json",
      });
    } finally {
      for (const route of pending)
        await route
          .fulfill({ status: 503, json: { error: "TEST_CLEANUP" } })
          .catch(() => undefined);
    }
  });
}
