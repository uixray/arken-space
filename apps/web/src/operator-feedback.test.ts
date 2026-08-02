import { describe, expect, it } from "vitest";
import {
  allowedImageMimeTypes,
  transitionPayload,
  transitions,
  validLinearLink,
} from "./operator-feedback";
describe("operator feedback client boundary", () => {
  it("validates strict Linear links", () => {
    expect(
      validLinearLink(
        "UIX-318",
        "https://linear.app/uixray/issue/UIX-318/title",
      ),
    ).toBe(true);
    expect(validLinearLink("UIX-318", "https://evil.test/issue/UIX-318")).toBe(
      false,
    );
    expect(
      validLinearLink(
        "UIX-318",
        "https://linear.app/uixray/issue/UIX-999/UIX-318",
      ),
    ).toBe(false);
  });
  it("builds strict transition payloads without leaking link fields", () => {
    expect(
      transitionPayload("RESOLVED", "UIX-318", "https://evil.test"),
    ).toEqual({ status: "RESOLVED" });
    expect(
      transitionPayload("LINKED", "UIX-318", "https://evil.test"),
    ).toBeNull();
    expect(
      transitionPayload(
        "LINKED",
        "UIX-318",
        "https://linear.app/uixray/issue/UIX-318/operator-inbox",
      ),
    ).toEqual({
      status: "LINKED",
      linearKey: "UIX-318",
      linearUrl: "https://linear.app/uixray/issue/UIX-318/operator-inbox",
    });
  });
  it("mirrors terminal transitions and image allowlist", () => {
    expect(transitions.RESOLVED).toEqual([]);
    expect(allowedImageMimeTypes.has("image/svg+xml")).toBe(false);
  });
});
