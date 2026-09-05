// @vitest-environment jsdom
import { useState } from "react";
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

function Harness() {
  const [items, setItems] = useState(["a"]);
  const { listRef, isAtBottom, newItemCount, onScroll } = useFollowScroll(
    items.at(-1),
  );
  return (
    <>
      <div data-testid="list" ref={listRef} onScroll={onScroll}>
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
