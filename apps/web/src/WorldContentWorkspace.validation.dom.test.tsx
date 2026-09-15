// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "@gravity-ui/uikit";
import {
  fireEvent,
  renderComponent,
  screen,
  waitFor,
  within,
} from "./test-support/render";
import { WorldContentWorkspace } from "./WorldContentWorkspace";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: apiMock,
}));

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue([]);
  // Keep real Gravity controls, validationState forwarding, dialogs and refs.
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

async function openCreation() {
  renderComponent(
    <WorldContentWorkspace open assets={[]} onClose={() => {}} />,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ThemeProvider theme="dark" lang="ru">
          {children}
        </ThemeProvider>
      ),
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Создать сущность" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Новая сущность энциклопедии",
  });
  return {
    dialog,
    name: within(dialog).getByRole("textbox", {
      name: "Название",
    }),
    slug: within(dialog).getByRole("textbox", {
      name: "Идентификатор",
    }),
    submit: within(dialog).getByRole("button", {
      name: "Создать",
    }),
  };
}

function mutations() {
  return apiMock.mock.calls.filter(([, init]) =>
    ["POST", "PUT", "PATCH", "DELETE"].includes(
      (init as RequestInit | undefined)?.method ?? "GET",
    ),
  );
}

it("empty submit identifies and focuses the required name without a request", async () => {
  const { name, slug, submit } = await openCreation();
  expect(name).not.toHaveAttribute("aria-invalid", "true");
  expect(slug).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.click(submit);
  await waitFor(() => expect(name).toHaveFocus());
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription("Укажите название.");
  expect(slug).not.toHaveAttribute("aria-invalid", "true");
  expect(slug).not.toHaveAttribute("aria-describedby");
  expect(mutations()).toHaveLength(0);
  fireEvent.change(name, { target: { value: "Waterdeep" } });
  expect(name).not.toHaveAttribute("aria-invalid", "true");
  expect(name).not.toHaveAttribute("aria-describedby");
  expect(slug).toHaveValue("waterdeep");
  expect(slug).not.toHaveAttribute("aria-invalid", "true");
});

it("slug errors keep a stable name and linked description, clear on correction", async () => {
  const { dialog, name, slug, submit } = await openCreation();
  fireEvent.change(name, { target: { value: "Waterdeep" } });
  fireEvent.change(slug, { target: { value: "INVALID SLUG" } });
  const errorId = slug.getAttribute("aria-describedby");
  expect(errorId).toBeTruthy();
  expect(slug).toHaveAccessibleName("Идентификатор");
  expect(slug).toHaveAttribute("aria-invalid", "true");
  expect(slug).toHaveAccessibleDescription(
    "Только строчные латинские буквы, цифры и дефисы.",
  );
  fireEvent.click(submit);
  await waitFor(() => expect(slug).toHaveFocus());
  expect(mutations()).toHaveLength(0);
  // An explicitly empty manual slug is invalid after submit too.
  fireEvent.change(slug, { target: { value: "" } });
  expect(slug).toHaveAttribute("aria-invalid", "true");
  expect(slug).toHaveAttribute("aria-describedby", errorId!);
  expect(slug).toHaveAccessibleDescription(
    "Укажите идентификатор, например waterdeep.",
  );
  fireEvent.click(submit);
  expect(mutations()).toHaveLength(0);
  fireEvent.change(slug, { target: { value: "a".repeat(161) } });
  expect(slug).toHaveAttribute("aria-invalid", "true");
  expect(slug).toHaveAccessibleDescription(
    "Идентификатор — не больше 160 символов.",
  );
  fireEvent.click(submit);
  expect(mutations()).toHaveLength(0);
  fireEvent.change(slug, { target: { value: "waterdeep-gate" } });
  expect(slug).not.toHaveAttribute("aria-invalid", "true");
  expect(slug).not.toHaveAttribute("aria-describedby");
  expect(document.getElementById(errorId!)).toBeNull();
  expect(
    within(dialog).queryByText(/Идентификатор должен/),
  ).not.toBeInTheDocument();
  fireEvent.change(name, { target: { value: "New name" } });
  expect(slug).toHaveValue("waterdeep-gate");
});
