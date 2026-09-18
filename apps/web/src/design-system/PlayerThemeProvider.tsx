import { useLayoutEffect, type ReactNode } from "react";
import { ThemeProvider } from "@gravity-ui/uikit";

import { PLAYER_THEMES } from "./player-themes";
import "./player-themes.generated.css";
import "./player-theme-gravity.css";

export interface PlayerThemeProviderProps {
  themeId: string | null;
  children: ReactNode;
}

/**
 * Sole application-level owner of `data-player-theme` and the matching Gravity
 * color scheme. Do not nest this provider: its cleanup deliberately removes the
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

  return (
    <ThemeProvider theme={theme?.colorScheme ?? "dark"} lang="ru">
      {children}
    </ThemeProvider>
  );
}
