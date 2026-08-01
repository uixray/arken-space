import { describe, expect, it } from "vitest";
import { shouldDismissDetails } from "./dismissible-details";

describe("dismissible details", () => {
  it("keeps a closed details element closed without handling the target", () => {
    const details = {
      open: false,
      contains: () => false,
    } as unknown as HTMLDetailsElement;
    expect(shouldDismissDetails(details, {} as EventTarget)).toBe(false);
  });

  it("ignores events without a DOM target", () => {
    const details = {
      open: true,
      contains: () => false,
    } as unknown as HTMLDetailsElement;
    expect(shouldDismissDetails(details, null)).toBe(false);
  });
});
