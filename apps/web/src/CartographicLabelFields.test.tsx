// @vitest-environment jsdom
import { useState } from "react";
import { expect, it } from "vitest";
import type { CartographicLabelConfig } from "@arken/contracts";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { CartographicLabelFields } from "./CartographicLabelFields";

function Fixture() {
  const [value, setValue] = useState<CartographicLabelConfig | null>(null);
  return <CartographicLabelFields value={value} onChange={setValue} name="Сцена" optionalTitle />;
}

it("labels the presentation control and preserves title opt-in while choosing the ribbon", async () => {
  const user = userEvent.setup();
  renderComponent(<Fixture />);
  const control = screen.getByRole("combobox", { name: "Оформление" }) as HTMLSelectElement;
  expect(control.disabled).toBe(true);
  await user.click(screen.getByRole("checkbox", { name: "Показывать название сцены на карте" }));
  expect(control.disabled).toBe(false);
  await user.selectOptions(control, "ribbon");
  expect(control.value).toBe("ribbon");
  expect(screen.getByLabelText("Пример оформления подписи").textContent).toContain("Сцена");
  await user.click(screen.getByRole("button", { name: "Сбросить оформление и смещение" }));
  expect(control.disabled).toBe(true);
});
