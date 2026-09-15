// @vitest-environment jsdom
import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const hidden = navigation.compact && navigation.surface !== "journal";
  useLayoutEffect(() => {
    if (open && !hidden && anchorRef.current)
      return retainJournalPopupOwner(anchorRef.current);
  }, [open, hidden]);
  return (
    <>
      <main
        id="main-content"
        tabIndex={-1}
        hidden={navigation.compact && navigation.surface !== "map"}
      >
        <button type="button">Карта control</button>
      </main>
      <aside id="activity-sidebar" tabIndex={-1} hidden={hidden} inert={hidden}>
        <button ref={anchorRef} type="button" onClick={() => setOpen(!open)}>
          Стикер trigger
        </button>
        <input aria-label="Journal composer" />
        <button type="button">Desktop collapse control</button>
      </aside>
      {open &&
        !hidden &&
        createPortal(
          <div>
            <input aria-label="Portaled search" defaultValue="Стикер" />
            <button type="button" onClick={() => setOpen(false)}>
              Close portal
            </button>
          </div>,
          document.body,
        )}
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

// DOM checks the narrow owner lease, not actual Popup positioning/lifecycle.
// Existing actual-App sticker browser cases retain real portal/query/geometry
// persistence and hidden/inert-owner cleanup assertions without modifications.
it("retains initial Map for untouched desktop-to-compact sessions", () => {
  renderComponent(<Owner />);
  resize(true);
  expect(screen.getByRole("button", { name: "Карта" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(document.getElementById("activity-sidebar")).toHaveAttribute("hidden");
});

it("does not change Map for ordinary composer focus, pointer or collapse controls", () => {
  renderComponent(<Owner />);
  act(() => screen.getByRole("textbox", { name: "Journal composer" }).focus());
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Desktop collapse control" }),
  );
  act(() =>
    screen.getByRole("button", { name: "Desktop collapse control" }).focus(),
  );
  resize(true);
  expect(screen.getByRole("button", { name: "Карта" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(document.getElementById("activity-sidebar")).toHaveAttribute("hidden");
});

it("does not treat a focused but unopened popup trigger as an active lease", () => {
  renderComponent(<Owner />);
  act(() => screen.getByRole("button", { name: "Стикер trigger" }).focus());
  resize(true);
  expect(screen.getByRole("button", { name: "Карта" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("preserves only an actually open journal portal before breakpoint hides owners", () => {
  renderComponent(<Owner />);
  fireEvent.click(screen.getByRole("button", { name: "Стикер trigger" }));
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
  expect(screen.getByRole("textbox", { name: "Portaled search" })).toHaveValue(
    "Стикер",
  );
  fireEvent.click(screen.getByRole("button", { name: "Close portal" }));
  // Closing the resized popup does not unexpectedly switch its visible parent.
  expect(screen.getByRole("button", { name: "Журнал" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("restores ordinary Map policy if the popup closes before breakpoint", () => {
  renderComponent(<Owner />);
  fireEvent.click(screen.getByRole("button", { name: "Стикер trigger" }));
  fireEvent.click(screen.getByRole("button", { name: "Close portal" }));
  resize(true);
  expect(screen.getByRole("button", { name: "Карта" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("does not override explicit compact Map navigation with an active popup lease", () => {
  renderComponent(<Owner />);
  fireEvent.click(screen.getByRole("button", { name: "Стикер trigger" }));
  resize(true);
  fireEvent.click(screen.getByRole("button", { name: "Карта" }));
  expect(document.getElementById("activity-sidebar")).toHaveAttribute("hidden");
  expect(screen.getByRole("button", { name: "Карта" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.queryByRole("textbox", { name: "Portaled search" }),
  ).not.toBeInTheDocument();
});

it("does not carry an existing popup lease across actor or campaign changes", () => {
  const owner = renderComponent(<Owner />);
  fireEvent.click(screen.getByRole("button", { name: "Стикер trigger" }));
  const alternate = document.createElement("button");
  document.getElementById("activity-sidebar")!.append(alternate);
  let releaseAlternate!: () => void;
  act(() => {
    releaseAlternate = retainJournalPopupOwner(alternate);
  });
  owner.rerender(<Owner identity="new-campaign:new-member" />);
  // Reannouncing the older, still-connected anchor is cleanup, not a new lease.
  act(() => releaseAlternate());
  resize(true);
  expect(screen.getByRole("button", { name: "Карта" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(document.getElementById("activity-sidebar")).toHaveAttribute("hidden");
});

it("retains explicit Journal preference even without a popup", () => {
  renderComponent(<Owner />);
  resize(true);
  fireEvent.click(screen.getByRole("button", { name: "Журнал" }));
  resize(false);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Карта control" }));
  resize(true);
  expect(screen.getByRole("button", { name: "Журнал" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
