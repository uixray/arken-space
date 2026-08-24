import { expect, test } from "@playwright/test";
import { openWorkspaceSection } from "./workspace-nav-helper";

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
  // UIX-472 moved the workspace sections into a row that hides the overflow
  // behind «Ещё», so «Подготовка» is no longer a top-level button and a bare
  // text lookup also matches its inner span. The shared helper finds the
  // section in whichever place the current width put it; opening it is what
  // proves the exchanged session really carries GM authority.
  await openWorkspaceSection(page, "Подготовка");
  await expect(page.getByRole("dialog", { name: "Подготовка" })).toBeVisible();
  await expect(page).toHaveURL("/");
});
