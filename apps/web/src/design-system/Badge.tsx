import type { HTMLAttributes, ReactNode } from "react";
import "./Badge.css";

export type BadgeTheme = "normal" | "info" | "success" | "warning" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  theme?: BadgeTheme;
  children?: ReactNode;
}

export function Badge({
  theme = "normal",
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={[
        "arken-badge",
        "g-label",
        `arken-badge--${theme}`,
        `g-label_theme_${theme}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}

export const Label = Badge;
