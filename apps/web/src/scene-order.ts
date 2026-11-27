/** Display order only: natural scene names across campaigns without changing snapshot data. */
export function orderCampaignScenes<T extends { name: string }>(
  scenes: T[],
  campaignId?: string,
): T[] {
  return [...scenes].sort((a, b) =>
    a.name.localeCompare(b.name, "ru", { numeric: true, sensitivity: "base" }),
  );
}
