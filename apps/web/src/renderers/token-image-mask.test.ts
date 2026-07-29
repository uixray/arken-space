import { describe, expect, it } from "vitest";
import { getTokenImageMask } from "./token-image-mask";

describe("getTokenImageMask", () => {
  it("clips square token artwork to the full circular token bounds", () => {
    expect(getTokenImageMask(64, 64)).toEqual({
      centerX: 32,
      centerY: 32,
      radius: 32,
    });
  });

  it("uses the shortest side without changing rectangular selection bounds", () => {
    expect(getTokenImageMask(96, 64)).toEqual({
      centerX: 48,
      centerY: 32,
      radius: 32,
    });
  });
});
