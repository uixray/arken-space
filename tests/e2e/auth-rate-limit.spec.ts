import { expect, test } from "./react-console-guard";
for (const width of [1280, 360]) {
  test(`UIX-417 invite rate-limit guidance preserves draft ${width}`, async ({
    page,
  }, info) => {
    const attempts: unknown[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/bootstrap", (route) =>
      route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } }),
    );
    await page.route("**/api/auth/invite", (route) => {
      attempts.push(route.request().postDataJSON());
      return route.fulfill({
        status: 429,
        headers: attempts.length === 1 ? { "retry-after": "60" } : {},
        json: {
          error: "REQUEST_FAILED",
          message: "Не удалось выполнить запрос",
        },
      });
    });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/join/rate-limit-test");
    const name = page.getByLabel("Имя", { exact: true });
    await name.fill("Игрок с черновиком");
    const enter = page.getByRole("button", { name: "Войти", exact: true });
    await enter.click();
    const alert = page.getByRole("alert");
    await expect(alert).toHaveText(
      "Слишком много запросов. Повторите попытку через 60 с.",
    );
    await expect(name).toHaveValue("Игрок с черновиком");
    await expect(enter).toBeEnabled();
    await alert.scrollIntoViewIfNeeded();
    const box = (await alert.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(attempts).toHaveLength(1);
    await enter.focus();
    await enter.press("Enter");
    await expect(alert).toHaveText(
      "Слишком много запросов. Подождите немного и повторите попытку.",
    );
    expect(attempts).toEqual([
      { token: "rate-limit-test", displayName: "Игрок с черновиком" },
      { token: "rate-limit-test", displayName: "Игрок с черновиком" },
    ]);
    await expect(name).toHaveValue("Игрок с черновиком");
    expect(errors).toEqual([]);
    await info.attach("rate-limit-receipt", {
      body: JSON.stringify({ width, attempts: attempts.length, errors }),
      contentType: "application/json",
    });
  });
}
