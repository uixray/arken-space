import { createContext } from "react";
import type { MessageVisibility } from "@arken/contracts";

/** Общая видимость костей на карте и бросков характеристик в боковой панели. */
export const RollVisibilityContext = createContext<MessageVisibility>("PUBLIC");
