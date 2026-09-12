// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderComponent, screen } from "../test-support/render";
import { AppIcon } from "./AppIcon";
import { CloseIcon, ResetWindowIcon } from "./icons";

describe("Lucide icon foundation", () => {
  it.each([CloseIcon, ResetWindowIcon])(
    "renders an actual decorative SVG",
    (icon) => {
      const { container } = renderComponent(<AppIcon icon={icon} />);
      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("width", "16");
      expect(svg).toHaveAttribute("height", "16");
      expect(svg).toHaveAttribute("stroke", "currentColor");
      expect(svg).toHaveAttribute("stroke-width", "2");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
      expect(svg).not.toHaveAttribute("tabindex");
      expect(svg?.children.length).toBeGreaterThan(0);
      expect(container).toHaveTextContent("");
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    },
  );

  it("supports the size scale and composes classes without changing semantics", () => {
    const { container } = renderComponent(
      <AppIcon icon={CloseIcon} size={24} className="test-icon" />,
    );
    expect(container.querySelector("svg")).toHaveAttribute("width", "24");
    expect(container.querySelector("svg")).toHaveClass(
      "arken-icon",
      "test-icon",
    );
  });
});
