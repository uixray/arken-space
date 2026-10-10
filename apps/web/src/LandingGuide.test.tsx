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
    expect(
      screen.getByRole("heading", { name: "Как сделать" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Короткие ответы" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Показать точку на карте" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Предложить действие мастеру" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", {
        name: "Подсказка по клавишам и командам",
      })[0],
    ).toHaveAttribute("href", "#guide-камера");
  });

  it("keeps the key list collapsed until asked", () => {
    renderComponent(<LandingGuide />);
    const toggle = screen.getByRole("button", {
      name: "Показать все клавиши и команды",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Туман войны")).not.toBeInTheDocument();
  });

  it("provides factual, dimensioned lazy-loaded guide screenshots", () => {
    renderComponent(<LandingGuide />);
    const gallery = screen.getByText("Снимки интерфейса").closest("details");
    expect(gallery).not.toBeNull();
    const images = gallery!.querySelectorAll("img");
    expect(images).toHaveLength(3);
    for (const image of images) {
      expect(image).toHaveAttribute("alt");
      expect(image.getAttribute("alt")).not.toBe("");
      expect(image).toHaveAttribute("loading", "lazy");
      expect(image).toHaveAttribute("decoding", "async");
      expect(Number(image.getAttribute("width"))).toBeGreaterThan(0);
      expect(Number(image.getAttribute("height"))).toBeGreaterThan(0);
      expect(image.getAttribute("src")).toMatch(/^\/assets\/guide\/.+\.webp$/);
    }
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

  it("keeps guide procedures keyboard reachable and preserves the existing guide entry points", async () => {
    history.replaceState(null, "", window.location.pathname);
    renderComponent(<LandingGuide />);
    const links = screen.getAllByRole("link", { name: "К разделу шпаргалки" });
    expect(links.length).toBeGreaterThan(0);
    links[0]!.focus();
    expect(links[0]).toHaveFocus();
    await userEvent.click(links[0]!);
    expect(decodeURIComponent(window.location.hash)).toBe("#guide-туман-войны");
    expect(
      screen.getByRole("button", { name: "Свернуть управление" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Туман войны" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Снимки интерфейса").closest("details"),
    ).not.toHaveAttribute("open");
  });
});
