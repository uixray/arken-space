const AMBERION_CAMPAIGN_ID = "eb6a55c4-a821-4739-8d4a-a1028e9d9092";

/** Display order only: keeps snapshot data and other campaigns unchanged. */
export function orderCampaignScenes<T extends { name: string }>(
  scenes: T[],
  campaignId?: string,
): T[] {
  if (campaignId !== AMBERION_CAMPAIGN_ID) return scenes;
  return [...scenes].sort((a, b) =>
    a.name.localeCompare(b.name, "ru", { numeric: true, sensitivity: "base" }),
  );
}
