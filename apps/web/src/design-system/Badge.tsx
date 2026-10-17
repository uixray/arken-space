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
        "arken-label",
        `arken-badge--${theme}`,
        `arken-label--theme-${theme}`,
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
