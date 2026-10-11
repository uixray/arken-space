import type { StoryAttachmentListItem } from "@arken/contracts";
import { api } from "./api";

export type StoryAttachmentRecord = StoryAttachmentListItem;

export async function listStoryAttachments() {
  return api<{ attachments: StoryAttachmentRecord[] }>(
    "/api/story/attachments",
  );
}

export async function deleteStoryAttachment(contentId: string) {
  return api<{ deleted: boolean; cleanupPending?: boolean; contentId: string }>(
    `/api/story/attachments/${encodeURIComponent(contentId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ actionId: crypto.randomUUID() }),
    },
  );
}
