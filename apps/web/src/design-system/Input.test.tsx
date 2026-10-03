// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "./Input";

afterEach(cleanup);

describe("Input", () => {
  it("renders a native input with proper classes and forwards ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <Input
        ref={ref}
        placeholder="Введите имя..."
        defaultValue="Квентин"
        qa="char-name"
      />,
    );

    const input = screen.getByPlaceholderText("Введите имя...");
    expect(ref.current).toBe(input);
    expect(input).toHaveValue("Квентин");
    expect(input.closest(".g-text-input")).toBeInTheDocument();
    expect(input.closest(".arken-text-input")).toBeInTheDocument();
    expect(input.closest("[data-qa='char-name']")).toBeInTheDocument();
  });

  it("forwards controlRef directly to the native input element", () => {
    const controlRef = createRef<HTMLInputElement>();
    render(
      <Input
        controlRef={controlRef}
        aria-label="Имя"
        defaultValue="Арагорн"
      />,
    );

    const input = screen.getByLabelText("Имя");
    expect(controlRef.current).toBe(input);
  });

  it("handles controlled value and onChange", () => {
    const onChange = vi.fn();
    function Controlled() {
      const [val, setVal] = useState("Начало");
      return (
        <Input
          aria-label="Поле"
          value={val}
          onChange={(e) => {
            onChange(e.target.value);
            setVal(e.target.value);
          }}
        />
      );
    }
    render(<Controlled />);

    const input = screen.getByLabelText("Поле");
    expect(input).toHaveValue("Начало");
    fireEvent.change(input, { target: { value: "Новое значение" } });
    expect(onChange).toHaveBeenCalledWith("Новое значение");
    expect(input).toHaveValue("Новое значение");
  });

  it("applies invalid state via aria-invalid or validationState", () => {
    const { rerender } = render(
      <Input aria-label="Поле" validationState="invalid" />,
    );
    const input = screen.getByLabelText("Поле");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.closest(".arken-text-input")).toHaveAttribute(
      "data-invalid",
      "true",
    );

    rerender(<Input aria-label="Поле" aria-invalid={false} />);
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    expect(input.closest(".arken-text-input")).not.toHaveAttribute(
      "data-invalid",
      "true",
    );
  });

  it("supports disabled state", () => {
    render(<Input aria-label="Поле" disabled />);
    const input = screen.getByLabelText("Поле");
    expect(input).toBeDisabled();
    expect(input.closest(".arken-text-input")).toHaveClass(
      "arken-text-input--disabled",
    );
  });

  it("renders startSlot and endSlot", () => {
    render(
      <Input
        aria-label="Поиск"
        startSlot={<span data-testid="search-icon">🔍</span>}
        endSlot={<span data-testid="suffix-unit">px</span>}
      />,
    );

    expect(screen.getByTestId("search-icon")).toBeInTheDocument();
    expect(screen.getByTestId("suffix-unit")).toBeInTheDocument();
  });

  it("supports hasClear and onClear", () => {
    const onClear = vi.fn();
    render(
      <Input
        aria-label="Поле"
        value="Текст"
        hasClear
        onClear={onClear}
        onChange={() => {}}
      />,
    );

    const clearButton = screen.getByRole("button", { name: "Очистить" });
    fireEvent.click(clearButton);
    expect(onClear).toHaveBeenCalledOnce();
  });
});
