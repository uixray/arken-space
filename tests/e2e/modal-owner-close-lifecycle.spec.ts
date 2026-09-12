import { writeFile } from "node:fs/promises";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./react-console-guard";

async function ownedPopup(page: Page, trigger: Locator) {
  await expect(trigger).toHaveAttribute("aria-controls", /.+/);
  const id = (await trigger.getAttribute("aria-controls"))!;
  // UIKit repeats this ID on a list wrapper; require the semantic listbox.
  const listbox = page.locator(`[role="listbox"][id=${JSON.stringify(id)}]`);
  await expect(listbox).toHaveCount(1);
  await expect(listbox).toBeVisible();
  const wrapper = listbox.locator(
    "xpath=ancestor::*[@data-floating-ui-status][1]",
  );
  await expect(wrapper).toHaveAttribute("data-floating-ui-status", "open");
  return { listbox, wrapper };
}

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
  await page
    .getByRole("button", { name: "Открыть первое окно", exact: true })
    .click();
  const a = page.getByRole("dialog", { name: "Первое окно", exact: true });
  const b = page.getByRole("dialog", { name: "Второе окно", exact: true });
  await expect(a).toBeVisible();
  await a
    .getByRole("button", { name: "Открыть после проверки", exact: true })
    .click();
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

// The observer samples computed styles/hit testing in the mutation microtask,
// before UIKit's 100 ms close tail can unmount. It never changes DOM or timing.
async function watchPopup(wrapper: Locator) {
  return wrapper.evaluateHandle((element) => {
    const snapshot = () => {
      const nodes = [element, ...element.querySelectorAll("*")];
      const describe = (node: Element) =>
        `${node.tagName}.${node.getAttribute("class") ?? ""}`;
      const options = [...element.querySelectorAll('[role="option"]')];
      // UIKit 7.43 renders tick icons only for multiple Select. This fixture
      // uses single Select: ListItem marks its selected row with aria-selected.
      const selectedOptions = [
        ...element.querySelectorAll('[role="option"][aria-selected="true"]'),
      ];
      const b = document.querySelector(
        '[role="dialog"][aria-label="Второе окно"]',
      );
      const action = [...(b?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent?.trim() === "Проверить действие B",
      );
      const popupBox = element.getBoundingClientRect();
      const actionBox = action?.getBoundingClientRect();
      const overlap = actionBox
        ? {
            left: Math.max(popupBox.left, actionBox.left),
            top: Math.max(popupBox.top, actionBox.top),
            right: Math.min(popupBox.right, actionBox.right),
            bottom: Math.min(popupBox.bottom, actionBox.bottom),
          }
        : null;
      const point = overlap
        ? {
            x: (overlap.left + overlap.right) / 2,
            y: (overlap.top + overlap.bottom) / 2,
          }
        : null;
      const hit = point ? document.elementFromPoint(point.x, point.y) : null;
      return {
        status: element.getAttribute("data-floating-ui-status"),
        connected: element.isConnected,
        nodeCount: nodes.length,
        popupVisibility: getComputedStyle(
          element.querySelector(".arken-select-popup--modal")!,
        ).visibility,
        visibleNodes: nodes
          .filter((node) => getComputedStyle(node).visibility !== "hidden")
          .map(describe),
        pointerEnabledNodes: nodes
          .filter((node) => getComputedStyle(node).pointerEvents !== "none")
          .map(describe),
        selectedOptions: selectedOptions.map((node) => ({
          label: node.textContent?.trim(),
          visibility: getComputedStyle(node).visibility,
          pointerEvents: getComputedStyle(node).pointerEvents,
        })),
        optionCount: options.length,
        optionHits: options.filter((option) => {
          const box = option.getBoundingClientRect();
          return option.contains(
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            ),
          );
        }).length,
        bExists: Boolean(b),
        bHasFocus: Boolean(b?.contains(document.activeElement)),
        overlap,
        point,
        pointHitsBAction: Boolean(action && hit && action.contains(hit)),
        hit: hit ? describe(hit) : null,
      };
    };
    let close: ReturnType<typeof snapshot> | null = null;
    const statuses: Array<string | null> = [
      element.getAttribute("data-floating-ui-status"),
    ];
    const observer = new MutationObserver(() => {
      const status = element.getAttribute("data-floating-ui-status");
      statuses.push(status);
      if (status === "close" && close === null) close = snapshot();
    });
    observer.observe(element, {
      attributes: true,
      attributeFilter: ["data-floating-ui-status"],
    });
    return {
      snapshot,
      getClose: () => close,
      statuses,
      dispose: () => observer.disconnect(),
    };
  });
}

