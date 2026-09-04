/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { statLabelsFromLayout } from "./stat-keys";

const CampaignStatLabelsContext = createContext<
  Readonly<Record<string, string>>
>({});

export function CampaignStatLabelsProvider({
  layout,
  children,
}: {
  layout: GameSnapshot["campaign"]["statLayout"];
  children: ReactNode;
}) {
  const labels = useMemo(() => statLabelsFromLayout(layout), [layout]);
  return (
    <CampaignStatLabelsContext.Provider value={labels}>
      {children}
    </CampaignStatLabelsContext.Provider>
  );
}

export function useCampaignStatLabels() {
  return useContext(CampaignStatLabelsContext);
}
