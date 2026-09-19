import { useMemo, useState, type ReactNode } from "react";

import { PlayerThemeProvider } from "./PlayerThemeProvider";
import { PlayerThemeRuntimeContext } from "./player-theme-runtime-context";

/** Single root shared by the application, portals and the global toaster. */
export function PlayerThemeRoot({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<string | null>(null);
  const value = useMemo(() => ({ setThemeId }), []);
  return (
    <PlayerThemeRuntimeContext.Provider value={value}>
      <PlayerThemeProvider themeId={themeId}>{children}</PlayerThemeProvider>
    </PlayerThemeRuntimeContext.Provider>
  );
}
