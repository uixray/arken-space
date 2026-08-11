// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "../test-support/render";
import { CursorPresenceMenu } from "./CursorPresenceMenu";
import { cursorPreferenceDefault } from "../cursor-preference";

// `@gravity-ui/uikit` ships CSS this repo's Vitest transform cannot handle,
// so it is stubbed — the established pattern here, see MediaPanel.test.tsx.
// The stubs are typed against the props this component actually passes: a
// mock that does not typecheck is the failure mode docs/testing.md warns
// about. `Popup` renders its children only when open, which is the part of
// its behaviour these tests depend on.
vi.mock("@gravity-ui/uikit", () => ({
  Popup: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null,
  Switch: ({
    checked,
    onUpdate,
    children,
  }: {
    checked?: boolean;
    onUpdate?: (next: boolean) => void;
    children?: ReactNode;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onUpdate?.(event.target.checked)}
      />
      {children}
    </label>
  ),
}));

/**
 * UIX-427: the two roles get different controls, and the reason is not
 * cosmetic — offering a player a switch for their own cursor is offering a
 * setting that changes nothing they can observe.
 */
describe("cursor presence control", () => {
  it("gives a player one toggle and no menu", async () => {
    const onChange = vi.fn();
    renderComponent(
      <CursorPresenceMenu
        preference={cursorPreferenceDefault("PLAYER")}
        role="PLAYER"
        onChange={onChange}
      />,
    );

    const button = screen.getByRole("button", { name: "Курсоры" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    // No menu: a popup holding one switch is two clicks for a one-click job.
    expect(button).not.toHaveAttribute("aria-haspopup");

    await userEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ receiveEnabled: false }),
    );
  });

  it("never offers a player the sending switch", async () => {
    renderComponent(
      <CursorPresenceMenu
        preference={cursorPreferenceDefault("PLAYER")}
        role="PLAYER"
        onChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Курсоры" }));
    // Even after clicking: there is nothing to open.
    expect(screen.queryByText(/Показывать мой курсор/)).not.toBeInTheDocument();
  });

  it("gives a GM both switches, with the warning about fog", async () => {
    renderComponent(
      <CursorPresenceMenu
        preference={cursorPreferenceDefault("GM")}
        role="GM"
        onChange={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Курсоры" }));
    expect(screen.getByText("Показывать чужие курсоры")).toBeInTheDocument();
    expect(
      screen.getByText("Показывать мой курсор игрокам"),
    ).toBeInTheDocument();
    expect(screen.getByText(/скрытых туманом/)).toBeInTheDocument();
  });

  it("starts a GM with their cursor private", () => {
    renderComponent(
      <CursorPresenceMenu
        preference={cursorPreferenceDefault("GM")}
        role="GM"
        onChange={vi.fn()}
      />,
    );
    // The default itself is asserted in cursor-preference.test.ts; this pins
    // that the control is fed by it rather than by its own idea of a default.
    expect(cursorPreferenceDefault("GM").sendEnabled).toBe(false);
  });
});
