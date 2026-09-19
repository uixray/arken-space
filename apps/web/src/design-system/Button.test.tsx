// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createRef, type MouseEvent } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

afterEach(cleanup);

describe("Button", () => {
  it("keeps the compatible class and DOM contract on a native button", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} view="action" size="l" selected qa="save">
        Сохранить
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Сохранить" });
    expect(ref.current).toBe(button);
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("data-qa", "save");
    expect(button).toHaveClass(
      "g-button",
      "g-button_view_action",
      "g-button_size_l",
      "g-button_selected",
    );
    expect(button.querySelector(".g-button__text")).toHaveTextContent(
      "Сохранить",
    );
  });

  it("makes loading a native disabled and busy state", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Сохранение
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Сохранение" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("tabindex", "-1");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveClass("g-button_disabled", "g-button_loading");
    expect(button.querySelector(".arken-button__spinner")).toBeInTheDocument();
    expect(button).toHaveAccessibleName("Сохранение");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("uses Base UI non-native semantics for links", () => {
    const onClick = vi.fn((event: MouseEvent<HTMLAnchorElement>) =>
      event.preventDefault(),
    );
    render(
      <Button href="/guide" target="_blank" onClick={onClick}>
        Руководство
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Руководство" });
    expect(link).toHaveAttribute("href", "/guide");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.tagName).toBe("A");
    expect(fireEvent.click(link)).toBe(false);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps a disabled link named but out of navigation and tab order", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button href="/guide" disabled onClick={onClick}>
        Руководство
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Руководство" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("tabindex", "-1");
    expect(link).not.toHaveAttribute("href");
    expect(fireEvent.click(link)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();

    rerender(
      <Button href="/guide" loading onClick={onClick}>
        Руководство
      </Button>,
    );
    expect(link).not.toHaveAttribute("href");
    expect(link.querySelector(".arken-button__spinner")).toBeInTheDocument();
    expect(fireEvent.click(link)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });
});
