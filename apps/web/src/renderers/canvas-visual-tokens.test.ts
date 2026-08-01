import { describe, expect, it } from "vitest";
import { CANVAS_VISUAL_TOKENS } from "./canvas-visual-tokens";

describe("canvas visual tokens", () => {
  it("uses the base fog color when a revealed area is covered again", () => {
    expect(CANVAS_VISUAL_TOKENS.color.fogCover).toBe(
      CANVAS_VISUAL_TOKENS.color.fog,
    );
  });
});
