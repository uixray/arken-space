import type { Locator } from "@playwright/test";

/** Await running CSS transitions, not every declared duration on idle ancestors. */
export async function settleActiveIconTransitions(control: Locator) {
  return control.evaluate(async (element) => {
    const nodes = new Set<Element>([
      element,
      ...element.querySelectorAll("svg,svg *"),
    ]);
    for (let node = element.parentElement; node; node = node.parentElement)
      nodes.add(node);
    const seconds = (value: string) =>
      value.endsWith("ms") ? parseFloat(value) / 1000 : parseFloat(value);
    // Preserve unsupported-long-transition rejection even in currently idle states.
    for (const node of nodes)
      for (const style of [
        getComputedStyle(node),
        getComputedStyle(node, "::before"),
        getComputedStyle(node, "::after"),
      ]) {
        const durations = style.transitionDuration.split(",").map(seconds);
        const delays = style.transitionDelay.split(",").map(seconds);
        if (
          durations.some(
            (duration, index) => duration + delays[index % delays.length] > 1,
          )
        )
          throw new Error("Long transition needs explicit state acceptance");
      }
    const paint = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    const started = performance.now();
    for (;;) {
      await paint();
      const running = new Set<Animation>();
      // Element.getAnimations can omit pseudo transitions; document inventory includes them.
      for (const animation of document.getAnimations()) {
        if (
          animation instanceof CSSTransition &&
          animation.effect instanceof KeyframeEffect &&
          nodes.has(animation.effect.target as Element) &&
          animation.playState !== "finished" &&
          animation.playState !== "idle"
        )
          running.add(animation);
      }
      if (!running.size) return;
      if (performance.now() - started > 1500)
        throw new Error("Icon transitions did not settle");
      // Cancellation means changed style, not accepted paint: always re-scan afterward.
      const finished = Promise.all(
        [...running].map((animation) =>
          animation.finished.catch((error) => {
            if (!(error instanceof DOMException && error.name === "AbortError"))
              throw error;
          }),
        ),
      );
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          finished,
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error("Icon transitions did not settle")),
              Math.max(0, 1500 - (performance.now() - started)),
            );
          }),
        ]);
      } finally {
        clearTimeout(deadline);
      }
    }
  });
}
