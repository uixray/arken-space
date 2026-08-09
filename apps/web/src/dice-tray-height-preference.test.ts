import { describe, expect, it, vi } from "vitest";
import {
  clampDiceTrayHeight,
  DICE_TRAY_HEIGHT_DEFAULT,
  DICE_TRAY_HEIGHT_MAX,
  DICE_TRAY_HEIGHT_MIN,
  diceTrayHeightStorageKey,
  readDiceTrayHeight,
  writeDiceTrayHeight,
} from "./dice-tray-height-preference";

describe("dice tray height preference", () => {
  it("scopes the preference to both campaign and membership", () => {
    expect(diceTrayHeightStorageKey("campaign/a", "member:b")).toBe(
      "arken.diceTrayHeight:campaign%2Fa:member%3Ab",
    );
  });

  it("clamps to the min/max range", () => {
    expect(clampDiceTrayHeight(10)).toBe(DICE_TRAY_HEIGHT_MIN);
    expect(clampDiceTrayHeight(9000)).toBe(DICE_TRAY_HEIGHT_MAX);
    expect(clampDiceTrayHeight(150)).toBe(150);
    expect(clampDiceTrayHeight(Number.NaN)).toBe(DICE_TRAY_HEIGHT_DEFAULT);
  });

  it("returns null when nothing is stored or the value is invalid", () => {
    expect(
      readDiceTrayHeight({ getItem: () => null }, "campaign", "member"),
    ).toBe(null);
    expect(
      readDiceTrayHeight(
        { getItem: () => "not-a-number" },
        "campaign",
        "member",
      ),
    ).toBe(null);
  });

  it("reads back a clamped stored height", () => {
    expect(
      readDiceTrayHeight({ getItem: () => "9000" }, "campaign", "member"),
    ).toBe(DICE_TRAY_HEIGHT_MAX);
    expect(
      readDiceTrayHeight({ getItem: () => "150" }, "campaign", "member"),
    ).toBe(150);
  });

  it("survives unavailable storage", () => {
    expect(
      readDiceTrayHeight(
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
      writeDiceTrayHeight(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        "campaign",
        "member",
        150,
      ),
    ).not.toThrow();
  });

  it("persists a clamped height string under the scoped key", () => {
    const setItem = vi.fn();
    writeDiceTrayHeight({ setItem }, "campaign", "member", 9000);
    expect(setItem).toHaveBeenCalledWith(
      "arken.diceTrayHeight:campaign:member",
      String(DICE_TRAY_HEIGHT_MAX),
    );
  });
});
