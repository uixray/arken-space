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

it.each(["closed", "unsupported"])(
  "allows workspace Escape from a %s native select",
  (state: string) => {
    const onClose = vi.fn();
    renderComponent(
      <ArkenDialog
        open
        title="Фильтры"
        variant="workspace"
        footer={false}
        onClose={onClose}
      >
        <select aria-label="Тип">
          <option>Все</option>
        </select>
      </ArkenDialog>,
    );
    const select = screen.getByRole("combobox", { name: "Тип" });
    const originalMatches = select.matches.bind(select);
    vi.spyOn(select, "matches").mockImplementation((selector: string) => {
      if (selector !== ":open") return originalMatches(selector);
      if (state === "unsupported")
        throw new DOMException("Unsupported selector", "SyntaxError");
      return false;
    });
    fireEvent.keyDown(select, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  },
);

it("yields one native Escape, ignores held-key repeats, then closes despite stale :open", () => {
  const onClose = vi.fn();
  renderComponent(
    <ArkenDialog
      open
      title="Фильтры"
      variant="workspace"
      footer={false}
      onClose={onClose}
    >
      <select aria-label="Тип">
        <option>Все</option>
      </select>
    </ArkenDialog>,
  );
  const select = screen.getByRole("combobox", { name: "Тип" });
  const originalMatches = select.matches.bind(select);
  const open = true;
  // jsdom has no OS popup; this checks event ownership only. Headed Firefox
  // separately verifies the real :open lifecycle and native default behavior.
  vi.spyOn(select, "matches").mockImplementation((selector: string) =>
    selector === ":open" ? open : originalMatches(selector),
  );
  select.focus();
  expect(fireEvent.keyDown(select, { key: "Escape" })).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  expect(select).toHaveFocus();
  expect(fireEvent.keyDown(select, { key: "Escape", repeat: true })).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  // Simulates Firefox retaining :open after the browser consumed the first
  // native Escape. A new physical press belongs to the parent workspace.
  fireEvent.keyDown(select, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it.each(["pointerdown", "ArrowDown", "Alt+ArrowDown", "F4"])(
  "resets native Escape ownership when the same select reopens by %s",
  (gesture: string) => {
    const onClose = vi.fn();
    renderComponent(
      <ArkenDialog
        open
        title="Фильтры"
        variant="workspace"
        footer={false}
        onClose={onClose}
      >
        <select aria-label="Тип">
          <option>Все</option>
        </select>
      </ArkenDialog>,
    );
    const select = screen.getByRole("combobox", { name: "Тип" });
    const originalMatches = select.matches.bind(select);
    let open = true;
    vi.spyOn(select, "matches").mockImplementation((selector: string) =>
      selector === ":open" ? open : originalMatches(selector),
    );

    fireEvent.keyDown(select, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    for (let cycle = 0; cycle < 2; cycle++) {
      open = false;
      if (gesture === "pointerdown") fireEvent.pointerDown(select);
      else if (gesture === "Alt+ArrowDown")
        fireEvent.keyDown(select, { key: "ArrowDown", altKey: true });
      else fireEvent.keyDown(select, { key: gesture });
      open = true;
      expect(fireEvent.keyDown(select, { key: "Escape" })).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
    }
    // Stale open remains true; the next physical Escape closes the workspace.
    expect(fireEvent.keyDown(select, { key: "Escape" })).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  },
);

it("treats blur as closed even when Firefox keeps reporting stale :open", () => {
  const onClose = vi.fn();
  renderComponent(
    <ArkenDialog
      open
      title="Фильтры"
      variant="workspace"
      footer={false}
      onClose={onClose}
    >
      <select aria-label="Тип">
        <option>Все</option>
      </select>
    </ArkenDialog>,
  );
  const select = screen.getByRole("combobox", { name: "Тип" });
  const originalMatches = select.matches.bind(select);
  vi.spyOn(select, "matches").mockImplementation((selector: string) =>
    selector === ":open" ? true : originalMatches(selector),
  );
  fireEvent.keyDown(select, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.blur(select);
  select.focus();
  expect(fireEvent.keyDown(select, { key: "Escape" })).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("rechecks :open after change instead of assuming the native popup closed", () => {
  const onClose = vi.fn();
  renderComponent(
    <ArkenDialog
      open
      title="Фильтры"
      variant="workspace"
      footer={false}
      onClose={onClose}
    >
      <select aria-label="Тип">
        <option value="all">Все</option>
        <option value="kind">Тип</option>
      </select>
    </ArkenDialog>,
  );
  const select = screen.getByRole("combobox", { name: "Тип" });
  const originalMatches = select.matches.bind(select);
  vi.spyOn(select, "matches").mockImplementation((selector: string) =>
    selector === ":open" ? true : originalMatches(selector),
  );
  fireEvent.keyDown(select, { key: "Escape" });
  fireEvent.change(select, { target: { value: "kind" } });
  expect(fireEvent.keyDown(select, { key: "Escape" })).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(select, { key: "Escape" })).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("ignores repeated Escape without prior open-state evidence", () => {
  const onClose = vi.fn();
  renderComponent(
    <ArkenDialog
      open
      title="Фильтры"
      variant="workspace"
      footer={false}
      onClose={onClose}
    >
      <select aria-label="Тип">
        <option>Все</option>
      </select>
    </ArkenDialog>,
  );
  const select = screen.getByRole("combobox", { name: "Тип" });
  fireEvent.keyDown(select, { key: "Escape", repeat: true });
  expect(onClose).not.toHaveBeenCalled();
});
it("remembers an open popup first observed during Escape key repeat", () => {
  const onClose = vi.fn();
  renderComponent(
    <ArkenDialog
      open
      title="Фильтры"
      variant="workspace"
      footer={false}
      onClose={onClose}
    >
      <select aria-label="Тип">
        <option>Все</option>
      </select>
    </ArkenDialog>,
  );
  const select = screen.getByRole("combobox", { name: "Тип" });
  const originalMatches = select.matches.bind(select);
  vi.spyOn(select, "matches").mockImplementation((selector: string) =>
    selector === ":open" ? true : originalMatches(selector),
  );
  fireEvent.keyDown(select, { key: "Escape", repeat: true });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(select, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps a blur-known-closed select open through repeats, then closes on a fresh Escape", () => {
  const onClose = vi.fn();
  renderComponent(
    <ArkenDialog
      open
      title="Фильтры"
      variant="workspace"
      footer={false}
      onClose={onClose}
    >
      <select aria-label="Тип">
        <option>Все</option>
      </select>
    </ArkenDialog>,
  );
  const select = screen.getByRole("combobox", { name: "Тип" });
  fireEvent.blur(select);
  select.focus();
  fireEvent.keyDown(select, { key: "Escape", repeat: true });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(select, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});
it("tracks native Escape ownership separately for different selects", () => {
  const onClose = vi.fn();
  renderComponent(
    <ArkenDialog
      open
      title="Фильтры"
      variant="workspace"
      footer={false}
      onClose={onClose}
    >
      <select aria-label="Тип">
        <option>Все</option>
      </select>
      <select aria-label="Статус">
        <option>Все</option>
      </select>
    </ArkenDialog>,
  );
  const kind = screen.getByRole("combobox", { name: "Тип" });
  const status = screen.getByRole("combobox", { name: "Статус" });
  const originalKindMatches = kind.matches.bind(kind);
  const originalStatusMatches = status.matches.bind(status);
  vi.spyOn(kind, "matches").mockImplementation((selector: string) =>
    selector === ":open" ? true : originalKindMatches(selector),
  );
  vi.spyOn(status, "matches").mockImplementation((selector: string) =>
    selector === ":open" ? true : originalStatusMatches(selector),
  );

  kind.focus();
  fireEvent.keyDown(kind, { key: "Escape" });
  status.focus();
  expect(fireEvent.keyDown(status, { key: "Escape" })).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(status, { key: "Escape" })).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps a native select's first Escape inside its nested workspace only", () => {
  const closeOuter = vi.fn();
  const closeInner = vi.fn();
  renderComponent(
    <ArkenDialog
      open
      title="Внешнее окно"
      variant="workspace"
      footer={false}
      onClose={closeOuter}
    >
      <ArkenDialog
        open
        title="Внутреннее окно"
        variant="workspace"
        footer={false}
        onClose={closeInner}
      >
        <select aria-label="Вложенный тип">
          <option>Все</option>
        </select>
      </ArkenDialog>
    </ArkenDialog>,
  );
  const select = screen.getByRole("combobox", { name: "Вложенный тип" });
  const originalMatches = select.matches.bind(select);
  vi.spyOn(select, "matches").mockImplementation((selector: string) =>
    selector === ":open" ? true : originalMatches(selector),
  );

  fireEvent.keyDown(select, { key: "Escape" });
  expect(closeInner).not.toHaveBeenCalled();
  expect(closeOuter).not.toHaveBeenCalled();
  fireEvent.keyDown(select, { key: "Escape" });
  expect(closeInner).toHaveBeenCalledTimes(1);
  expect(closeOuter).not.toHaveBeenCalled();
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
      {createPortal(
        <button type="button">Вложенный слой</button>,
        document.body,
      )}
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
    <ArkenDialog
      open
      title="Внешнее окно"
      variant="workspace"
      footer={false}
      onClose={closeOuter}
    >
      <ArkenDialog
        open
        title="Внутреннее окно"
        variant="workspace"
        footer={false}
        onClose={closeInner}
      >
        <input aria-label="Вложенное поле" />
      </ArkenDialog>
    </ArkenDialog>,
  );
  fireEvent.keyDown(screen.getByLabelText("Вложенное поле"), { key: "Escape" });
  expect(closeInner).toHaveBeenCalledTimes(1);
  expect(closeOuter).not.toHaveBeenCalled();
});
