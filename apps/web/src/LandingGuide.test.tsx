// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "./test-support/render";
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

    expect(
      screen.getByRole("heading", { name: "Туман войны" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Перемещение и выделение")).toBeInTheDocument();
    // UIX-621: бой отключён; доступны только шесть мастерских инструментов тумана.
    expect(screen.queryByText("Бой")).not.toBeInTheDocument();
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

  it("clears a filtering query before revealing a TOC target hidden by search", async () => {
    history.replaceState(null, "", window.location.pathname);
    renderComponent(<LandingGuide />);
    await userEvent.click(
      screen.getByRole("button", { name: "Показать все клавиши и команды" }),
    );
    const search = screen.getByRole("searchbox", {
      name: "Найти клавишу или действие",
    });
    await userEvent.type(search, "туман");
    expect(
      screen.queryByRole("heading", { name: "Камера" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Камера" }));
    await waitFor(() =>
      expect(document.getElementById("guide-камера")).toHaveFocus(),
    );
    expect(search).toHaveValue("");
  });
});
