import { createHash } from "node:crypto";
import type { BugSourceMessage } from "@arken/contracts";

/** Canonical hash for typed, parsed input. No secrets/raw text are logged. */
export function bugSourceHash(source: BugSourceMessage): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: source.provider,
        chatId: source.chatId,
        messageId: source.messageId,
        sourceRevisionAt: source.sourceRevisionAt,
        albumId: source.albumId,
        authorLabel: source.authorLabel,
        originalText: source.originalText,
        sourceUrl: source.sourceUrl,
        attachments: source.attachments.map((item) => ({
          sourceFileId: item.sourceFileId,
          name: item.name,
          declaredMime: item.declaredMime,
          declaredSizeBytes: item.declaredSizeBytes,
        })),
      }),
    )
    .digest("hex");
}

/** Compare source versions; retries/out-of-order delivery never revert an edit. */
export function bugSourceRevisionDecision(
  current: { sourceRevisionAt: Date; sourceHash: string } | null,
  incoming: BugSourceMessage,
): "CREATE" | "DUPLICATE" | "STALE" | "REVISION_COLLISION" | "EDIT" {
  if (!current) return "CREATE";
  const delta =
    new Date(incoming.sourceRevisionAt).getTime() -
    current.sourceRevisionAt.getTime();
  if (delta < 0) return "STALE";
  if (delta === 0)
    return current.sourceHash === bugSourceHash(incoming)
      ? "DUPLICATE"
      : "REVISION_COLLISION";
  return "EDIT";
}

/** Any source edit invalidates manual approval; a Linear mapping must survive. */
export function bugStateAfterSourceEdit(): "REVIEW" {
  return "REVIEW";
}
