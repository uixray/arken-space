// @vitest-environment jsdom
import {
  createRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
} from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "@gravity-ui/uikit";
import type { ReactElement, ReactNode } from "react";
import {
  fireEvent,
  renderComponent as renderBase,
  screen,
} from "../test-support/render";
import { FormInput, FormTextArea } from "./GravityFormControls";

// Real production provider; only the browser API missing from jsdom is shimmed.
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

it("keeps native color value, ref and real change events", () => {
  const ref = createRef<HTMLInputElement>();
  const changed = vi.fn();
  function Color() {
    const [value, setValue] = useState("#c8b78b");
    return (
      <FormInput
        type="color"
        aria-label="Цвет"
        controlRef={ref}
        value={value}
        onChange={(event) => {
          changed(event.target, event.currentTarget, event.target.value);
          setValue(event.target.value);
        }}
      />
    );
  }
  renderComponent(<Color />);
  const input = screen.getByLabelText("Цвет");
  expect(input).toHaveAttribute("type", "color");
  expect(input).toHaveStyle({ minHeight: "36px", padding: "4px" });
  expect(ref.current).toBe(input);
  expect(input).toHaveValue("#c8b78b");
  fireEvent.change(input, { target: { value: "#112233" } });
  expect(changed).toHaveBeenCalledWith(input, input, "#112233");
  expect(input).toHaveValue("#112233");
});

it("forwards native numeric constraints and descriptions to the real Gravity input", () => {
  const ref = createRef<HTMLInputElement>();
  renderComponent(
    <>
      <p id="number-hint">От 16 до 256 px, целое число.</p>
      <FormInput
        controlRef={ref}
        type="number"
        aria-label="Клетка"
        min={16}
        max={256}
        step={1}
        required
        aria-describedby="number-hint"
        defaultValue={64}
      />
    </>,
  );
  const input = screen.getByRole("spinbutton", { name: "Клетка" });
  expect(ref.current).toBe(input);
  expect(input).toHaveAttribute("min", "16");
  expect(input).toHaveAttribute("max", "256");
  expect(input).toHaveAttribute("step", "1");
  expect(input).toBeRequired();
  expect(input).toHaveAccessibleDescription("От 16 до 256 px, целое число.");
  fireEvent.change(input, { target: { value: "15" } });
  expect(ref.current?.validity.rangeUnderflow).toBe(true);
  fireEvent.change(input, { target: { value: "64.5" } });
  expect(ref.current?.validity.stepMismatch).toBe(true);
});

it("maps aria-invalid through Gravity validationState without losing linked error text", () => {
  const { rerender } = renderComponent(
    <>
      <p id="field-error">Исправьте поле.</p>
      <FormInput
        aria-label="Название"
        aria-invalid
        aria-describedby="field-error"
      />
    </>,
  );
  const input = screen.getByRole("textbox", { name: "Название" });
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription("Исправьте поле.");
  rerender(
    <>
      <p id="field-error">Исправьте поле.</p>
      <FormInput aria-label="Название" aria-invalid={false} />
    </>,
  );
  expect(input).not.toHaveAttribute("aria-invalid", "true");
});

it("preserves checkbox label/change and native file selection", () => {
  const changed = vi.fn();
  const uploaded = vi.fn();
  const ref = createRef<HTMLInputElement>();
  renderComponent(
    <>
      <FormInput type="checkbox" onChange={changed}>
        Флажок
      </FormInput>
      <FormInput
        type="file"
        aria-label="Файл"
        controlRef={ref}
        onChange={uploaded}
        accept="image/png"
      />
    </>,
  );
  fireEvent.click(screen.getByText("Флажок"));
  expect(changed.mock.lastCall?.[0]?.target.checked).toBe(true);
  const input = screen.getByLabelText("Файл");
  expect(ref.current).toBe(input);
  expect(input).toHaveAttribute("type", "file");
  const file = new File(["fixture"], "map.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
  expect(uploaded.mock.lastCall?.[0]?.target.files[0]).toBe(file);
});

it("forwards textarea accessibility, constraints and the real control ref", () => {
  const ref = createRef<HTMLTextAreaElement>();
  renderComponent(
    <>
      <p id="message-hint">Не больше 40 символов.</p>
      <FormTextArea
        controlRef={ref}
        aria-label="Сообщение или бросок"
        aria-describedby="message-hint"
        aria-invalid
        required
        maxLength={40}
        rows={3}
        defaultValue="Черновик"
      />
    </>,
  );
  expect(
    screen.queryByRole("textbox", { name: "Сообщение или бросок" }),
    "UIX624_TEXTAREA_NATIVE_LABEL",
  ).not.toBeNull();
  const textarea = screen.getByRole("textbox", {
    name: "Сообщение или бросок",
  });
  expect(ref.current).toBe(textarea);
  expect(textarea).toHaveAccessibleDescription("Не больше 40 символов.");
  expect(textarea).toHaveAttribute("aria-invalid", "true");
  expect(textarea).toBeRequired();
  expect(textarea).toHaveAttribute("maxlength", "40");
  expect(textarea).toHaveAttribute("rows", "3");
  expect(textarea).toHaveValue("Черновик");
});

it("keeps native textarea change and paste handlers on the inner control", () => {
  const changed = vi.fn();
  let pasteCurrentTarget: EventTarget | null = null;
  const pasted = vi.fn((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    pasteCurrentTarget = event.currentTarget;
  });
  renderComponent(
    <FormTextArea
      aria-label="Текст события"
      onChange={changed}
      onPaste={pasted}
    />,
  );
  expect(
    screen.queryByRole("textbox", { name: "Текст события" }),
    "UIX624_TEXTAREA_NATIVE_EVENT_CONTROL",
  ).not.toBeNull();
  const textarea = screen.getByRole("textbox", { name: "Текст события" });
  fireEvent.change(textarea, { target: { value: "Новая запись" } });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.lastCall?.[0].target).toBe(textarea);
  fireEvent.paste(textarea, {
    clipboardData: { items: [] },
  });
  expect(pasted).toHaveBeenCalledTimes(1);
  expect(pasteCurrentTarget).toBe(textarea);
});
