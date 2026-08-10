// @vitest-environment jsdom
import { useCallback, useState } from "react";
import { describe, expect, it } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { useLatestRef } from "./use-latest-ref";

/**
 * The two properties that make this worth having, both of which have to hold
 * at once — a ref that stayed fresh but broke handler identity, or a stable
 * handler that read stale data, would each be worse than no indirection.
 */
function Harness({ onRead }: { onRead: (value: number) => void }) {
  const [count, setCount] = useState(0);
  const latest = useLatestRef(count);
  // Deliberately no dependency on `count`: the whole point is that this
  // handler is built once and still sees the current value.
  //
  // The React Compiler declines to optimize this component because it infers
  // a dependency on `latest.current` that the written list does not contain.
  // That is the pattern under test, not a defect in it — reading a ref is how
  // the handler stays stable — so the rule is silenced here and only here.
  // Bailing out costs nothing: the manual memo is what the test asserts.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const read = useCallback(() => onRead(latest.current), [latest, onRead]);
  return (
    <>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        increment
      </button>
      <button type="button" onClick={read}>
        read
      </button>
    </>
  );
}

describe("useLatestRef", () => {
  it("lets a handler with no dependency on the value still read the current one", async () => {
    const readings: number[] = [];
    renderComponent(<Harness onRead={(value) => readings.push(value)} />);
    const increment = screen.getByRole("button", { name: "increment" });
    const read = screen.getByRole("button", { name: "read" });

    await userEvent.click(read);
    await userEvent.click(increment);
    await userEvent.click(increment);
    await userEvent.click(read);

    // Without the ref the second reading would still be 0, since the handler
    // closed over the first render's state.
    expect(readings).toEqual([0, 2]);
  });

  it("returns the same ref object across renders", async () => {
    const seen: unknown[] = [];
    function RefIdentity() {
      const [tick, setTick] = useState(0);
      seen.push(useLatestRef(tick));
      return (
        <button type="button" onClick={() => setTick(tick + 1)}>
          rerender
        </button>
      );
    }
    renderComponent(<RefIdentity />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByRole("button"));

    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const ref of seen.slice(1)) expect(ref).toBe(seen[0]);
  });
});
