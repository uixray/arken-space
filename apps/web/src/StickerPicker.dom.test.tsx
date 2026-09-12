// @vitest-environment jsdom
import { useState, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "@gravity-ui/uikit";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "./test-support/render";
import { api } from "./api";
import { StickerPicker } from "./StickerPicker";
import { stickerPack } from "./test-support/sticker-fixtures";
import { ArkenDialog } from "./ui/ArkenDialog";

vi.mock("./api", () => ({ api: vi.fn() }));

beforeEach(() => {
  vi.mocked(api).mockResolvedValue([stickerPack()]);
  // Only missing browser APIs are shimmed; Popup/focus/layer code stays real.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function render(ui: ReactElement) {
  return renderComponent(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ThemeProvider theme="dark" lang="ru">
        {children}
      </ThemeProvider>
    ),
  });
}

async function openPicker() {
  const trigger = screen.getByRole("button", { name: "Стикеры" });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByRole("option", { name: "Стикер 1" });
  return trigger;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

for (const variant of ["workspace", "modal"] as const) {
  it(`Escape closes the picker, not its ${variant}, and returns focus`, async () => {
    const close = vi.fn();
    render(
      <ArkenDialog open variant={variant} title="Стикеры в окне" onClose={close}>
        <StickerPicker onSelect={async () => {}} />
      </ArkenDialog>,
    );
    const trigger = await openPicker();
    const panel = screen.getByRole("dialog", { name: "Выбор стикера" });
    expect(trigger).toHaveAttribute("aria-controls", panel.id);
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    await waitFor(() => expect(panel).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(close).not.toHaveBeenCalled();
  });
}

for (const outcome of ["resolve", "reject"] as const) {
  it(`late ${outcome} cannot close or add an error to a reopened picker`, async () => {
    const pending = deferred();
    const send = vi.fn(() => pending.promise);
    render(<StickerPicker onSelect={send} />);
    const trigger = await openPicker();
    fireEvent.click(screen.getByRole("option", { name: "Стикер 1" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(stickerPack().stickers[0]!.id);
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "false"),
    );
    await openPicker();
    expect(screen.getByRole("option", { name: "Стикер 1" })).toBeDisabled();
    await act(async () => {
      if (outcome === "resolve") pending.resolve();
      else pending.reject(new Error("Synthetic send failure"));
      await pending.promise.catch(() => {});
    });
    expect(screen.getByRole("dialog", { name: "Выбор стикера" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Стикер 1" })).toBeEnabled();
  });
}

it("current-session rejection stays open and a retry can succeed", async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error("Synthetic failure"))
    .mockResolvedValueOnce(undefined);
  render(<StickerPicker onSelect={send} />);
  const trigger = await openPicker();
  fireEvent.click(screen.getByRole("option", { name: "Стикер 1" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Не удалось отправить стикер.",
  );
  fireEvent.click(screen.getByRole("option", { name: "Стикер 1" }));
  await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  expect(send).toHaveBeenCalledTimes(2);
});

it("disabled and hidden cached owners dismiss their document-level portal", async () => {
  function Owner() {
    const [disabled, setDisabled] = useState(false);
    const [hidden, setHidden] = useState(false);
    return (
      <>
        <button onClick={() => setDisabled((value) => !value)}>Доступ</button>
        <button onClick={() => setHidden((value) => !value)}>Владелец</button>
        <section hidden={hidden} inert={hidden}>
          <StickerPicker disabled={disabled} onSelect={async () => {}} />
        </section>
      </>
    );
  }
  render(<Owner />);
  const trigger = await openPicker();
  // fireEvent.click does not emit outside-press or move focus: these closures
  // must come from disabled/owner lifecycle, not incidental pointer dismissal.
  fireEvent.click(screen.getByRole("button", { name: "Доступ" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Выбор стикера" }),
    ).not.toBeInTheDocument(),
  );
  expect(trigger).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Доступ" }));
  await openPicker();
  fireEvent.click(screen.getByRole("button", { name: "Владелец" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Выбор стикера" }),
    ).not.toBeInTheDocument(),
  );
  expect(document.querySelector(".sticker-picker-panel")).toBeNull();
});
