import { useLayoutEffect, type ReactNode } from "react";

import { PLAYER_THEMES, type PlayerThemeColorScheme } from "./player-themes";
import "./player-themes.generated.css";
import "./player-theme-gravity.css";

export interface PlayerThemeProviderProps {
  themeId: string | null;
  children: ReactNode;
}

/**
 * Sole application-level owner of `data-player-theme` and the matching
 * `g-root_theme_*` color scheme on `<body>` (the former Gravity ThemeProvider
 * contract, UIX-709). Do not nest this provider: its cleanup deliberately removes the
 * document attribute rather than restoring another provider's value.
 */
export function PlayerThemeProvider({
  themeId,
  children,
}: PlayerThemeProviderProps) {
  const theme = PLAYER_THEMES.find((candidate) => candidate.id === themeId);
  const resolvedThemeId = theme?.id ?? "system";

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (resolvedThemeId === "system") {
      root.removeAttribute("data-player-theme");
    } else {
      root.setAttribute("data-player-theme", resolvedThemeId);
    }

    return () => root.removeAttribute("data-player-theme");
  }, [resolvedThemeId]);

  useBodyColorScheme(theme?.colorScheme ?? "dark");
  return children;
}

/**
 * Puts `g-root g-root_theme_<scheme>` on <body>, where ui/theme-root.css
 * defines the matching variables and `color-scheme`.
 */
export function useBodyColorScheme(colorScheme: PlayerThemeColorScheme) {
  useLayoutEffect(() => {
    const body = document.body;
    body.classList.add("g-root", `g-root_theme_${colorScheme}`);
    return () => body.classList.remove(`g-root_theme_${colorScheme}`);
  }, [colorScheme]);
}
