// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { GamePauseOverlay } from "./GamePauseOverlay";

describe("GamePauseOverlay", () => {
  it("waits for authoritative state and exposes retry without pretending to resume", async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error("offline"));
    renderComponent(<GamePauseOverlay paused isGm onToggle={onToggle} />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Продолжить игру" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Попробуйте ещё раз",
    );
    expect(
      screen.getByRole("heading", { name: "Перерыв" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeEnabled();
  });
  it("does not expose control to PLAYER or trap focus away from chat", () => {
    const view = renderComponent(
      <>
        <input aria-label="Чат" autoFocus />
        <div className="map-shell">
          <GamePauseOverlay paused={false} isGm={false} onToggle={vi.fn()} />
        </div>
      </>,
    );
    const chat = screen.getByRole("textbox", { name: "Чат" });
    chat.focus();
    view.rerender(
      <>
        <input aria-label="Чат" autoFocus />
        <div className="map-shell">
          <GamePauseOverlay paused isGm={false} onToggle={vi.fn()} />
        </div>
      </>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(chat).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Чат и броски доступны",
    );
  });
});
