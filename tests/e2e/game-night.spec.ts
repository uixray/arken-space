import { expect, test } from "@playwright/test";

test("master can exchange the access link for a browser session", async ({
  page,
}) => {
  const token = process.env.GM_ACCESS_TOKEN;
  test.skip(
    !token,
    "GM_ACCESS_TOKEN is required for the integration environment",
  );
  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText("arken-space").first()).toBeVisible();
  await expect(page.getByText("Подготовка")).toBeVisible();
  await expect(page).toHaveURL("/");
});
