import { describe, expect, it } from "vitest";
import { diagnosticKey, isEditableEventTarget } from "./input-diagnostics";

describe("input diagnostics", () => {
  it("recognizes editable targets through their closest form control", () => {
    const editable = {
      closest: (selector: string) => selector.includes("textarea") ? ({} as Element) : null,
    } as unknown as EventTarget;

    expect(isEditableEventTarget(editable)).toBe(true);
    expect(isEditableEventTarget({} as EventTarget)).toBe(false);
  });

  it("never records printable text", () => {
    expect(diagnosticKey("ф")).toBe("printable");
    expect(diagnosticKey("f")).toBe("printable");
    expect(diagnosticKey("Escape")).toBe("Escape");
  });
});
