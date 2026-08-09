import { describe, expect, it, vi } from "vitest";
import {
  CURSOR_PREFERENCE_DEFAULT,
  cursorPreferenceStorageKey,
  readCursorPreference,
  writeCursorPreference,
} from "./cursor-preference";

describe("cursor presence preference", () => {
  it("scopes the preference to both campaign and membership", () => {
    expect(cursorPreferenceStorageKey("campaign/a", "member:b")).toBe(
      "arken.cursorPresence:campaign%2Fa:member%3Ab",
    );
  });

  it("defaults to sending and receiving when nothing is stored", () => {
    expect(
      readCursorPreference({ getItem: () => null }, "campaign", "member"),
    ).toEqual(CURSOR_PREFERENCE_DEFAULT);
  });

  it("defaults on malformed stored JSON", () => {
    expect(
      readCursorPreference(
        { getItem: () => "{not json" },
        "campaign",
        "member",
      ),
    ).toEqual(CURSOR_PREFERENCE_DEFAULT);
    expect(
      readCursorPreference({ getItem: () => "42" }, "campaign", "member"),
    ).toEqual(CURSOR_PREFERENCE_DEFAULT);
  });

  it("reads back a stored preference, falling back per-field for partial data", () => {
    expect(
      readCursorPreference(
        { getItem: () => JSON.stringify({ sendEnabled: false }) },
        "campaign",
        "member",
      ),
    ).toEqual({ sendEnabled: false, receiveEnabled: true });
    expect(
      readCursorPreference(
        {
          getItem: () =>
            JSON.stringify({ sendEnabled: false, receiveEnabled: false }),
        },
        "campaign",
        "member",
      ),
    ).toEqual({ sendEnabled: false, receiveEnabled: false });
  });

  it("survives unavailable storage", () => {
    expect(
      readCursorPreference(
        {
          getItem: () => {
            throw new Error("blocked");
          },
        },
        "campaign",
        "member",
      ),
    ).toEqual(CURSOR_PREFERENCE_DEFAULT);

    expect(() =>
      writeCursorPreference(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        "campaign",
        "member",
        { sendEnabled: false, receiveEnabled: false },
      ),
    ).not.toThrow();
  });

  it("persists the preference under the scoped key", () => {
    const setItem = vi.fn();
    writeCursorPreference({ setItem }, "campaign", "member", {
      sendEnabled: false,
      receiveEnabled: true,
    });
    expect(setItem).toHaveBeenCalledWith(
      "arken.cursorPresence:campaign:member",
      JSON.stringify({ sendEnabled: false, receiveEnabled: true }),
    );
  });
});
