// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextArea } from "./TextArea";

afterEach(cleanup);

describe("TextArea", () => {
  it("renders a native textarea with proper classes and forwards ref", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(
      <TextArea
        ref={ref}
        placeholder="Описание..."
        defaultValue="Жил-был дракон..."
        qa="char-bio"
      />,
    );

    const textarea = screen.getByPlaceholderText("Описание...");
    expect(ref.current).toBe(textarea);
    expect(textarea).toHaveValue("Жил-был дракон...");
    expect(textarea.closest(".g-text-area")).toBeInTheDocument();
    expect(textarea.closest(".arken-text-area")).toBeInTheDocument();
    expect(textarea.closest("[data-qa='char-bio']")).toBeInTheDocument();
  });

  it("forwards controlRef directly to the native textarea element", () => {
    const controlRef = createRef<HTMLTextAreaElement>();
    render(
      <TextArea
        controlRef={controlRef}
        aria-label="Заметки"
        defaultValue="Секретная записка"
      />,
    );

    const textarea = screen.getByLabelText("Заметки");
    expect(controlRef.current).toBe(textarea);
  });

  it("handles controlled value and onChange", () => {
    const onChange = vi.fn();
    function Controlled() {
      const [val, setVal] = useState("Строка 1");
      return (
        <TextArea
          aria-label="Текст"
          value={val}
          onChange={(e) => {
            onChange(e.target.value);
            setVal(e.target.value);
          }}
        />
      );
    }
    render(<Controlled />);

    const textarea = screen.getByLabelText("Текст");
    expect(textarea).toHaveValue("Строка 1");
    fireEvent.change(textarea, { target: { value: "Строка 1\nСтрока 2" } });
    expect(onChange).toHaveBeenCalledWith("Строка 1\nСтрока 2");
    expect(textarea).toHaveValue("Строка 1\nСтрока 2");
  });

  it("applies invalid state via aria-invalid or validationState", () => {
    const { rerender } = render(
      <TextArea aria-label="Текст" validationState="invalid" />,
    );
    const textarea = screen.getByLabelText("Текст");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea.closest(".arken-text-area")).toHaveAttribute(
      "data-invalid",
      "true",
    );

    rerender(<TextArea aria-label="Текст" aria-invalid={false} />);
    expect(textarea).not.toHaveAttribute("aria-invalid", "true");
    expect(textarea.closest(".arken-text-area")).not.toHaveAttribute(
      "data-invalid",
      "true",
    );
  });

  it("supports disabled state", () => {
    render(<TextArea aria-label="Текст" disabled />);
    const textarea = screen.getByLabelText("Текст");
    expect(textarea).toBeDisabled();
    expect(textarea.closest(".arken-text-area")).toHaveClass(
      "arken-text-area--disabled",
    );
  });
});
