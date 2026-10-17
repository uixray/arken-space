import { RULER_COLOR_PALETTE, type RulerColorKey } from "@arken/contracts";
import { cursorColorForMembership } from "./cursor-color";

/**
 * UIX-509: hashed per-member colour, used until the GM assigns a named one.
 * Both local drafts and received ruler events call this with the same
 * membershipId; displayName is deliberately not consulted.
 */
export function rulerColorForMembership(membershipId: string): string {
  return cursorColorForMembership(membershipId);
}

export type RulerStyle = {
  /** Main line, arrow, markers. */
  stroke: string;
  /** Wider translucent outline under the line. */
  halo: string;
  /** Distance label text on the dark label plate. */
  label: string;
};

const LIGHT_HALO = "#f1f5f9";

function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * A named palette colour when the GM assigned one, else the hashed fallback.
 * A dark line (the GM's black) gets a light halo and a light label so it stays
 * visible on dark maps and on the dark label plate.
 */
export function rulerStyle(
  rulerColor: RulerColorKey | null | undefined,
  membershipId: string,
  /** The theme's usual ruler outline (`visual.color.selectionOutline`). */
  defaultHalo: string,
): RulerStyle {
  if (!rulerColor) {
    const stroke = rulerColorForMembership(membershipId);
    return { stroke, halo: defaultHalo, label: stroke };
  }
  const stroke = RULER_COLOR_PALETTE[rulerColor];
  const dark = relativeLuminance(stroke) < 0.05;
  return {
    stroke,
    halo: dark ? LIGHT_HALO : defaultHalo,
    label: dark ? LIGHT_HALO : stroke,
  };
}
