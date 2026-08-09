import { describe, expect, it } from "vitest";
import { decideComposerKeydown } from "./composer-keyboard-intent";

function key(overrides: Partial<Parameters<typeof decideComposerKeydown>[0]>) {
  return decideComposerKeydown({
    key: "Enter",
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides,
  });
}

describe("decideComposerKeydown (UIX-388)", () => {
  it("Enter alone sends publicly", () => {
    expect(key({})).toBe("SEND_PUBLIC");
  });

  it("Ctrl+Enter sends GM-only", () => {
    expect(key({ ctrlKey: true })).toBe("SEND_GM_ONLY");
  });

  it("Shift+Enter inserts a newline instead of submitting", () => {
    expect(key({ shiftKey: true })).toBe("NEWLINE");
  });

  it("Shift+Ctrl+Enter still inserts a newline (shift wins)", () => {
    expect(key({ shiftKey: true, ctrlKey: true })).toBe("NEWLINE");
  });

  it("an in-progress IME composition never submits, even with Ctrl held", () => {
    expect(key({ isComposing: true })).toBe("IGNORE");
    expect(key({ isComposing: true, ctrlKey: true })).toBe("IGNORE");
  });

  it("ignores every key other than Enter", () => {
    expect(key({ key: "a" })).toBe("IGNORE");
    expect(key({ key: "Tab" })).toBe("IGNORE");
    expect(key({ key: "Escape" })).toBe("IGNORE");
  });
});
