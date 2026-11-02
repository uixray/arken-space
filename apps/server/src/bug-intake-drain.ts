import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  bugIntakeUpdates,
  bugIntakeMessages,
  bugIntakeVersions,
  bugIntakeFiles,
} from "@arken/db";
import { processTelegramBugUpdate } from "./bug-intake-inbox.js";
import { storeNextBugAttachment } from "./bug-intake-worker.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type SourceOpener = Parameters<typeof storeNextBugAttachment>[3];

/** Explicit one-batch worker. Construction/import starts no timers, network or DB
 * work. Owner-authorized lifecycle may call runOnce with backoff after activation.
 * Use a single worker for a receiver; CAS protects data but is not a file lease. */
export function createBugIntakeDrain(
  db: Database,
  config: {
    receiverId: string;
    allowedChatId: string;
    storage: { root: string; maxBytes: number; maxTotalBytes: number };
  },
  openSource: SourceOpener,
) {
  z.string().uuid().parse(config.receiverId);
  if (!/^-?[1-9][0-9]*$/.test(config.allowedChatId))
    throw new Error("CHAT_ALLOWLIST_REQUIRED");
  let running = false;
  let halted = false;
  return async function runOnce(signal?: AbortSignal) {
    if (halted) return { status: "RECONCILIATION_REQUIRED" as const };
    if (running) return { status: "BUSY" as const };
    if (signal?.aborted) return { status: "STOPPED" as const };
    running = true;
    const counts = {
      processed: 0,
      quarantined: 0,
      fileAttempts: 0,
      fileFailures: 0,
    };
    try {
      const pending = await db
        .select({ id: bugIntakeUpdates.id })
        .from(bugIntakeUpdates)
        .where(
          and(
            eq(bugIntakeUpdates.receiverId, config.receiverId),
            eq(bugIntakeUpdates.state, "PENDING"),
          ),
        )
        .orderBy(asc(bugIntakeUpdates.createdAt), asc(bugIntakeUpdates.id))
        .limit(20);
      for (const item of pending) {
        if (signal?.aborted) return { status: "STOPPED" as const, counts };
        const result = await processTelegramBugUpdate(
          db,
          config.receiverId,
          item.id,
          config.allowedChatId,
        );
        if (result.status === "PROCESSED") counts.processed++;
        if (result.status === "QUARANTINED") counts.quarantined++;
      }
      // One pending file per message in a batch prevents a large message from
      // monopolizing the queue. Version join excludes historical attachments.
      const messages = await db
        .selectDistinct({ id: bugIntakeMessages.id })
        .from(bugIntakeMessages)
        .innerJoin(
          bugIntakeVersions,
          and(
            eq(bugIntakeVersions.messageId, bugIntakeMessages.id),
            eq(bugIntakeVersions.sourceHash, bugIntakeMessages.sourceHash),
          ),
        )
        .innerJoin(
          bugIntakeFiles,
          eq(bugIntakeFiles.versionId, bugIntakeVersions.id),
        )
        .where(
          and(
            eq(bugIntakeMessages.provider, "TELEGRAM"),
            eq(bugIntakeMessages.chatId, config.allowedChatId),
            eq(bugIntakeMessages.state, "REVIEW"),
            eq(bugIntakeFiles.state, "MISSING"),
          ),
        )
        .orderBy(asc(bugIntakeMessages.id))
        .limit(5);
      for (const message of messages) {
        if (signal?.aborted) return { status: "STOPPED" as const, counts };
        const result = await storeNextBugAttachment(
          db,
          message.id,
          config.storage,
          openSource,
        );
        if (result.status === "RETRY_LATER")
          return { status: "BACKOFF" as const, counts };
        if (result.status === "FILE_FAILED") counts.fileFailures++;
        if (result.status === "FILE_ATTEMPTED") {
          counts.fileAttempts++;
          // A conflict may leave an unreferenced file. Stop instead of repeatedly
          // downloading; reconciliation must inspect the receipt before retry.
          if (!result.receipt.ok) halted = true;
          if (!result.receipt.ok)
            return {
              status: "RECONCILIATION_REQUIRED" as const,
              counts,
              fileId: result.fileId,
              storageKey: result.stored.storageKey,
            };
        }
      }
      return { status: "BATCH_FINISHED" as const, counts };
    } catch {
      halted = true;
      // Stop on unknown/ambiguous DB failure; no raw error or token URL logging.
      return { status: "RECONCILIATION_REQUIRED" as const, counts };
    } finally {
      running = false;
    }
  };
}
