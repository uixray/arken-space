// @vitest-environment jsdom
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderComponent, screen } from "../test-support/render";
import { useFollowScroll } from "./useFollowScroll";

/**
 * UIX-401: the pure predicate was tested; the hook around it was not. The
 * reported defect lives in the hook's state — once a reader scrolled away,
 * new rolls stopped following even after they scrolled back down — so it
 * needs the hook exercised, not just the arithmetic.
 *
 * jsdom performs no layout: scrollHeight and clientHeight are 0 and
 * `scrollTo` does not exist. The harness supplies both, which is what lets a
 * scroll position be stated exactly rather than approximated.
 */
let scrolled: number[] = [];

beforeEach(() => {
  scrolled = [];
  // On the prototype rather than the element: the hook scrolls during its
  // mount effect, before a test can reach the node.
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: (options: { top: number }) => scrolled.push(options.top),
  });
});

afterEach(() => vi.unstubAllGlobals());

function measure(
  element: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  for (const [key, value] of Object.entries(metrics))
    Object.defineProperty(element, key, {
      configurable: true,
      writable: true,
      value,
    });
}

function Harness({
  resetKey,
  initialAnchor,
}: {
  resetKey?: string;
  initialAnchor?: { value: string; priority: string };
} = {}) {
  const [items, setItems] = useState(["a"]);
  const { listRef, isAtBottom, newItemCount, onScroll } = useFollowScroll(
    items.at(-1),
    resetKey,
  );
  // A consumer's existing inline style is present before the hook's layout
  // effect. This callback stays stable across ordinary harness state updates.
  const attachList = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      if (node && initialAnchor)
        node.style.setProperty(
          "overflow-anchor",
          initialAnchor.value,
          initialAnchor.priority,
        );
    },
    [initialAnchor, listRef],
  );
  return (
    <>
      <div data-testid="list" ref={attachList} onScroll={onScroll}>
        {items.map((item) => (
          <p key={item}>{item}</p>
        ))}
      </div>
      <span data-testid="at-bottom">{String(isAtBottom)}</span>
      <span data-testid="new-count">{newItemCount}</span>
      <button
        type="button"
        onClick={() =>
          setItems((current) => [...current, `item-${current.length}`])
        }
      >
        append
      </button>
    </>
  );
}