async function jsonEvidence(testInfo: TestInfo, name: string, data: unknown) {
  const jsonPath = testInfo.outputPath(`${name}.json`);
  await writeFile(jsonPath, JSON.stringify(data, null, 2));
  await testInfo.attach(`${name}-json`, {
    path: jsonPath,
    contentType: "application/json",
  });
}

async function evidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
  data: unknown,
) {
  await jsonEvidence(testInfo, name, data);
  const pngPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: pngPath });
  await testInfo.attach(name, { path: pngPath, contentType: "image/png" });
}

for (const topology of ["sibling", "nested"] as const) {
  test(`UIX-502 natural modal popup close is immediately hidden and inert (${topology}, 390px)`, async ({
    page,
  }, testInfo) => {
    const state = await fixture(page, topology);
    const aTrigger = state.a.getByRole("combobox", {
      name: "A: вариант",
      exact: true,
    });
    await aTrigger.click();
    const popup = await ownedPopup(page, aTrigger);
    const observer = await watchPopup(popup.wrapper);
    try {
      const before = await observer.evaluate((log) => log.snapshot());
      expect(before.status).toBe("open");
      expect(before.popupVisibility).toBe("visible");
      expect(before.selectedOptions).toEqual([
        { label: "A — первый", visibility: "visible", pointerEvents: "auto" },
      ]);
      expect(before.optionHits).toBeGreaterThan(0);

      // Natural path only: no attribute changes, animation overrides or forced
      // pointer events between the open A menu and the held request completing.
      state.releaseCompletion();
      await expect
        .poll(() => observer.evaluate((log) => log.getClose() !== null))
        .toBe(true);
      const close = (await observer.evaluate((log) => log.getClose()))!;
      // JSON is the atomic close observation; this PNG is a later overview,
      // not a claim that a screenshot caught the short natural close frame.
      await evidence(page, testInfo, `natural-close-${topology}`, {
        before,
        close,
      });
      expect(close.status).toBe("close");
      expect(close.connected).toBe(true);
      expect(close.bExists).toBe(true);
      expect(close.nodeCount).toBeGreaterThan(1);
      expect(close.optionCount).toBe(6);
      expect(close.selectedOptions).toEqual([
        { label: "A — первый", visibility: "hidden", pointerEvents: "none" },
      ]);
      expect(close.visibleNodes).toEqual([]);
      expect(close.pointerEnabledNodes).toEqual([]);
      expect(close.optionHits).toBe(0);

      await expect(state.b).toBeVisible();
      await expect
        .poll(() =>
          state.b.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        )
        .toBe(true);
      await state.b
        .getByRole("button", { name: "Проверить действие B", exact: true })
        .click();
      await expect(page.getByTestId("b-pointer-actions")).toHaveText("1");
      await expect(page.getByTestId("a-value")).toHaveText("a-one");
      await expect(page.getByTestId("a-selections")).toHaveText("0");
      expect(state.errors).toEqual([]);
      expect(state.unexpectedApiRequests).toEqual([]);
    } finally {
      state.cancel();
      try {
        await jsonEvidence(
          testInfo,
          `natural-close-${topology}-observer-final`,
          await observer.evaluate((log) => ({
            statuses: log.statuses,
            close: log.getClose(),
          })),
        );
      } finally {
        await observer.evaluate((log) => log.dispose());
        await observer.dispose();
      }
    }
  });
}

