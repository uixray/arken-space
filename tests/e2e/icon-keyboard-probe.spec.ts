import { expect, test } from "@playwright/test";
import {
  readIconKeyboardFocus,
  tagIconKeyboardControls,
} from "./helpers/icon-keyboard-probe";

test("batched keyboard probe retains actual focus, radio and missing indicator evidence", async ({
  page,
}) => {
  await page.setContent(`
    <style>button:focus-visible{outline:2px solid black}button.bad:focus{outline:none;box-shadow:none}</style>
    <button aria-label="First">First</button>
    <button disabled>Disabled</button>
    <button role="radio" aria-checked="true">Radio</button>
    <button class="bad">Missing indicator</button>
    <svg tabindex="0"><path d="M0 0L10 10"/></svg>
  `);
  await tagIconKeyboardControls(page.locator("button"));
  await page.keyboard.press("Tab");
  expect(await readIconKeyboardFocus(page)).toMatchObject({
    tagName: "BUTTON",
    id: "0",
    visible: true,
    outline: true,
  });
  await page.keyboard.press("Tab");
  expect(await readIconKeyboardFocus(page)).toMatchObject({
    id: "2",
    role: "radio",
  });
  await page.keyboard.press("Tab");
  expect(await readIconKeyboardFocus(page)).toMatchObject({
    id: "3",
    outline: false,
    shadow: false,
  });
  await page.keyboard.press("Tab");
  expect(await readIconKeyboardFocus(page)).toMatchObject({ tagName: "svg" });
});
