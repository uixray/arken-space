// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
} from "../test-support/render";
import { DiceTrayPanel } from "./DiceTrayPanel";

describe("UIX645 dice controls", () => {
  it("keeps distinct decorative one-shot mode icons and pressed semantics", () => {
    renderComponent(
      <DiceTrayPanel
        characterId="character-icons"
        visibility="PUBLIC"
        onVisibilityChange={vi.fn()}
        onRoll={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const modes = ["Помеха", "Преимущество"].map((name) =>
      screen.getByRole("button", { name }),
    );
    const shapes = modes.map((mode) => {
      const svg = mode.querySelector("svg.arken-icon");
      expect(svg, "UIX645_DICE_MODE_ICON").toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(svg).toHaveAttribute("focusable", "false");
      return svg?.innerHTML;
    });
    expect(new Set(shapes).size).toBe(2);
    expect(modes[1]).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(modes[1]!);
    expect(modes[1]).toHaveAttribute("aria-pressed", "true");
    expect(modes[0]).toHaveAttribute("aria-pressed", "false");
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
    fireEvent.click(screen.getByRole("button", { name: "Преимущество" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "d20" }));
    });
    expect(onRoll).toHaveBeenCalledExactlyOnceWith(
      "1d20",
      "Чистый бросок двадцатки",
      "GM_ONLY",
      "character-icons",
      "ADVANTAGE",
    );
  });
});
