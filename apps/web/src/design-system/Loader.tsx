import type { HTMLAttributes } from "react";
import "./Loader.css";

export type LoaderSize = "s" | "m" | "l";

export interface LoaderProps extends HTMLAttributes<HTMLSpanElement> {
  size?: LoaderSize;
}

export function Loader({ size = "m", className, ...props }: LoaderProps) {
  return (
    <span
      role="status"
      aria-label="Загрузка"
      className={[
        "arken-loader",
        "g-loader",
        `arken-loader--${size}`,
        `g-loader_size_${size}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <span className="arken-loader__spinner" />
    </span>
  );
}
