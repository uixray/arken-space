// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { renderComponent, screen } from "./test-support/render";
import { StickerPicker } from "./StickerPicker";

it.each([true, false])(
  "keeps the sticker trigger name and state with iconOnly=%s",
  (iconOnly) => {
    renderComponent(
      <StickerPicker
        iconOnly={iconOnly}
        disabled
        onSelect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Стикеры" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const icon = trigger.querySelector("svg.arken-icon");
    if (iconOnly) {
      expect(icon, "UIX645_STICKER_TRIGGER_ICON").toHaveAttribute(
        "aria-hidden",
        "true",
      );
    } else {
      expect(icon).not.toBeInTheDocument();
      expect(trigger).toHaveTextContent("Стикеры");
    }
  },
);
