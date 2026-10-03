// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("renders a native checkbox with label and forwards ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <Checkbox ref={ref} id="agree" name="agree" value="yes" qa="agree-check">
        Согласен с правилами
      </Checkbox>,
    );

    const input = screen.getByRole("checkbox", {
      name: "Согласен с правилами",
    });
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute("id", "agree");
    expect(input).toHaveAttribute("name", "agree");
    expect(input).toHaveAttribute("value", "yes");
    expect(input.closest(".arken-checkbox")).toBeInTheDocument();
    expect(input.closest(".g-checkbox")).toBeInTheDocument();
  });

  it("forwards controlRef directly to the native checkbox element", () => {
    const controlRef = createRef<HTMLInputElement>();
    render(
      <Checkbox controlRef={controlRef} aria-label="Параметр видимости" />,
    );

    const input = screen.getByLabelText("Параметр видимости");
    expect(controlRef.current).toBe(input);
  });

  it("handles clicking label to toggle state and fires onChange and onUpdate", () => {
    const onChange = vi.fn();
    const onUpdate = vi.fn();
    render(
      <Checkbox onChange={onChange} onUpdate={onUpdate}>
        Активировать туман
      </Checkbox>,
    );

    const input = screen.getByRole("checkbox", { name: "Активировать туман" });
    expect(input).not.toBeChecked();

    fireEvent.click(screen.getByText("Активировать туман"));

    expect(input).toBeChecked();
    expect(onChange).toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledWith(true);
  });

  it("handles controlled state", () => {
    function Controlled() {
      const [checked, setChecked] = useState(false);
      return (
        <Checkbox
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        >
          Контролируемый
        </Checkbox>
      );
    }
    render(<Controlled />);

    const input = screen.getByRole("checkbox", { name: "Контролируемый" });
    expect(input).not.toBeChecked();

    fireEvent.click(input);
    expect(input).toBeChecked();
  });

  it("renders indeterminate state with minus icon", () => {
    const { container } = render(
      <Checkbox indeterminate>Частично выбрано</Checkbox>,
    );

    const label = container.querySelector(".arken-checkbox--indeterminate");
    expect(label).toBeInTheDocument();
  });

  it("supports disabled and invalid states", () => {
    const { rerender } = render(
      <Checkbox disabled validationState="invalid">
        Заблокировано
      </Checkbox>,
    );

    const input = screen.getByRole("checkbox", { name: "Заблокировано" });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("aria-invalid", "true");

    rerender(<Checkbox aria-invalid={false}>Нормально</Checkbox>);
    const normalInput = screen.getByRole("checkbox", { name: "Нормально" });
    expect(normalInput).not.toHaveAttribute("aria-invalid", "true");
  });
});
