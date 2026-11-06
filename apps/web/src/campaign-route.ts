/** Campaign identity of this tab; never infer it from the shared cookie. */
export function routeCampaignId(): string | null {
  if (typeof window === "undefined") return null;
  return (
    /^\/campaign\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i
      .exec(window.location.pathname)?.[1]
      ?.toLowerCase() ?? null
  );
}

export function campaignHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const campaign = routeCampaignId();
  if (campaign) headers.set("x-arken-campaign-id", campaign);
  return headers;
}
