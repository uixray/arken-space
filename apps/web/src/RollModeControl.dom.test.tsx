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
  const normal = screen.getByRole("radio", { name: "Обычно" });
  normal.focus();
  fireEvent.keyDown(normal, { key: "ArrowRight" });
  const outside = screen.getByRole("button", { name: "Следующее действие" });
  outside.focus();
  for (const frame of frames) frame(16);
  expect(outside).toHaveFocus();
  expect(screen.getByRole("radio", { name: "Преимущество" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

it.each([
  ["ArrowRight", "Преимущество"],
  ["ArrowLeft", "Помеха"],
  ["ArrowDown", "Преимущество"],
  ["ArrowUp", "Помеха"],
  ["Home", "Помеха"],
  ["End", "Преимущество"],
])("moves focus and selected state together for %s", (key, name) => {
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  renderComponent(<Harness />);
  const normal = screen.getByRole("radio", { name: "Обычно" });
  normal.focus();
  fireEvent.keyDown(normal, { key });
  const selected = screen.getByRole("radio", { name });
  expect(selected).toHaveFocus();
  expect(selected).toHaveAttribute("aria-checked", "true");
  expect(selected).toHaveAttribute("tabindex", "0");
});
