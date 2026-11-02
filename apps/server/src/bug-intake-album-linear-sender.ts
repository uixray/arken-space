import { z } from "zod";
import { sendQueuedBugAlbumOnce } from "./bug-intake-album-send.js";
import { uploadClaimedBugAlbumFileOnce } from "./bug-intake-album-upload-worker.js";
import { createReviewedBugIssue } from "./bug-intake-linear-create.js";
import { appendBugRevisionComment } from "./bug-intake-linear-comment.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type UploadResult = Awaited<ReturnType<typeof uploadClaimedBugAlbumFileOnce>>;
type UploadRecovery = Extract<UploadResult, { recovery: unknown }>["recovery"];

/** Explicit invocation only; not registered in routes or startup. Configured
 * request owns credentials; this layer never reads environment or another bot.
 * One durable claim owns one sequential attempt, with no automatic retries.
 */
export async function sendBugAlbumToLinearOnce(
  db: Database,
  deliveryId: string,
  config: {
    teamId: string;
    projectId: string;
    storage: Parameters<typeof uploadClaimedBugAlbumFileOnce>[1];
    request: Parameters<typeof uploadClaimedBugAlbumFileOnce>[2];
    policy: Parameters<typeof uploadClaimedBugAlbumFileOnce>[3];
  },
) {
  z.string().uuid().parse(config.teamId);
  z.string().uuid().parse(config.projectId);
  let uploadRecovery: UploadRecovery | undefined;
  const result = await sendQueuedBugAlbumOnce(db, deliveryId, async (claim) => {
    const links: string[] = [];
    for (const file of claim.payload.attachments) {
      const uploaded = await uploadClaimedBugAlbumFileOnce(db, config.storage,
        config.request, config.policy, deliveryId, claim.claimId, file.id);
      if (!uploaded.ok) {
        if ("recovery" in uploaded) uploadRecovery = uploaded.recovery;
        return { state: "UNKNOWN" as const,
          failureCode: "EXTERNAL_RESULT_UNKNOWN" as const,
          ...(claim.payload.existingLinearIssueId
            ? { linearIssueId: claim.payload.existingLinearIssueId } : {}) };
      }
      // Angle-delimited Markdown URL: encode syntax breakers, preserve signed-free
      // asset identity. Never embed raw filenames, Telegram URLs or source text.
      const url = uploaded.assetUrl.replace(/</g, "%3C").replace(/>/g, "%3E");
      links.push(`[bug-attachment-${file.id}.bin](<${url}>)`);
    }
    const description = claim.payload.description +
      (links.length ? `\n\n${links.join("\n\n")}` : "");
    if (claim.payload.existingLinearIssueId) {
      return appendBugRevisionComment(config.request, {
        deliveryId, linearIssueId: claim.payload.existingLinearIssueId,
        body: `${claim.payload.title}\n\n${description}`,
      });
    }
    return createReviewedBugIssue(config.request, {
      teamId: config.teamId, projectId: config.projectId,
      title: claim.payload.title, description,
    });
  });
  // Recovery evidence must go to a private recovery path, not logs/client DTOs.
  // It is intentionally returned even when the overall UNKNOWN receipt persisted.
  return { ...result, ...(uploadRecovery ? { uploadRecovery } : {}) };
}

