import { describe, expect, it } from "vitest";
import { resolveMapEscapeIntent } from "./map-escape";

describe("map Escape layering", () => {
  it("lets an open object list consume Escape before map selection is cleared", () => {
    expect(
      resolveMapEscapeIntent({ key: "Escape", objectListOpen: true }),
    ).toBe("close-object-list");
  });

  it("allows a subsequent Escape to clear map state after the list closes", () => {
    expect(
      resolveMapEscapeIntent({ key: "Escape", objectListOpen: false }),
    ).toBe("clear-map-state");
  });

  it("does not consume unrelated keys", () => {
    expect(resolveMapEscapeIntent({ key: "Enter", objectListOpen: true })).toBe(
      "ignore",
    );
  });
});

it.each([false, true])(
  "keeps selection when token menu consumes Escape (object list %s)",
  (objectListOpen) => {
    expect(
      resolveMapEscapeIntent({
        key: "Escape",
        objectListOpen,
        tokenMenuOpen: true,
      }),
    ).toBe("close-token-menu");
  },
);
it("does not consume non-Escape keys while a token menu is open", () => {
  expect(
    resolveMapEscapeIntent({
      key: "Enter",
      objectListOpen: false,
      tokenMenuOpen: true,
    }),
  ).toBe("ignore");
});
