import { describe, expect, it, vi } from "vitest";
import {
  CURSOR_PREFERENCE_DEFAULT,
  cursorPreferenceDefault,
  cursorPreferenceStorageKey,
  readCursorPreference,
  writeCursorPreference,
} from "./cursor-preference";

describe("cursor presence preference", () => {
  it("scopes the preference to both campaign and membership", () => {
    expect(cursorPreferenceStorageKey("campaign/a", "member:b")).toBe(
      "arken.cursorPresence.v2:campaign%2Fa:member%3Ab",
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
      "arken.cursorPresence.v2:campaign:member",
      JSON.stringify({ sendEnabled: false, receiveEnabled: true }),
    );
  });

  /**
   * UIX-403: `sendEnabled` gained a meaning for the GM, who previously had one
   * that governed nothing. Every GM already has `true` stored from before, and
   * reading that back under the new meaning would start broadcasting their
   * cursor to players the moment they upgraded.
   */
  it("starts a GM private and a player visible", () => {
    expect(cursorPreferenceDefault("GM")).toEqual({
      sendEnabled: false,
      receiveEnabled: true,
    });
    expect(cursorPreferenceDefault("PLAYER")).toEqual({
      sendEnabled: true,
      receiveEnabled: true,
    });
  });

  it("does not read a pre-UIX-403 preference back into the new meaning", () => {
    const legacyKey = "arken.cursorPresence:campaign:member";
    const storage = {
      getItem: (key: string) =>
        key === legacyKey
          ? JSON.stringify({ sendEnabled: true, receiveEnabled: true })
          : null,
    };
    // The old key is simply not consulted, so a GM who never touched the
    // setting stays private rather than inheriting a `true` that used to mean
    // something else.
    expect(readCursorPreference(storage, "campaign", "member", "GM")).toEqual({
      sendEnabled: false,
      receiveEnabled: true,
    });
  });

  it("falls back per role when a stored field is missing", () => {
    expect(
      readCursorPreference(
        { getItem: () => JSON.stringify({ receiveEnabled: false }) },
        "campaign",
        "member",
        "GM",
      ),
    ).toEqual({ sendEnabled: false, receiveEnabled: false });
  });

  it("keeps a GM's explicit choice to share", () => {
    expect(
      readCursorPreference(
        { getItem: () => JSON.stringify({ sendEnabled: true }) },
        "campaign",
        "member",
        "GM",
      ),
    ).toEqual({ sendEnabled: true, receiveEnabled: true });
  });
});
