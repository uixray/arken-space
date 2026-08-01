import { describe, expect, it, vi } from "vitest";
import {
  readSidebarCollapsed,
  sidebarCollapsedStorageKey,
  writeSidebarCollapsed,
} from "./sidebar-preference";

describe("sidebar collapse preference", () => {
  it("scopes the preference to both campaign and membership", () => {
    expect(sidebarCollapsedStorageKey("campaign/a", "member:b")).toBe(
      "arken.sidebarCollapsed:campaign%2Fa:member%3Ab",
    );
  });

  it("defaults to expanded and only accepts the explicit true value", () => {
    expect(
      readSidebarCollapsed({ getItem: () => null }, "campaign", "member"),
    ).toBe(false);
    expect(
      readSidebarCollapsed({ getItem: () => "false" }, "campaign", "member"),
    ).toBe(false);
    expect(
      readSidebarCollapsed({ getItem: () => "true" }, "campaign", "member"),
    ).toBe(true);
  });

  it("survives unavailable storage", () => {
    expect(
      readSidebarCollapsed(
        {
          getItem: () => {
            throw new Error("blocked");
          },
        },
        "campaign",
        "member",
      ),
    ).toBe(false);

    expect(() =>
      writeSidebarCollapsed(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        "campaign",
        "member",
        true,
      ),
    ).not.toThrow();
  });

  it("persists a boolean string under the scoped key", () => {
    const setItem = vi.fn();
    writeSidebarCollapsed({ setItem }, "campaign", "member", true);
    expect(setItem).toHaveBeenCalledWith(
      "arken.sidebarCollapsed:campaign:member",
      "true",
    );
  });
});
