import { api } from "./api";
export type FeedbackStatus =
  "NEW" | "ACKNOWLEDGED" | "LINKED" | "RESOLVED" | "DISMISSED";
export type FeedbackListItem = {
  id: string;
  kind: "SUGGESTION" | "BUG" | "IDEA";
  status: FeedbackStatus;
  buildVersion: string | null;
  buildRevision: string | null;
  linearKey: string | null;
  linearUrl: string | null;
  createdAt: string;
  updatedAt: string;
};
export type FeedbackDetail = FeedbackListItem & {
  title: string;
  description: string;
  contact?: string | null;
  diagnostics?: unknown;
  attachments: Array<{
    id: string;
    kind: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
  }>;
};
export const allowedImageMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export const transitions: Record<FeedbackStatus, readonly FeedbackStatus[]> = {
  NEW: ["ACKNOWLEDGED", "DISMISSED"],
  ACKNOWLEDGED: ["LINKED", "RESOLVED", "DISMISSED"],
  LINKED: ["RESOLVED", "DISMISSED"],
  RESOLVED: [],
  DISMISSED: [],
};
export function validLinearLink(key: string, url: string) {
  if (!/^UIX-[1-9]\d*$/.test(key)) return false;
  try {
    const p = new URL(url),
      x = p.pathname.split("/").filter(Boolean),
      i = x.findIndex((v) => v.toLowerCase() === "issue"),
      slug = i >= 0 ? x[i + 1] : undefined;
    return (
      p.protocol === "https:" &&
      p.hostname === "linear.app" &&
      (slug === key || slug?.startsWith(`${key}-`) === true)
    );
  } catch {
    return false;
  }
}
export function transitionPayload(
  status: FeedbackStatus,
  linearKey: string,
  linearUrl: string,
): { status: FeedbackStatus; linearKey?: string; linearUrl?: string } | null {
  if (status !== "LINKED") return { status };
  return validLinearLink(linearKey, linearUrl)
    ? { status, linearKey, linearUrl }
    : null;
}
export const fetchOperatorCapability = () =>
  api<{ allowed: true }>("/api/operator/feedback/capability");
export const fetchFeedbackList = () =>
  api<{ items: FeedbackListItem[]; nextCursor: string | null }>(
    "/api/operator/feedback",
  );
export const fetchFeedbackDetail = (id: string, reveal = false) =>
  api<FeedbackDetail>(
    `/api/operator/feedback/${encodeURIComponent(id)}${reveal ? "?reveal=true" : ""}`,
  );
export const fetchRedactedExport = (id: string) =>
  api<Record<string, unknown>>(
    `/api/operator/feedback/${encodeURIComponent(id)}/export`,
  );
export const updateFeedback = (
  id: string,
  body: { status: FeedbackStatus; linearKey?: string; linearUrl?: string },
) =>
  api(`/api/operator/feedback/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
export async function fetchAttachment(reportId: string, attachmentId: string) {
  const r = await fetch(
    `/api/operator/feedback/${encodeURIComponent(reportId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { credentials: "include" },
  );
  if (!r.ok) throw new Error("Не удалось открыть вложение");
  const mime = r.headers.get("content-type")?.split(";", 1)[0] ?? "";
  if (!allowedImageMimeTypes.has(mime))
    throw new Error("Недопустимый тип вложения");
  const blob = await r.blob();
  if (!allowedImageMimeTypes.has(blob.type))
    throw new Error("Недопустимый тип вложения");
  return blob;
}
