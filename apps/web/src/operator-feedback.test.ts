import { describe, expect, it } from "vitest";
import {
  allowedImageMimeTypes,
  transitionPayload,
  transitions,
  validLinearLink,
  feedbackListPath,
} from "./operator-feedback";
describe("operator feedback client boundary", () => {
  it("encodes existing bounded filter and opaque cursor query values", () => {
    expect(feedbackListPath()).toBe("/api/operator/feedback");
    const url = new URL(
      feedbackListPath({
        kind: "BUG",
        status: "NEW",
        build: "build + &",
        cursor: "opaque+/=",
        from: "2026-09-17T00:00:00.000Z",
      }),
      "https://test.invalid",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: "BUG",
      status: "NEW",
      build: "build + &",
      cursor: "opaque+/=",
      from: "2026-09-17T00:00:00.000Z",
    });
    expect(url.searchParams.has("limit")).toBe(false);
  });
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
