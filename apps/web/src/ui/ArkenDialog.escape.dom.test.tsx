// @vitest-environment jsdom
import { createPortal } from "react-dom";
import { ThemeProvider } from "@gravity-ui/uikit";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderComponent as renderBase,
  screen,
  userEvent,
  waitFor,
} from "../test-support/render";
import { ArkenDialog } from "./ArkenDialog";
import { FormSelect } from "./GravityFormControls";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderComponent(ui: ReactElement) {
  return renderBase(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ThemeProvider theme="dark" lang="ru">
        {children}
      </ThemeProvider>
    ),
  });
}

it("gives a real open FormSelect the first Escape and closes the workspace on the second", async () => {
  const onClose = vi.fn();
  const onChange = vi.fn();
  const user = userEvent.setup();
  renderComponent(
    <ArkenDialog
      open
      title="Токены"
      variant="workspace"
      workspaceDraggable={false}
      footer={false}
      onClose={onClose}
    >
      <FormSelect aria-label="Изображение" value="portrait" onChange={onChange}>
        <option value="portrait">Портрет</option>
        <option value="marker">Маркер</option>
      </FormSelect>
    </ArkenDialog>,
  );

  const select = screen.getByRole("combobox", { name: "Изображение" });
  await user.click(select);
  expect(select).toHaveAttribute("aria-expanded", "true");

  await user.keyboard("{Escape}");
  await waitFor(() => expect(select).toHaveAttribute("aria-expanded", "false"));
  expect(screen.getByRole("dialog", { name: "Токены" })).toBeInTheDocument();
  expect(select).toHaveFocus();
  expect(select).toHaveTextContent("Портрет");
  expect(onChange).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("does not close when a child already consumed Escape", () => {
  const onClose = vi.fn();
  renderComponent(
    <ArkenDialog
      open
      title="Токены"
      variant="workspace"
      workspaceDraggable={false}
      footer={false}
      onClose={onClose}
    >
      <input
        aria-label="Вложенный редактор"
        onKeyDown={(event) => event.preventDefault()}
      />
    </ArkenDialog>,
  );

  fireEvent.keyDown(screen.getByLabelText("Вложенный редактор"), {
    key: "Escape",
  });
  expect(onClose).not.toHaveBeenCalled();
});

it("does not claim Escape bubbling from a portalled child overlay", () => {
  const onClose = vi.fn();
  renderComponent(
    <ArkenDialog
      open
      title="Токены"
      variant="workspace"
      workspaceDraggable={false}
      footer={false}
      onClose={onClose}
    >
      {createPortal(<button type="button">Вложенный слой</button>, document.body)}
    </ArkenDialog>,
  );

  fireEvent.keyDown(screen.getByRole("button", { name: "Вложенный слой" }), {
    key: "Escape",
  });
  expect(onClose).not.toHaveBeenCalled();
});

it("closes only the directly owning nested workspace", () => {
  const closeOuter = vi.fn();
  const closeInner = vi.fn();
  renderComponent(
    <ArkenDialog open title="Внешнее окно" variant="workspace" footer={false} onClose={closeOuter}>
      <ArkenDialog open title="Внутреннее окно" variant="workspace" footer={false} onClose={closeInner}>
        <input aria-label="Вложенное поле" />
      </ArkenDialog>
    </ArkenDialog>,
  );
  fireEvent.keyDown(screen.getByLabelText("Вложенное поле"), { key: "Escape" });
  expect(closeInner).toHaveBeenCalledTimes(1);
  expect(closeOuter).not.toHaveBeenCalled();
});
