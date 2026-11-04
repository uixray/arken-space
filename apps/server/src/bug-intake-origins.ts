import { isIP } from "node:net";

/** Explicit administrator configuration, never inferred from an upload ticket. */
export function parseBugAssetOrigins(value: string): ReadonlySet<string> {
  if (value.length > 4096) throw new Error("INVALID_BUG_ASSET_ORIGINS");
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length > 20) throw new Error("INVALID_BUG_ASSET_ORIGINS");
  const origins = new Set<string>();
  for (const entry of entries) {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error("INVALID_BUG_ASSET_ORIGINS");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      url.port ||
      !url.hostname.includes(".") ||
      url.hostname.endsWith(".localhost") ||
      isIP(url.hostname.replace(/^\[|\]$/g, ""))
    )
      throw new Error("INVALID_BUG_ASSET_ORIGINS");
    origins.add(url.origin);
  }
  return origins;
}
