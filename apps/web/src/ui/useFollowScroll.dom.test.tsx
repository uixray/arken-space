// @vitest-environment jsdom
import { act, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderComponent, screen } from "../test-support/render";
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
