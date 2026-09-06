import { describe, expect, it } from "vitest";
import { overlayPopupClassName } from "./overlay-owner";

describe("overlay popup ownership", () => {
  it("marks only popups owned by a modal or workspace", () => {
    expect(overlayPopupClassName("base", "select-popup")).toBe("select-popup");
    expect(overlayPopupClassName("workspace", "select-popup")).toBe(
      "select-popup arken-select-popup--workspace",
    );
    expect(overlayPopupClassName("modal", "select-popup")).toBe(
      "select-popup arken-select-popup--modal",
    );
  });

  it("does not add an empty class outside a layered owner", () => {
    expect(overlayPopupClassName("base")).toBeUndefined();
  });
});