test("UIX-502 held close attribute CSS contract hides the complete modal popup tree; open keyboard control survives", async ({
  page,
}, testInfo) => {
  const state = await fixture(page, "nested");
  state.releaseCompletion();
  await expect(state.b).toBeVisible();
  const trigger = state.b.getByRole("combobox", {
    name: "B: вариант",
    exact: true,
  });
  await trigger.click();
  const popup = await ownedPopup(page, trigger);
  await popup.listbox
    .getByRole("option", { name: "B — первый", exact: true })
    .hover();
  const observer = await watchPopup(popup.wrapper);
  const heldWrapper = await popup.wrapper.elementHandle();
  let statusToRestore: string | null = null;
  try {
    const before = await observer.evaluate((log) => log.snapshot());
    expect(before.status).toBe("open");
    expect(before.popupVisibility).toBe("visible");
    expect(before.optionHits).toBeGreaterThan(0);
    expect(before.selectedOptions).toEqual([
      { label: "B — первый", visibility: "visible", pointerEvents: "auto" },
    ]);

    // Explicit CSS-state contract, NOT natural lifecycle proof: UIKit remains
    // internally open so the exact close attribute can be held for geometry
    // and screenshot evidence. No styles, animation clocks or layers change.
    statusToRestore = before.status;
    await heldWrapper!.evaluate((element) =>
      element.setAttribute("data-floating-ui-status", "close"),
    );
    const close = await observer.evaluate((log) => log.snapshot());
    await evidence(page, testInfo, "held-close-css-contract", {
      before,
      close,
      syntheticStatus: true,
    });
    expect(close.status).toBe("close");
    expect(close.connected).toBe(true);
    expect(close.optionCount).toBe(3);
    expect(close.selectedOptions).toEqual([
      { label: "B — первый", visibility: "hidden", pointerEvents: "none" },
    ]);
    expect(close.visibleNodes).toEqual([]);
    expect(close.pointerEnabledNodes).toEqual([]);
    expect(close.optionHits).toBe(0);
    expect(close.overlap).not.toBeNull();
    expect(close.overlap!.right - close.overlap!.left).toBeGreaterThan(2);
    expect(close.overlap!.bottom - close.overlap!.top).toBeGreaterThan(2);
    expect(close.pointHitsBAction).toBe(true);

    // Restore the observed real status, then prove the same real open Select
    // still owns keyboard selection and updates only B through fixture state.
    await heldWrapper!.evaluate(
      (element, status) =>
        element.setAttribute("data-floating-ui-status", status),
      before.status!,
    );
    statusToRestore = null;
    await expect(popup.listbox).toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("ArrowDown");
    const secondOption = popup.listbox.getByRole("option", {
      name: "B — второй",
      exact: true,
    });
    const secondId = await secondOption.getAttribute("id");
    expect(secondId).toBeTruthy();
    await expect(trigger).toHaveAttribute("aria-activedescendant", secondId!);
    await page.keyboard.press("Enter");
    await expect(popup.listbox).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.getByTestId("b-value")).toHaveText("b-two");
    await expect(page.getByTestId("b-selections")).toHaveText("1");
    await expect(page.getByTestId("a-value")).toHaveText("a-one");
    await expect(page.getByTestId("a-selections")).toHaveText("0");
    expect(state.errors).toEqual([]);
    expect(state.unexpectedApiRequests).toEqual([]);
  } finally {
    state.cancel();
    try {
      await jsonEvidence(
        testInfo,
        "held-close-css-contract-observer-final",
        await observer.evaluate((log) => ({
          syntheticStatus: true,
          statuses: log.statuses,
          close: log.getClose(),
        })),
      );
    } finally {
      try {
        if (statusToRestore !== null) {
          await heldWrapper!.evaluate((element, status) => {
            if (element.isConnected)
              element.setAttribute("data-floating-ui-status", status);
          }, statusToRestore);
        }
      } finally {
        await observer.evaluate((log) => log.dispose());
        await observer.dispose();
        await heldWrapper?.dispose();
      }
    }
  }
});
