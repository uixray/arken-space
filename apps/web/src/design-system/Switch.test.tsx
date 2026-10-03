// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Switch } from "./Switch";

afterEach(cleanup);

describe("Switch", () => {
  it("renders a switch role element with label and forwards ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <Switch ref={ref} id="music-loop" name="music-loop" qa="loop-switch">
        Зацикливать трек
      </Switch>,
    );

    const input = screen.getByRole("switch", { name: "Зацикливать трек" });
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute("id", "music-loop");
    expect(input.closest(".arken-switch")).toBeInTheDocument();
    expect(input.closest(".g-switch")).toBeInTheDocument();
  });

  it("forwards controlRef directly to the native input element", () => {
    const controlRef = createRef<HTMLInputElement>();
    render(<Switch controlRef={controlRef} aria-label="Автоскролл" />);

    const input = screen.getByLabelText("Автоскролл");
    expect(controlRef.current).toBe(input);
  });

  it("handles clicking label to toggle state and fires onChange and onUpdate", () => {
    const onChange = vi.fn();
    const onUpdate = vi.fn();
    render(
      <Switch onChange={onChange} onUpdate={onUpdate}>
        Показывать сетку
      </Switch>,
    );

    const input = screen.getByRole("switch", { name: "Показывать сетку" });
    expect(input).not.toBeChecked();

    fireEvent.click(screen.getByText("Показывать сетку"));

    expect(input).toBeChecked();
    expect(onChange).toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledWith(true);
  });

  it("handles controlled state", () => {
    function Controlled() {
      const [checked, setChecked] = useState(false);
      return (
        <Switch
          checked={checked}
          onUpdate={(val) => setChecked(val)}
        >
          Звуковые эффекты
        </Switch>
      );
    }
    render(<Controlled />);

    const input = screen.getByRole("switch", { name: "Звуковые эффекты" });
    expect(input).not.toBeChecked();

    fireEvent.click(input);
    expect(input).toBeChecked();
  });

  it("supports disabled state", () => {
    const onChange = vi.fn();
    render(
      <Switch disabled onChange={onChange}>
        Недоступно
      </Switch>,
    );

    const input = screen.getByRole("switch", { name: "Недоступно" });
    expect(input).toBeDisabled();

    fireEvent.click(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
