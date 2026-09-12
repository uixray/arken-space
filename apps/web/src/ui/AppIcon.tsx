import type { LucideIcon } from "./icons";

export interface AppIconProps {
  icon: LucideIcon;
  size?: 16 | 20 | 24;
  className?: string;
}

/** Decorative SVG. Put the accessible name on its button or adjacent text. */
export function AppIcon({ icon: Glyph, size = 16, className }: AppIconProps) {
  return (
    <Glyph
      className={["arken-icon", className].filter(Boolean).join(" ")}
      size={size}
      strokeWidth={2}
      color="currentColor"
      aria-hidden="true"
      focusable="false"
    />
  );
}
