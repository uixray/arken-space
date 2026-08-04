import { describe, expect, it } from "vitest";
import { resolveResizeHandleDataAttributes } from "./resize-handle";

const baseInput = {
  enabled: true,
  token: { x: 10, y: 20, width: 30, height: 40 },
  stagePosition: { x: 5.123, y: -7.456 },
  scale: 1.25,
};

describe("resolveResizeHandleDataAttributes", () => {
  it("returns the rounded local CSS center for effective draft geometry", () => {
    expect(
      resolveResizeHandleDataAttributes({
        ...baseInput,
        dragPosition: { x: 12.345, y: 23.456 },
        resizeDraft: { width: 34.567, height: 45.678 },
      }),
    ).toEqual({
      "data-resize-handle-x": 63.76,
      "data-resize-handle-y": 78.96,
    });
  });
  it("omits diagnostics when the handle is disabled", () => {
    expect(
      resolveResizeHandleDataAttributes({ ...baseInput, enabled: false }),
    ).toBeNull();
  });
  it("omits diagnostics for non-finite effective geometry", () => {
    expect(
      resolveResizeHandleDataAttributes({
        ...baseInput,
        resizeDraft: { width: Number.NaN, height: 40 },
      }),
    ).toBeNull();
  });
});
