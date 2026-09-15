import { type Locator } from "@playwright/test";

// Structural-only, bounded capture: never inspect text, attributes, or requests.
export async function captureAuthClickDiagnostics(button: Locator) {
  const recorder = await button.evaluateHandle((element) => {
    const events: unknown[] = [];
    const round = (value: number) => Math.round(value * 100) / 100;
    const ancestry = (target: EventTarget | null) => {
      const result: { tag: string; classes: string[] }[] = [];
      let node = target instanceof Element ? target : null;
      for (let depth = 0; node && depth < 5; depth += 1) {
        result.push({
          tag: node.tagName.toLowerCase(),
          // Only known static login/UIKit classes; no user-derived class names.
          classes: Array.from(node.classList)
            .filter((name) =>
              /^(?:g-button(?:__[a-z-]+|_[a-z-]+)?|landing-(?:shell|header|hero|intro|kicker|note|badge)|auth-panel|wordmark|error-box)$/.test(
                name,
              ),
            )
            .slice(0, 6),
        });
        node = node.parentElement;
      }
      return result;
    };
    const capture = (event: Event) => {
      if (events.length >= 12) return;
      const rect = element.getBoundingClientRect();
      const pointer = event instanceof MouseEvent;
      events.push({
        type: event.type,
        stamp: round(performance.now()),
        fonts: document.fonts.status,
        point: pointer
          ? { x: round(event.clientX), y: round(event.clientY) }
          : null,
        button: {
          connected: element.isConnected,
          x: round(rect.x),
          y: round(rect.y),
          width: round(rect.width),
          height: round(rect.height),
        },
        target: ancestry(event.target),
        hit: pointer
          ? ancestry(document.elementFromPoint(event.clientX, event.clientY))
          : null,
      });
    };
    const types = [
      "pointerdown",
      "pointerup",
      "pointercancel",
      "click",
      "submit",
    ];
    for (const type of types) document.addEventListener(type, capture, true);
    return {
      read: () => ({ version: 1, events }),
      dispose: () => {
        for (const type of types)
          document.removeEventListener(type, capture, true);
      },
    };
  });
  return {
    read: () =>
      recorder
        .evaluate((value) => value.read())
        .catch(() => ({
          version: 1,
          unavailable: true,
        })),
    dispose: async () => {
      // Navigation can destroy the old document; never mask the sign-in failure.
      await recorder.evaluate((value) => value.dispose()).catch(() => {});
      await recorder.dispose().catch(() => {});
    },
  };
}
