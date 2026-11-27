/** Campaign identity of this tab; never infer it from the shared cookie. */
const uuidSource =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const uuidPattern = new RegExp(`^${uuidSource}$`, "i");
const campaignPath = new RegExp(`^/campaign/(${uuidSource})/?$`, "i");
export function campaignIdFromPath(path: string): string | null {
  return campaignPath.exec(path)?.[1]?.toLowerCase() ?? null;
}
export function routeCampaignId(): string | null {
  return typeof window === "undefined"
    ? null
    : campaignIdFromPath(window.location.pathname);
}

export function campaignHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const campaign = routeCampaignId();
  if (campaign) headers.set("x-arken-campaign-id", campaign);
  return headers;
}
/** Keep only reviewed in-app destinations: encyclopedia selection and Bionic draft. */
export function campaignReturnPath(candidate: string | null): string | null {
  if (!candidate || candidate.includes("#")) return null;
  const [path, search, extra] = candidate.split("?");
  const campaign = campaignIdFromPath(path ?? "");
  if (!campaign || extra !== undefined) return null;
  const params = new URLSearchParams(search ?? "");
  for (const key of params.keys())
    if (!["article", "editor-pilot"].includes(key) || params.getAll(key).length !== 1 || !uuidPattern.test(params.get(key)!)) return null;
  const selected = ["article", "editor-pilot"].flatMap(key => {
    const value=params.get(key);return value ? [`${key}=${value.toLowerCase()}`] : [];
  });
  return `/campaign/${campaign}${selected.length ? "?"+selected.join("&") : ""}`;
}
