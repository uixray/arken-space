import {createContext, useContext} from "react";

// Local sessions occupy a table below their status strip, not the whole viewport.
export const WorkspacePortalContext = createContext<HTMLElement | null>(null);
export function useWorkspacePortal() {
  return useContext(WorkspacePortalContext) ?? document.body;
}