describe("useFollowScroll", () => {
  for (const initialAnchor of [
    { value: "", priority: "" },
    { value: "auto", priority: "important" },
    { value: "none", priority: "important" },
  ]) {
    it(`owns native anchoring only while following and restores ${initialAnchor.value || "absent"}/${initialAnchor.priority || "normal"} through reset and unmount`, async () => {
      const view = renderComponent(
        <Harness resetKey="first" initialAnchor={initialAnchor} />,
      );
      const list = screen.getByTestId("list");
      expect(list.style.getPropertyValue("overflow-anchor")).toBe("none");
      expect(list.style.getPropertyPriority("overflow-anchor")).toBe(
        initialAnchor.priority,
      );
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });

      measure(list, { scrollHeight: 1000, scrollTop: 120, clientHeight: 300 });
      await act(async () => {
        list.dispatchEvent(new Event("scroll"));
      });
      expect(screen.getByTestId("at-bottom").textContent).toBe("false");
      expect(list.style.getPropertyValue("overflow-anchor")).toBe(
        initialAnchor.value,
      );
      expect(list.style.getPropertyPriority("overflow-anchor")).toBe(
        initialAnchor.priority,
      );

      // Reset is the existing explicit return-to-tail contract; it must not
      // lose the consumer's original style across repeated effect cycles.
      view.rerender(
        <Harness resetKey="second" initialAnchor={initialAnchor} />,
      );
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      expect(screen.getByTestId("at-bottom").textContent).toBe("true");
      expect(list.style.getPropertyValue("overflow-anchor")).toBe("none");
      expect(list.style.getPropertyPriority("overflow-anchor")).toBe(
        initialAnchor.priority,
      );

      measure(list, { scrollHeight: 1100, scrollTop: 150, clientHeight: 300 });
      await act(async () => {
        list.dispatchEvent(new Event("scroll"));
      });
      expect(list.style.getPropertyValue("overflow-anchor")).toBe(
        initialAnchor.value,
      );
      expect(list.style.getPropertyPriority("overflow-anchor")).toBe(
        initialAnchor.priority,
      );
      measure(list, { scrollHeight: 1100, scrollTop: 800, clientHeight: 300 });
      await act(async () => {
        list.dispatchEvent(new Event("scroll"));
      });
      expect(list.style.getPropertyValue("overflow-anchor")).toBe("none");
      view.unmount();
      expect(list.style.getPropertyValue("overflow-anchor")).toBe(
        initialAnchor.value,
      );
      expect(list.style.getPropertyPriority("overflow-anchor")).toBe(
        initialAnchor.priority,
      );
    });
  }

  it("does not filter an explicit message jump when dimensions change, and preserves the reader on later resize", async () => {
    let resize = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    renderComponent(<Harness />);
    const list = screen.getByTestId("list");
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    measure(list, { scrollHeight: 1000, scrollTop: 700, clientHeight: 300 });
    await act(async () => {
      list.dispatchEvent(new Event("scroll"));
    });
    scrolled.length = 0;
    // jsdom supplies dimensions only. This tests the unchanged explicit-scroll
    // contract, not the browser's anchoring behavior (covered by real E2E).
    await act(async () => {
      list.scrollTo({ top: 120 });
      measure(list, { scrollHeight: 950, scrollTop: 120, clientHeight: 160 });
      list.dispatchEvent(new Event("scroll"));
      resize();
    });
    expect(scrolled).toEqual([120]);
    expect(screen.getByTestId("at-bottom").textContent).toBe("false");
    expect(list.style.getPropertyValue("overflow-anchor")).toBe("");
    scrolled.length = 0;
    measure(list, { scrollHeight: 1100, scrollTop: 270, clientHeight: 260 });
    await act(async () => {
      resize();
      screen.getByRole("button", { name: "append" }).click();
    });
    expect(scrolled).toEqual([]);
    expect(screen.getByTestId("at-bottom").textContent).toBe("false");
    expect(screen.getByTestId("new-count").textContent).toBe("1");
    expect(list.style.getPropertyValue("overflow-anchor")).toBe("");
  });

  for (const hiddenScrollEvent of [false, true]) {
    it(`restores a retained reader after hidden geometry (scroll event: ${hiddenScrollEvent})`, async () => {
      let resize = () => {};
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: () => void) {
            resize = callback;
          }
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      renderComponent(<Harness />);
      const list = screen.getByTestId("list");
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      scrolled.length = 0;

      measure(list, { scrollHeight: 1000, scrollTop: 120, clientHeight: 300 });
      await act(async () => {
        list.dispatchEvent(new Event("scroll"));
        resize();
      });
      expect(screen.getByTestId("at-bottom").textContent).toBe("false");
      expect(scrolled).toEqual([]);

      // Firefox may reset display:none scrollTop to zero. Neither the zero
      // geometry nor an optional resulting scroll event represents the reader.
      measure(list, { scrollHeight: 0, scrollTop: 0, clientHeight: 0 });
      await act(async () => {
        if (hiddenScrollEvent) list.dispatchEvent(new Event("scroll"));
        resize();
        screen.getByRole("button", { name: "append" }).click();
      });
      expect(screen.getByTestId("at-bottom").textContent).toBe("false");
      expect(screen.getByTestId("new-count").textContent).toBe("1");

      measure(list, { scrollHeight: 1100, scrollTop: 0, clientHeight: 300 });
      await act(async () => {
        // A visible scroll event can precede ResizeObserver on reopening.
        list.dispatchEvent(new Event("scroll"));
        resize();
      });
      expect(scrolled).toEqual([120]);
      expect(screen.getByTestId("at-bottom").textContent).toBe("false");
      expect(screen.getByTestId("new-count").textContent).toBe("1");

      // Subsequent ordinary visible resizing must not replay the saved top.
      scrolled.length = 0;
      measure(list, { scrollHeight: 1400, scrollTop: 240, clientHeight: 300 });
      await act(async () => {
        list.dispatchEvent(new Event("scroll"));
        resize();
      });
      expect(scrolled).toEqual([]);

      measure(list, { scrollHeight: 0, scrollTop: 0, clientHeight: 0 });
      await act(async () => resize());
      measure(list, { scrollHeight: 1400, scrollTop: 0, clientHeight: 300 });
      await act(async () => resize());
      expect(scrolled).toEqual([240]);
    });
  }

  it("resumes following after the reader scrolls back to the bottom", async () => {
    renderComponent(<Harness />);
    const list = screen.getByTestId("list");
    // The mount effect jumps to the bottom inside a rAF callback. Let that
    // land before recording, or it shows up as a scroll the test did not ask
    // for and hides whichever behaviour is under test.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    scrolled.length = 0;

    // Reader scrolls up, away from the tail.
    measure(list, { scrollHeight: 1000, scrollTop: 100, clientHeight: 300 });
    await act(async () => {
      list.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByTestId("at-bottom").textContent).toBe("false");

    // A roll arrives: the list must stay put and count it instead.
    await act(async () => {
      screen.getByRole("button", { name: "append" }).click();
    });
    expect(scrolled).toHaveLength(0);
    expect(screen.getByTestId("new-count").textContent).toBe("1");

    // Reader scrolls back down to the bottom.
    measure(list, { scrollHeight: 1000, scrollTop: 700, clientHeight: 300 });
    await act(async () => {
      list.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByTestId("at-bottom").textContent).toBe("true");
    expect(screen.getByTestId("new-count").textContent).toBe("0");

    // The next roll must follow again — this is the reported failure.
    await act(async () => {
      screen.getByRole("button", { name: "append" }).click();
    });
    expect(scrolled).toEqual([1000]);
  });
});
