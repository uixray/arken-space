import { describe, expect, it } from "vitest";
import { isDirectTokenDrag } from "./token-drag-event";

describe("isDirectTokenDrag", () => {
  it("accepts a drag emitted by the token group itself", () => {
    const tokenGroup = {};
    expect(isDirectTokenDrag(tokenGroup, tokenGroup)).toBe(true);
  });

  it("rejects a resize-handle drag bubbled to the token group", () => {
    const tokenGroup = {};
    const resizeHandle = {};
    expect(isDirectTokenDrag(resizeHandle, tokenGroup)).toBe(false);
  });
});
