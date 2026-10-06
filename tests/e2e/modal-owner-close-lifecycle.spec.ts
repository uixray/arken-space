import type { Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";

async function fixture(page: Page, topology: "sibling" | "nested") {
  const errors: string[] = [];
  const unexpectedApiRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    unexpectedApiRequests.push(
      `${route.request().method()} ${new URL(route.request().url()).pathname}`,
    );
    await route.abort("blockedbyclient");
  });
  let releaseCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    releaseCompletion = resolve;
  });
  let completionRequests = 0;
  let cancelled = false;
  await page.route("**/__modal_owner_fixture__/complete", async (route) => {
    completionRequests += 1;
    await completion;
    if (cancelled) await route.abort("blockedbyclient");
    else await route.fulfill({ json: { complete: true } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `/tests/fixtures/modal-owner/index.html?topology=${topology}`,
  );
  await expect(page.getByTestId("fixture")).toHaveAttribute(
    "data-topology",
    topology,
  );
  await page.getByRole("button", { name: "Открыть первое окно" }).click();
  const a = page.getByRole("dialog", {
    name: "Первое окно",
    includeHidden: true,
  });
  const b = page.getByRole("dialog", { name: "Второе окно" });
  await expect(a).toBeVisible();
  await a.getByRole("button", { name: "Открыть после проверки" }).click();
  await expect.poll(() => completionRequests).toBe(1);
  return {
    a,
    b,
    errors,
    unexpectedApiRequests,
    releaseCompletion,
    cancel: () => {
      cancelled = true;
      releaseCompletion();
    },
  };
}

for (const topology of ["sibling", "nested"] as const) {
  test(`UIX-502 previous modal Select closes before next modal owns pointers (${topology}, 390px)`, async ({
    page,
  }) => {
    const state = await fixture(page, topology);
    try {
      const trigger = state.a.getByRole("combobox", {
        name: "A: вариант",
        includeHidden: true,
      });
      await trigger.click();
      const listbox = page.locator(
        `[role="listbox"][id=${JSON.stringify(await trigger.getAttribute("aria-controls"))}]`,
      );
      await expect(listbox).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      state.releaseCompletion();
      await expect(state.b).toBeVisible();
      await expect(listbox).toBeHidden();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await state.b
        .getByRole("button", { name: "Проверить действие B" })
        .click();
      await expect(page.getByTestId("b-pointer-actions")).toHaveText("1");
      await expect(page.getByTestId("a-selections")).toHaveText("0");
      expect(state.errors).toEqual([]);
      expect(state.unexpectedApiRequests).toEqual([]);
    } finally {
      state.cancel();
    }
  });
}

test("UIX-502 closed Select is inert and can reopen inside its modal", async ({
  page,
}) => {
  const state = await fixture(page, "nested");
  try {
    state.releaseCompletion();
    await expect(state.b).toBeVisible();
    const trigger = state.b.getByRole("combobox", { name: "B: вариант" });
    await trigger.click();
    const listbox = page.locator(
      `[role="listbox"][id=${JSON.stringify(await trigger.getAttribute("aria-controls"))}]`,
    );
    await expect(listbox).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(state.b).toBeVisible();
    await trigger.click();
    await expect(listbox).toBeVisible();
    await listbox.getByRole("option", { name: "B — второй" }).click();
    await expect(listbox).toBeHidden();
    await expect(page.getByTestId("b-value")).toHaveText("b-two");
    await expect(page.getByTestId("b-selections")).toHaveText("1");
    await expect(page.getByTestId("a-selections")).toHaveText("0");
    expect(state.errors).toEqual([]);
    expect(state.unexpectedApiRequests).toEqual([]);
  } finally {
    state.cancel();
  }
});
