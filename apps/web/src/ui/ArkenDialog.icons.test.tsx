// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "../test-support/render";
import { ArkenDialog } from "./ArkenDialog";

// Gravity imports CSS unsupported by this Vitest setup. Only its unused modal
// branch is stubbed; workspace DOM, hooks, buttons and Lucide stay real.
vi.mock("@gravity-ui/uikit", () => ({
  Dialog: () => {
    throw new Error("This suite must only render the workspace variant");
  },
}));

describe("workspace close icon", () => {
  it("keeps its accessible name and initial focus with a real Lucide SVG", () => {
    renderComponent(
      <ArkenDialog
        open
        title="Проверка"
        variant="workspace"
        footer={false}
        onClose={vi.fn()}
      >
        Содержимое
      </ArkenDialog>,
    );
    const close = screen.getByRole("button", { name: "Закрыть окно" });
    expect(close).toHaveFocus();
    expect(close).toHaveTextContent("");
    expect(close.querySelector("svg")).toHaveClass("lucide-x");
    expect(close.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("retains keyboard activation without adding an SVG tab stop", async () => {
    const onClose = vi.fn();
    renderComponent(
      <ArkenDialog
        open
        title="Проверка"
        variant="workspace"
        footer={false}
        onClose={onClose}
      >
        Содержимое
      </ArkenDialog>,
    );
    await userEvent.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lets a click on the SVG bubble to the existing close action", async () => {
    const onClose = vi.fn();
    renderComponent(
      <ArkenDialog
        open
        title="Проверка"
        variant="workspace"
        footer={false}
        onClose={onClose}
      >
        Содержимое
      </ArkenDialog>,
    );
    const svg = screen
      .getByRole("button", { name: "Закрыть окно" })
      .querySelector("svg");
    expect(svg).not.toBeNull();
    await userEvent.click(svg!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
