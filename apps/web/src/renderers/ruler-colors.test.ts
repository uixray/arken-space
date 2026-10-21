import { describe, expect, it } from "vitest";
import { RULER_COLOR_PALETTE } from "@arken/contracts";
import { cursorColorForMembership } from "./cursor-color";
import { rulerColorForMembership, rulerStyle } from "./ruler-colors";

const THEME_HALO = "#102027";

describe("UIX-509 safe ruler color fallback", () => {
  it("resolves unknown membership IDs deterministically from the shared cursor fallback", () => {
    const id = "campaign-member-not-in-palette";
    expect(rulerColorForMembership(id)).toBe(cursorColorForMembership(id));
    expect(rulerColorForMembership(id)).toBe(rulerColorForMembership(id));
  });

  it("keeps a local draft and realtime ruler aligned by membership ID, not display name", () => {
    const localDraft = {
      membershipId: "stable-member-1",
      displayName: "Local label",
    };
    const received = {
      membershipId: "stable-member-1",
      displayName: "Remote label",
    };
    expect(rulerColorForMembership(localDraft.membershipId)).toBe(
      rulerColorForMembership(received.membershipId),
    );
  });

  it("differs for this selected pair of membership IDs without claiming global uniqueness", () => {
    expect(rulerColorForMembership("member-a")).not.toBe(
      rulerColorForMembership("member-b"),
    );
  });

  it("remains deterministic for the empty fallback input", () => {
    expect(rulerColorForMembership("")).toBe(cursorColorForMembership(""));
  });
});

describe("UIX-509 ruler style", () => {
  it("uses the hashed colour and the theme halo while no colour is assigned", () => {
    for (const rulerColor of [null, undefined]) {
      const style = rulerStyle(rulerColor, "member-a", THEME_HALO);
      expect(style).toEqual({
        stroke: rulerColorForMembership("member-a"),
        halo: THEME_HALO,
        label: rulerColorForMembership("member-a"),
      });
    }
  });

  it("draws an assigned palette colour regardless of the membership ID", () => {
    expect(rulerStyle("green", "member-a", THEME_HALO)).toEqual(
      rulerStyle("green", "member-b", THEME_HALO),
    );
    expect(rulerStyle("green", "member-a", THEME_HALO)).toEqual({
      stroke: RULER_COLOR_PALETTE.green,
      halo: THEME_HALO,
      label: RULER_COLOR_PALETTE.green,
    });
  });

  it("gives the black ruler a light halo and a light label", () => {
    const style = rulerStyle("black", "gm", THEME_HALO);
    expect(style.stroke).toBe(RULER_COLOR_PALETTE.black);
    expect(style.halo).not.toBe(THEME_HALO);
    expect(style.label).toBe(style.halo);
    expect(Number.parseInt(style.halo.slice(1, 3), 16)).toBeGreaterThan(200);
  });

  it("keeps every other palette colour on the theme halo", () => {
    for (const key of ["green", "lilac", "orange", "purple", "blue"] as const)
      expect(rulerStyle(key, "member", THEME_HALO).halo).toBe(THEME_HALO);
  });
});
