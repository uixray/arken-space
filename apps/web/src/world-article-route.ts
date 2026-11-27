import { useSyncExternalStore } from "react";
import {
  campaignIdFromPath,
  campaignReturnPath as canonicalCampaignReturn,
  routeCampaignId,
  uuidPattern,
} from "./campaign-route";

const notify = "arken-world-article";
export const invalidArticle = "invalid";
export function articleSelection(search: string): string | null {
  const values = new URLSearchParams(search).getAll("article");
  return !values.length
    ? null
    : values.length === 1 && uuidPattern.test(values[0]!)
      ? values[0]!.toLowerCase()
      : invalidArticle;
}
export function articleHref(campaignId: string, articleId: string) {
  if (!uuidPattern.test(campaignId) || !uuidPattern.test(articleId))
    throw new Error("Invalid article address");
  return `/campaign/${campaignId.toLowerCase()}?article=${articleId.toLowerCase()}`;
}
/** Never forward arbitrary query/hash (especially invite secrets) through the login redirect. */
export function campaignReturnPath(id: string, search: string) {
  return canonicalCampaignReturn(`/campaign/${id.toLowerCase()}${search}`) ?? `/campaign/${id.toLowerCase()}`;
}
export function allowedCampaignReturn(raw: string | null): string | null {
  if (!raw) return null;
  const canonical=canonicalCampaignReturn(raw);
  return canonical===raw.toLowerCase()?canonical:null;
}

function subscribe(changed: () => void) {
  window.addEventListener("popstate", changed);
  window.addEventListener(notify, changed);
  return () => {
    window.removeEventListener("popstate", changed);
    window.removeEventListener(notify, changed);
  };
}
export function useCampaignArticle(campaignId?: string) {
  return useSyncExternalStore(
    subscribe,
    () =>
      campaignId && routeCampaignId() === campaignId
        ? articleSelection(window.location.search)
        : null,
    () => null,
  );
}
export function setCampaignArticle(
  campaignId: string,
  article: string | null,
  replace = false,
) {
  if (
    routeCampaignId() !== campaignId ||
    (article !== null && !uuidPattern.test(article))
  )
    return false;
  const url = new URL(window.location.href);
  if (articleSelection(url.search) === article) return true;
  if (article === null) url.searchParams.delete("article");
  else url.searchParams.set("article", article.toLowerCase());
  if (replace) window.history.replaceState(window.history.state, "", url);
  else window.history.pushState(window.history.state, "", url);
  window.dispatchEvent(new Event(notify));
  return true;
}
