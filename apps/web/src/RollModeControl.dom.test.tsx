// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderComponent, screen } from "./test-support/render";
import { RollModeControl, type RollMode } from "./RollModeControl";

afterEach(() => vi.unstubAllGlobals());

function Harness() {
  const [value, setValue] = useState<RollMode>("NORMAL");
  return (
    <>
      <RollModeControl value={value} onChange={setValue} iconOnly />
      <button>Следующее действие</button>
    </>
  );
}

it("does not steal focus after an arrow selection followed by leaving the group", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  renderComponent(<Harness />);
  const disadvantage = screen.getByRole("button", { name: "Помеха" });
  disadvantage.focus();
  fireEvent.keyDown(disadvantage, { key: "ArrowRight" });
  const outside = screen.getByRole("button", { name: "Следующее действие" });
  outside.focus();
  for (const frame of frames) frame(16);
  expect(outside).toHaveFocus();
  expect(screen.getByRole("button", { name: "Преимущество" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it.each([
  ["ArrowRight", "Преимущество"],
  ["ArrowLeft", "Помеха"],
  ["ArrowDown", "Помеха"],
  ["ArrowUp", "Преимущество"],
  ["Home", "Помеха"],
  ["End", "Преимущество"],
])("moves focus and selected state together for %s", (key, name) => {
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  renderComponent(<Harness />);
  const disadvantage = screen.getByRole("button", { name: "Помеха" });
  disadvantage.focus();
  fireEvent.keyDown(disadvantage, { key });
  const selected = screen.getByRole("button", { name });
  expect(selected).toHaveFocus();
  expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(selected).toHaveAttribute("tabindex", "0");
});
