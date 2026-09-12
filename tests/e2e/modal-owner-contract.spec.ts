import { writeFile } from "node:fs/promises";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { assertModalFocusCycle } from "./modal-focus";

async function ownedPopup(page: Page, trigger: Locator) {
  await expect(trigger).toHaveAttribute("aria-controls", /.+/);
  const id = (await trigger.getAttribute("aria-controls"))!;
  // UIKit's list wrapper and semantic listbox share the same ID. Preserve
  // exact trigger ownership and select the unique semantic node, not an index.
  const listbox = page.locator(`[role="listbox"][id=${JSON.stringify(id)}]`);
  await expect(listbox).toHaveCount(1);
  await expect(listbox).toHaveAttribute("role", "listbox");
  await expect(listbox).toBeVisible();
  const wrapper = listbox.locator(
    "xpath=ancestor::*[@data-floating-ui-status][1]",
  );
  await expect(wrapper).toHaveCount(1);
  return { id, listbox, wrapper };
}

async function assertCenterHit(target: Locator) {
  await expect
    .poll(() =>
      target.evaluate((element) => {
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
}

async function assertPopupFits(
  popup: Locator,
  viewport: { width: number; height: number },
) {
  const box = await popup.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function overlayLayers(page: Page) {
  return page
    .locator(".g-modal, .arken-form-select-popup")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const chain: Array<Record<string, unknown>> = [];
        for (
          let element: Element | null = node;
          element;
          element = element.parentElement
        ) {
          const style = getComputedStyle(element);
          chain.push({
            tag: element.tagName,
            id: element.id,
            className: element.getAttribute("class"),
            zIndex: style.zIndex,
            position: style.position,
            transform: style.transform,
            overflow: style.overflow,
            opacity: style.opacity,
          });
        }
        return chain;
      }),
    );
}

for (const topology of ["sibling", "nested"] as const) {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`UIX-502 modal-owner contract ${topology} at ${viewport.width}px`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(60_000);
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

      await page.setViewportSize(viewport);
      await page.goto(
        `/tests/fixtures/modal-owner/index.html?topology=${topology}`,
      );
      await expect(page.getByTestId("fixture")).toHaveAttribute(
        "data-topology",
        topology,
      );
      const focusLog = await page.evaluateHandle(() => {
        const events: Array<Record<string, unknown>> = [];
        const record = (event: FocusEvent) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          events.push({
            at: performance.now(),
            tag: target.tagName,
            id: target.id,
            role: target.getAttribute("role"),
            label: target.getAttribute("aria-label"),
            owner: target
              .closest('[role="dialog"]')
              ?.getAttribute("aria-label"),
            listbox: target.closest('[role="listbox"]')?.id,
            guard: target.getAttribute("data-type"),
          });
        };
        document.addEventListener("focusin", record, true);
        return {
          events,
          dispose: () => document.removeEventListener("focusin", record, true),
        };
      });
      const diagnostics: Record<string, unknown> = { topology, viewport };

      try {
        const baseOpener = page.getByRole("button", {
          name: "Открыть первое окно",
          exact: true,
        });
        await baseOpener.click();
        const a = page.getByRole("dialog", {
          name: "Первое окно",
          exact: true,
          includeHidden: true,
        });
        const b = page.getByRole("dialog", {
          name: "Второе окно",
          exact: true,
          includeHidden: true,
        });
        await expect(a).toBeVisible();
        await expect(b).toHaveCount(0);
        const aTrigger = a.getByRole("combobox", {
          name: "A: вариант",
          exact: true,
        });
        await a
          .getByRole("button", { name: "Открыть после проверки", exact: true })
          .click();
        await expect.poll(() => completionRequests).toBe(1);
        await aTrigger.click();
        const aPopup = await ownedPopup(page, aTrigger);
        const aOption = aPopup.listbox.getByRole("option", {
          name: "A — второй",
          exact: true,
        });
        await aOption.hover();
        await assertCenterHit(aOption);
        await assertPopupFits(aPopup.wrapper, viewport);
        // Gravity's non-filterable Select leaves focus on its actual trigger.
        // This observed target, not a guessed async-button target, must regain it.
        await expect(aTrigger).toBeFocused();
        await expect(page.getByTestId("a-selections")).toHaveText("0");
        const oldPopupBox = await aPopup.wrapper.boundingBox();
        expect(oldPopupBox).not.toBeNull();
        diagnostics.oldPopup = { id: aPopup.id, box: oldPopupBox };
        diagnostics.layersBeforeB = await overlayLayers(page);
        await screenshot(page, testInfo, "a-popup-before-completion");

        // No pointer event, forced open, React setter or DOM mutation occurs
        // between the verified A popup and the fixture request completing.
        releaseCompletion();
        await expect(b).toBeVisible();
        await expect(a).toHaveCount(1);
        await expect
          .poll(() =>
            b.evaluate((element) => element.contains(document.activeElement)),
          )
          .toBe(true);
        const bAction = b.getByRole("button", {
          name: "Проверить действие B",
          exact: true,
        });
        const actionBox = await bAction.boundingBox();
        expect(actionBox).not.toBeNull();
        const overlap = {
          left: Math.max(oldPopupBox!.x, actionBox!.x),
          top: Math.max(oldPopupBox!.y, actionBox!.y),
          right: Math.min(
            oldPopupBox!.x + oldPopupBox!.width,
            actionBox!.x + actionBox!.width,
          ),
          bottom: Math.min(
            oldPopupBox!.y + oldPopupBox!.height,
            actionBox!.y + actionBox!.height,
          ),
        };
        diagnostics.overlap = { oldPopupBox, actionBox, overlap };
        diagnostics.layersAfterB = await overlayLayers(page);
        await screenshot(page, testInfo, "b-over-old-popup-area");
        expect(
          overlap.right - overlap.left,
          "B action must really overlap old A popup",
        ).toBeGreaterThan(2);
        expect(
          overlap.bottom - overlap.top,
          "B action must really overlap old A popup",
        ).toBeGreaterThan(2);
        const hitPoint = {
          x: (overlap.left + overlap.right) / 2,
          y: (overlap.top + overlap.bottom) / 2,
        };
        const hit = await bAction.evaluate((element, point) => {
          const target = document.elementFromPoint(point.x, point.y);
          return {
            owned: element.contains(target),
            tag: target?.tagName,
            id: target?.id,
            className: target?.getAttribute("class"),
          };
        }, hitPoint);
        diagnostics.overlapHit = { hitPoint, ...hit };
        expect(hit.owned).toBe(true);
        // Auto-closing A's popup is safe. If it remains mounted/visible behind
        // B, no old option may take the pointer anywhere in its visible area.
        diagnostics.aPopupVisibleAfterB = await aPopup.listbox.isVisible();
        if (await aPopup.listbox.isVisible()) {
          for (const option of await aPopup.listbox
            .getByRole("option", { includeHidden: true })
            .all()) {
            expect(
              await option.evaluate((element) => {
                const box = element.getBoundingClientRect();
                return element.contains(
                  document.elementFromPoint(
                    box.x + box.width / 2,
                    box.y + box.height / 2,
                  ),
                );
              }),
            ).toBe(false);
          }
        }
        await bAction.click({
          position: {
            x: hitPoint.x - actionBox!.x,
            y: hitPoint.y - actionBox!.y,
          },
        });
        await expect(page.getByTestId("b-pointer-actions")).toHaveText("1");
        await expect(page.getByTestId("a-value")).toHaveText("a-one");
        await expect(page.getByTestId("a-selections")).toHaveText("0");
        diagnostics.forwardGuardVisits = await assertModalFocusCycle(
          page,
          b,
          "Tab",
        );
        diagnostics.backwardGuardVisits = await assertModalFocusCycle(
          page,
          b,
          "Shift+Tab",
        );

        const bTrigger = b.getByRole("combobox", {
          name: "B: вариант",
          exact: true,
        });
        await bTrigger.click();
        const bPopup = await ownedPopup(page, bTrigger);
        expect(bPopup.id).not.toBe(aPopup.id);
        await assertPopupFits(bPopup.wrapper, viewport);
        await assertCenterHit(
          bPopup.listbox.getByRole("option", {
            name: "B — второй",
            exact: true,
          }),
        );
        await expect(bTrigger).toBeFocused();
        diagnostics.layersWithBPopup = await overlayLayers(page);
        await screenshot(page, testInfo, "b-owned-popup");
        const popupFocus = await b.evaluateHandle((element, id) => {
          const matches = document.querySelectorAll(
            `[role="listbox"][id="${CSS.escape(id)}"]`,
          );
          if (matches.length !== 1)
            throw new Error("B trigger must own one semantic listbox");
          const listbox = matches[0];
          const popup = listbox?.closest("[data-floating-ui-status]");
          const modalWrapper = element.closest(".g-modal__content-wrapper");
          if (!popup || !modalWrapper)
            throw new Error("B popup focus owner missing");
          const violations: string[] = [];
          const record = (event: FocusEvent) => {
            const target = event.target;
            if (
              !(target instanceof Element) ||
              element.contains(target) ||
              popup.contains(target)
            )
              return;
            if (
              target.matches(
                '[data-floating-ui-focus-guard][data-type="inside"]',
              ) &&
              (target.parentElement === modalWrapper ||
                target.parentElement === popup)
            )
              return;
            violations.push(`${target.tagName}#${target.id}`);
          };
          document.addEventListener("focusin", record, true);
          return {
            violations,
            dispose: () =>
              document.removeEventListener("focusin", record, true),
          };
        }, bPopup.id);
        try {
          await page.keyboard.press("ArrowDown");
          const secondOptionId = await bPopup.listbox
            .getByRole("option", { name: "B — второй", exact: true })
            .getAttribute("id");
          expect(secondOptionId).toBeTruthy();
          await expect(bTrigger).toHaveAttribute(
            "aria-activedescendant",
            secondOptionId!,
          );
          await page.keyboard.press("Enter");
          await expect(bPopup.listbox).toBeHidden();
          await expect(bTrigger).toBeFocused();
          await expect(bTrigger).toContainText("B — второй");
          await expect(page.getByTestId("b-value")).toHaveText("b-two");
          await expect(page.getByTestId("b-selections")).toHaveText("1");
          expect(
            await popupFocus.evaluate(({ violations }) => violations),
          ).toEqual([]);
        } finally {
          diagnostics.bPopupFocusViolations = await popupFocus.evaluate(
            ({ violations }) => violations,
          );
          await popupFocus.evaluate(({ dispose }) => dispose());
          await popupFocus.dispose();
        }

        await bTrigger.click();
        const finalBPopup = await ownedPopup(page, bTrigger);
        const bPopupNode = await finalBPopup.wrapper.elementHandle();
        const bGuards = await b.evaluateHandle((element) =>
          Array.from(
            element.closest(".g-modal__content-wrapper")!.children,
          ).filter((child) => child.matches("[data-floating-ui-focus-guard]")),
        );
        await page.keyboard.press("Escape");
        await expect(finalBPopup.listbox).toBeHidden();
        await expect(b).toBeVisible();
        await expect(bTrigger).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(b).toHaveCount(0);
        await expect(a).toBeVisible();
        await expect(aTrigger).toBeFocused();
        await expect(aTrigger).toHaveAttribute("aria-expanded", "false");
        await expect(aPopup.listbox).toHaveCount(0);
        await expect(finalBPopup.listbox).toHaveCount(0);
        expect(
          await bPopupNode!.evaluate((element) => element.isConnected),
        ).toBe(false);
        expect(
          await bGuards.evaluate((guards) =>
            guards.some((guard) => guard.isConnected),
          ),
        ).toBe(false);
        await bGuards.dispose();
        await bPopupNode!.dispose();
        await expect(page.getByTestId("a-selections")).toHaveText("0");
        await expect(page.getByTestId("a-value")).toHaveText("a-one");
        await expect(page.getByTestId("b-value")).toHaveText("b-two");

        await aTrigger.click();
        const reopenedA = await ownedPopup(page, aTrigger);
        const thirdA = reopenedA.listbox.getByRole("option", {
          name: "A — третий",
          exact: true,
        });
        await assertCenterHit(thirdA);
        await thirdA.click();
        await expect(aTrigger).toContainText("A — третий");
        await expect(page.getByTestId("a-selections")).toHaveText("1");
        await expect(reopenedA.listbox).toBeHidden();
        await page.keyboard.press("Escape");
        await expect(a).toHaveCount(0);
        await expect(baseOpener).toBeFocused();
        await expect(
          page.getByRole("dialog", { includeHidden: true }),
        ).toHaveCount(0);
        await expect(page.locator(".arken-form-select-popup")).toHaveCount(0);
        await expect(
          page.locator("[data-floating-ui-focus-guard]"),
        ).toHaveCount(0);
        await expect(page.locator("vite-error-overlay")).toHaveCount(0);
        await expect(page.getByRole("alert")).toHaveCount(0);
        expect(errors).toEqual([]);
        expect(unexpectedApiRequests).toEqual([]);
      } finally {
        cancelled = true;
        releaseCompletion();
        diagnostics.focusEvents = await focusLog.evaluate(
          ({ events }) => events,
        );
        diagnostics.pageErrors = errors;
        diagnostics.unexpectedApiRequests = unexpectedApiRequests;
        diagnostics.finalLayers = await overlayLayers(page);
        const path = testInfo.outputPath("modal-owner-diagnostics.json");
        await writeFile(path, JSON.stringify(diagnostics, null, 2));
        await testInfo.attach("modal-owner-diagnostics", {
          path,
          contentType: "application/json",
        });
        await screenshot(page, testInfo, "final-state");
        await focusLog.evaluate(({ dispose }) => dispose());
        await focusLog.dispose();
      }
    });
  }
}
