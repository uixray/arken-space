import { describe, expect, it, vi } from "vitest";
import {
  clampSidebarWidth,
  readSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  sidebarWidthStorageKey,
  writeSidebarWidth,
} from "./sidebar-width-preference";

describe("sidebar width preference", () => {
  it("scopes the preference to both campaign and membership", () => {
    expect(sidebarWidthStorageKey("campaign/a", "member:b")).toBe(
      "arken.sidebarWidth:campaign%2Fa:member%3Ab",
    );
  });

  it("clamps to the min/max range", () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(9000)).toBe(SIDEBAR_WIDTH_MAX);
    expect(clampSidebarWidth(400)).toBe(400);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it("returns null when nothing is stored or the value is invalid", () => {
    expect(
      readSidebarWidth({ getItem: () => null }, "campaign", "member"),
    ).toBe(null);
    expect(
      readSidebarWidth({ getItem: () => "not-a-number" }, "campaign", "member"),
    ).toBe(null);
  });

  it("reads back a clamped stored width", () => {
    expect(
      readSidebarWidth({ getItem: () => "9000" }, "campaign", "member"),
    ).toBe(SIDEBAR_WIDTH_MAX);
    expect(
      readSidebarWidth({ getItem: () => "420" }, "campaign", "member"),
    ).toBe(420);
  });

  it("survives unavailable storage", () => {
    expect(
      readSidebarWidth(
        {
          getItem: () => {
            throw new Error("blocked");
          },
        },
        "campaign",
        "member",
      ),
    ).toBe(null);

    expect(() =>
      writeSidebarWidth(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        "campaign",
        "member",
        400,
      ),
    ).not.toThrow();
  });

  it("persists a clamped width string under the scoped key", () => {
    const setItem = vi.fn();
    writeSidebarWidth({ setItem }, "campaign", "member", 9000);
    expect(setItem).toHaveBeenCalledWith(
      "arken.sidebarWidth:campaign:member",
      String(SIDEBAR_WIDTH_MAX),
    );
  });
});
