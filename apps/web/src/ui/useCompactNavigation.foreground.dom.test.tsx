// @vitest-environment jsdom
import { createPortal } from "react-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
} from "../test-support/render";
import { CompactNavigation } from "../CompactNavigation";
import {
  COMPACT_LAYOUT_QUERY,
  useCompactNavigation,
} from "./useCompactNavigation";

let compact = false;
const subscribers = new Set<() => void>();
beforeEach(() => {
  compact = false;
  subscribers.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === COMPACT_LAYOUT_QUERY && compact,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_type: string, changed: () => void) =>
      subscribers.add(changed),
    removeEventListener: (_type: string, changed: () => void) =>
      subscribers.delete(changed),
  }));
});
afterEach(() => vi.unstubAllGlobals());

function resize(next: boolean) {
  act(() => {
    compact = next;
    for (const changed of subscribers) changed();
  });
}

function Owner({ identity = "campaign:member" }: { identity?: string }) {
  const navigation = useCompactNavigation(identity, null);
  return (
    <>
      <main
        id="main-content"
        tabIndex={-1}
        hidden={navigation.compact && navigation.surface !== "map"}
      >
        <button type="button">Карта control</button>
      </main>
      <aside
        id="activity-sidebar"
        tabIndex={-1}
        hidden={navigation.compact && navigation.surface !== "journal"}
        inert={navigation.compact && navigation.surface !== "journal"}
      >
        <button type="button">Стикер trigger</button>
        <input aria-label="Journal composer" />
        <span>Journal pointer target</span>
      </aside>
      {createPortal(<input aria-label="Portaled search" />, document.body)}
      {navigation.compact && (
        <CompactNavigation
          active={navigation.surface}
          onSelect={(next) => navigation.selectSurface(next, false)}
          characterVisited={false}
          characterAvailable={false}
        />
      )}
    </>
  );
}

// DOM verifies ownership/state, not Popup positioning or physical resize.
// Existing sticker-picker-lifecycle App browser cases retain the real popup,
// query, target size, viewport-fit and hidden-owner persistence assertions.
it("retains initial Map for untouched desktop-to-compact sessions", () => {
  renderComponent(<Owner />);
  resize(true);
  expect(screen.getByRole("button", { name: "Карта" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(document.getElementById("activity-sidebar")).toHaveAttribute("hidden");
});

it("keeps the focused desktop journal visible when focus moves into its portal", () => {
  renderComponent(<Owner />);
  act(() => screen.getByRole("button", { name: "Стикер trigger" }).focus());
  act(() => screen.getByRole("textbox", { name: "Portaled search" }).focus());
  resize(true);
  expect(screen.getByRole("button", { name: "Журнал" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(document.getElementById("activity-sidebar")).not.toHaveAttribute(
    "hidden",
  );
  expect(document.getElementById("activity-sidebar")).not.toHaveAttribute(
    "inert",
  );
});

it("tracks nonfocusable desktop pointer foreground before portal focus", () => {
  renderComponent(<Owner />);
  fireEvent.pointerDown(screen.getByText("Journal pointer target"));
  act(() => screen.getByRole("textbox", { name: "Portaled search" }).focus());
  resize(true);
  expect(document.getElementById("activity-sidebar")).not.toHaveAttribute(
    "hidden",
  );
  expect(screen.getByRole("button", { name: "Журнал" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("keeps Map when later pointer interaction moves foreground back from journal", () => {
  renderComponent(<Owner />);
  act(() => screen.getByRole("textbox", { name: "Journal composer" }).focus());
  fireEvent.pointerDown(screen.getByRole("button", { name: "Карта control" }));
  resize(true);
  expect(screen.getByRole("button", { name: "Карта" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(document.getElementById("activity-sidebar")).toHaveAttribute("hidden");
});

it("does not override explicit compact Map navigation with cached journal ownership", () => {
  renderComponent(<Owner />);
  act(() => screen.getByRole("textbox", { name: "Journal composer" }).focus());
  resize(true);
  fireEvent.click(screen.getByRole("button", { name: "Карта" }));
  expect(document.getElementById("activity-sidebar")).toHaveAttribute("hidden");
  expect(screen.getByRole("button", { name: "Карта" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("does not carry desktop foreground across actor or campaign identity changes", () => {
  const owner = renderComponent(<Owner />);
  act(() => screen.getByRole("textbox", { name: "Journal composer" }).focus());
  act(() => screen.getByRole("textbox", { name: "Portaled search" }).focus());
  owner.rerender(<Owner identity="new-campaign:new-member" />);
  resize(true);
  expect(screen.getByRole("button", { name: "Карта" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(document.getElementById("activity-sidebar")).toHaveAttribute("hidden");
});
