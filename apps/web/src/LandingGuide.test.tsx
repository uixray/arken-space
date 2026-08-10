// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { LandingGuide } from "./LandingGuide";

/**
 * `landing-guide-content.test.ts` proves the guide's claims match the code.
 * This proves the page actually shows them — the two together are what stop a
 * silently empty section from shipping.
 */
describe("landing guide", () => {
  it("shows what the app does without needing to be opened", () => {
    renderComponent(<LandingGuide />);
    // A visitor who never expands anything should still learn what this is.
    expect(
      screen.getByRole("heading", { name: "Стол и карта" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Персонажи" }),
    ).toBeInTheDocument();
  });

  it("keeps the key list collapsed until asked", () => {
    renderComponent(<LandingGuide />);
    const toggle = screen.getByRole("button", {
      name: "Показать все клавиши и команды",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Туман войны")).not.toBeInTheDocument();
  });

  it("reveals the shortcuts, and says which need a GM", async () => {
    renderComponent(<LandingGuide />);
    await userEvent.click(
      screen.getByRole("button", { name: "Показать все клавиши и команды" }),
    );

    expect(screen.getByText("Туман войны")).toBeInTheDocument();
    expect(screen.getByText("Перемещение и выделение")).toBeInTheDocument();
    // The fog tools are the GM-only ones; a player reading this page should be
    // told so rather than wondering why the key does nothing for them.
    expect(screen.getAllByText("только мастер")).toHaveLength(6);
    expect(screen.getByText("/d20")).toBeInTheDocument();
  });

  it("collapses again", async () => {
    renderComponent(<LandingGuide />);
    const toggle = screen.getByRole("button", {
      name: "Показать все клавиши и команды",
    });
    await userEvent.click(toggle);
    await userEvent.click(
      screen.getByRole("button", { name: "Свернуть управление" }),
    );
    expect(screen.queryByText("Туман войны")).not.toBeInTheDocument();
  });
});
