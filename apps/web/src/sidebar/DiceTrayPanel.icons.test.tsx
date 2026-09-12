// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderComponent, screen } from "../test-support/render";
import { DiceTrayPanel } from "./DiceTrayPanel";

describe("UIX645 dice controls", () => {
  it("keeps distinct decorative mode icons and selected radio semantics", () => {
    renderComponent(
      <DiceTrayPanel
        characterId="character-icons"
        visibility="PUBLIC"
        onVisibilityChange={vi.fn()}
        onRoll={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const modes = ["Помеха", "Обычно", "Преимущество"].map((name) =>
      screen.getByRole("radio", { name }),
    );
    const shapes = modes.map((mode) => {
      const svg = mode.querySelector("svg.arken-icon");
      expect(svg, "UIX645_DICE_MODE_ICON").toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
      return svg?.innerHTML;
    });
    expect(new Set(shapes).size).toBe(3);
    expect(modes[1]).toHaveAttribute("aria-checked", "true");
    fireEvent.click(modes[2]!);
    expect(modes[2]).toHaveAttribute("aria-checked", "true");
    expect(modes[1]).toHaveAttribute("aria-checked", "false");
  });

  it("keeps secret-roll naming, state and submitted arguments", async () => {
    const onRoll = vi.fn().mockResolvedValue(undefined);
    const onVisibilityChange = vi.fn();
    const props = {
      characterId: "character-icons",
      onRoll,
      onVisibilityChange,
    };
    const { rerender } = renderComponent(
      <DiceTrayPanel {...props} visibility="PUBLIC" />,
    );
    const secret = screen.getByRole("button", { name: "Только мастеру" });
    expect(
      secret.querySelector("svg.arken-icon"),
      "UIX645_SECRET_ROLL_ICON",
    ).toHaveAttribute("aria-hidden", "true");
    expect(secret).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(secret);
    expect(onVisibilityChange).toHaveBeenCalledWith("GM_ONLY");
    rerender(<DiceTrayPanel {...props} visibility="GM_ONLY" />);
    expect(secret).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Преимущество" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "d20" }));
    });
    expect(onRoll).toHaveBeenCalledExactlyOnceWith(
      "1d20",
      "d20",
      "GM_ONLY",
      "character-icons",
      "ADVANTAGE",
    );
  });
});
