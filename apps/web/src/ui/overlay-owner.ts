import { createContext, useContext } from "react";

export type OverlayOwner = "base" | "workspace" | "modal";

export const OverlayOwnerContext = createContext<OverlayOwner>("base");

export function overlayPopupClassName(
  owner: OverlayOwner,
  baseClassName?: string,
): string | undefined {
  const ownerClass =
    owner === "modal"
      ? "arken-select-popup--modal"
      : owner === "workspace"
        ? "arken-select-popup--workspace"
        : undefined;
  return [baseClassName, ownerClass].filter(Boolean).join(" ") || undefined;
}

export function useOverlayPopupClassName(baseClassName?: string) {
  return overlayPopupClassName(useContext(OverlayOwnerContext), baseClassName);
}
