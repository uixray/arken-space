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
import { FormInput, FormSelect, FormTextArea } from "./GravityFormControls";
import userEvent from "@testing-library/user-event";

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

it("forwards textarea identity, validation, descriptions and native callbacks to the real control", () => {
  const ref = createRef<HTMLTextAreaElement>();
  const changed = vi.fn();
  const keyed = vi.fn();
  const pasted = vi.fn();
  const { rerender } = renderComponent(
    <>
      <p id="composer-error">Укажите формулу.</p>
      <FormTextArea
        controlRef={ref}
        aria-label="Сообщение или бросок"
        aria-invalid
        aria-describedby="composer-error"
        aria-controls="composer-options"
        maxLength={500}
        defaultValue="/roll"
        onChange={changed}
        onKeyDown={keyed}
        onPaste={pasted}
      />
      <div id="composer-options">Команды</div>
    </>,
  );
  const input = screen.getByRole("textbox", { name: "Сообщение или бросок" });
  expect(ref.current).toBe(input);
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription("Укажите формулу.");
  // A multiline textbox is not a disclosure/combobox; the command button
  // owns aria-expanded, while the textarea may reference the controlled list.
  expect(input).not.toHaveAttribute("aria-expanded");
  expect(input).toHaveAttribute("aria-controls", "composer-options");
  expect(input).toHaveAttribute("maxlength", "500");
  fireEvent.change(input, { target: { value: "/roll 1d20" } });
  expect(changed.mock.lastCall?.[0]?.target).toBe(input);
  expect(input).toHaveValue("/roll 1d20");
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  expect(keyed.mock.lastCall?.[0]?.ctrlKey).toBe(true);
  fireEvent.paste(input);
  expect(pasted).toHaveBeenCalledTimes(1);
  rerender(
    <FormTextArea
      controlRef={ref}
      aria-label="Сообщение или бросок"
      aria-invalid={false}
    />,
  );
  const validInput = screen.getByRole("textbox", {
    name: "Сообщение или бросок",
  });
  expect(validInput).not.toHaveAttribute("aria-invalid", "true");
  expect(validInput).not.toHaveAttribute("aria-describedby");
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

it("preserves checkbox native identity, validation, descriptions, ref and real events", () => {
  const ref = createRef<HTMLInputElement>();
  const changed = vi.fn();
  const focused = vi.fn();
  const blurred = vi.fn();
  const keyed = vi.fn();
  renderComponent(
    <>
      <p id="check-hint">Нужно подтверждение перед продолжением.</p>
      <FormInput
        type="checkbox"
        id="confirmation"
        name="confirmation"
        value="accepted"
        controlRef={ref}
        required
        aria-invalid
        aria-describedby="check-hint"
        onFocus={focused}
        onBlur={blurred}
        onKeyDown={keyed}
        onChange={(event) =>
          changed(
            event.target,
            event.currentTarget,
            event.target.checked,
            event.target.value,
          )
        }
      >
        Подтверждаю
      </FormInput>
    </>,
  );
  const input = screen.getByRole("checkbox", { name: "Подтверждаю" });
  expect(ref.current).toBe(input);
  expect(input).toHaveAttribute("id", "confirmation");
  expect(input).toHaveAttribute("name", "confirmation");
  expect(input).toHaveAccessibleDescription(
    "Нужно подтверждение перед продолжением.",
  );
  expect(input).toBeRequired();
  expect(input).toHaveAttribute("aria-invalid", "true");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: " " });
  fireEvent.click(input);
  fireEvent.blur(input);
  expect(changed).toHaveBeenCalledExactlyOnceWith(
    input,
    input,
    true,
    "accepted",
  );
  expect(focused).toHaveBeenCalledOnce();
  expect(blurred).toHaveBeenCalledOnce();
  expect(keyed).toHaveBeenCalledOnce();
});

it("keeps Select identity, accessible error and validation on its trigger", () => {
  const { rerender } = renderComponent(
    <>
      <span id="select-name">Изображение</span>
      <p id="select-error">Выберите изображение.</p>
      <FormSelect
        id="image-choice"
        aria-labelledby="select-name"
        aria-describedby="select-error"
        aria-invalid
        value=""
      >
        <option value="">Нет</option>
      </FormSelect>
    </>,
  );
  const trigger = screen.getByRole("combobox", { name: "Изображение" });
  expect(trigger).toHaveAttribute("id", "image-choice");
  expect(trigger).toHaveAccessibleDescription("Выберите изображение.");
  expect(trigger).toHaveAttribute("aria-invalid", "true");
  rerender(
    <FormSelect aria-label="Изображение" aria-invalid="false" value="">
      <option value="">Нет</option>
    </FormSelect>,
  );
  expect(
    screen.getByRole("combobox", { name: "Изображение" }),
  ).not.toHaveAttribute("aria-invalid", "true");
});

it("retains an uncontrolled Select choice without selecting the create utility action", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  const create = vi.fn();
  renderComponent(
    <FormSelect
      aria-label="Изображение"
      defaultValue="portrait"
      onChange={changed}
      createAction={{ label: "Создать", onSelect: create }}
    >
      <option value="portrait">Портрет</option>
      <option value="marker">Маркер</option>
    </FormSelect>,
  );
  const trigger = screen.getByRole("combobox", { name: "Изображение" });
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: "Маркер" }));
  expect(trigger).toHaveTextContent("Маркер");
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.lastCall?.[0].target.value).toBe("marker");
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: "Создать" }));
  expect(create).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(trigger).toHaveTextContent("Маркер");
});

it.each([
  {
    value: "entity-id",
    label: ["Silverymoon", " (", "Локация", ")"],
    expected: "Silverymoon (Локация)",
  },
  { value: "zero-id", label: ["Зарядов: ", 0], expected: "Зарядов: 0" },
])(
  "keeps compound option text instead of exposing $value",
  ({ value, label, expected }) => {
    renderComponent(
      <FormSelect aria-label="Цель" value={value}>
        <option value={value}>{label}</option>
      </FormSelect>,
    );
    expect(screen.getByRole("combobox", { name: "Цель" })).toHaveTextContent(
      expected,
    );
    expect(
      screen.getByRole("combobox", { name: "Цель" }),
    ).not.toHaveTextContent(value);
  },
);

it("refreshes open popup content width after the trigger resizes without losing selection", async () => {
  const user = userEvent.setup();
  const { container } = renderComponent(
    <FormSelect aria-label="Размер списка" defaultValue="one">
      <option value="one">Первый</option>
      <option value="two">Второй</option>
    </FormSelect>,
  );
  const trigger = screen.getByRole("combobox", { name: "Размер списка" });
  let width = 320;
  const measured = vi
    .spyOn(trigger, "getBoundingClientRect")
    .mockImplementation(() => new DOMRect(0, 0, width, 32));
  try {
    await user.click(trigger);
    const content = () =>
      document.querySelector<HTMLElement>(".arken-form-select-popup__content");
    await expect.poll(() => content()?.style.width).toBe("320px");
    width = 160;
    fireEvent(window, new Event("resize"));
    await expect.poll(() => content()?.style.width).toBe("160px");
    expect(trigger).toHaveTextContent("Первый");
    expect(trigger).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(container).toContainElement(trigger);
  } finally {
    measured.mockRestore();
  }
});
