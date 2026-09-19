import { createContext, useContext } from "react";

export type PlayerThemeRuntimeValue = {
  setThemeId: (themeId: string | null) => void;
};

const detachedRuntime: PlayerThemeRuntimeValue = {
  setThemeId: () => undefined,
};

export const PlayerThemeRuntimeContext =
  createContext<PlayerThemeRuntimeValue>(detachedRuntime);

export function usePlayerThemeRuntime(): PlayerThemeRuntimeValue {
  return useContext(PlayerThemeRuntimeContext);
}
