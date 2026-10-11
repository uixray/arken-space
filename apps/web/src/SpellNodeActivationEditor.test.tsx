// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpellActivation } from "@arken/contracts";
import { SpellNodeActivationEditor } from "./SpellNodeActivationEditor";

afterEach(cleanup);
describe("SpellNodeActivationEditor", () => {
  it("supports keyboard toggle/add and reports invalid OTHER until source wording is entered", () => {
    let value: SpellActivation = { passive: true, triggers: [] };
    const onChange = vi.fn((next: SpellActivation) => { value = next; view.rerender(<SpellNodeActivationEditor value={value} onChange={onChange} />); });
    const view = render(<SpellNodeActivationEditor value={value} onChange={onChange} />);
    const passive = screen.getByLabelText("Пассивная способность"); passive.focus(); fireEvent.click(passive);
    expect(value.passive).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Добавить условие/ }));
    fireEvent.change(screen.getByLabelText("Тип активации 1"), { target: { value: "OTHER" } });
    expect(screen.getByRole("alert").textContent).toContain("Другое");
    fireEvent.change(screen.getByLabelText("Текст источника 1"), { target: { value: "Source wording" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("enforces the 20-trigger cap", () => {
    const value: SpellActivation = { passive: true, triggers: Array.from({ length: 20 }, (_, i) => ({ kind: "ACTION" as const, label: `row-${i}` })) };
    render(<SpellNodeActivationEditor value={value} onChange={vi.fn()} />);
    expect((screen.getByRole("button", { name: /Добавить условие/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Название условия 20") as HTMLInputElement).value).toBe("row-19");
  });
});
