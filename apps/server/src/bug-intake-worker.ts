import { and, eq } from "drizzle-orm";
import {
  bugIntakeMessages,
  bugIntakeVersions,
  bugIntakeFiles,
} from "@arken/db";
import { normalizeTelegramBugUpdate } from "./bug-intake-telegram.js";
import { ingestBugSource } from "./bug-intake-store.js";
import { writeBugAttachment } from "./bug-intake-storage.js";
import {
  completeBugAttachment,
  failBugAttachment,
} from "./bug-intake-files.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** Internal entry point for a future authenticated transport. No listener, token,
 * cursor advancement or network client is instantiated by this module. */
export async function receiveTelegramBug(
  db: Database,
  update: unknown,
  allowedChatId: string,
) {
  const normalized = normalizeTelegramBugUpdate(update, allowedChatId);
  if (normalized.status !== "READY") return normalized;
  const receipt = await ingestBugSource(db, normalized.source);
  if (receipt.decision === "DEFERRED_SENDING")
    return {
      status: "DEFERRED_SENDING" as const,
      updateId: normalized.updateId,
      ...receipt,
    };
  if (receipt.decision === "REVISION_COLLISION") {
    // Not successful ingestion: a future receiver must durably quarantine this
    // update before advancing its Telegram cursor. Never silently acknowledge it.
    return {
      status: "NEEDS_REVIEW" as const,
      updateId: normalized.updateId,
      ...receipt,
    };
  }
  return {
    status: "INGESTED" as const,
    updateId: normalized.updateId,
    ...receipt,
  };
}

/** One bounded pending attachment attempt. openSource is an injected authorized
 * transport, not a URL supplied by a message. Failures remain visible in queue.
 * Transport must impose timeout/abort and must not log token-bearing URLs. */
export async function storeNextBugAttachment(
  db: Database,
  messageId: string,
  storage: { root: string; maxBytes: number; maxTotalBytes: number },
  openSource: (sourceFileId: string) => Promise<{
    chunks: AsyncIterable<Uint8Array>;
    close: () => Promise<void>;
  }>,
) {
  const [target] = await db
    .select({
      messageId: bugIntakeMessages.id,
      revision: bugIntakeMessages.revision,
      fileId: bugIntakeFiles.id,
      sourceFileId: bugIntakeFiles.sourceFileId,
    })
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
        eq(bugIntakeMessages.id, messageId),
        eq(bugIntakeMessages.state, "REVIEW"),
        eq(bugIntakeFiles.state, "MISSING"),
      ),
    )
    .orderBy(bugIntakeFiles.id)
    .limit(1);
  if (!target) return { status: "NO_PENDING_FILE" as const };
  const command = {
    messageId: target.messageId,
    fileId: target.fileId,
    revision: target.revision,
  };
  let stage: "SOURCE" | "STORAGE" = "SOURCE";
  let stored: Awaited<ReturnType<typeof writeBugAttachment>>;
  let source: Awaited<ReturnType<typeof openSource>> | undefined;
  try {
    source = await openSource(target.sourceFileId);
    stage = "STORAGE";
    stored = await writeBugAttachment(
      storage.root,
      source.chunks,
      storage.maxBytes,
      storage.maxTotalBytes,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    // Busy storage is retryable scheduling, not a permanently failed download.
    if (code === "BUG_STORAGE_BUSY") return { status: "RETRY_LATER" as const };
    const failure =
      code === "BUG_FILE_TOO_LARGE"
        ? "TOO_LARGE"
        : code === "BUG_FILE_EMPTY"
          ? "EMPTY"
          : stage === "SOURCE"
            ? "DOWNLOAD_FAILED"
            : "STORAGE_FAILED";
    const receipt = await failBugAttachment(db, command, failure);
    return { status: "FILE_FAILED" as const, receipt };
  } finally {
    // Also closes an opened response when quota/lock refusal happens before
    // the iterable is consumed. Cleanup failure must not hide the DB outcome.
    await source?.close().catch(() => {});
  }
  // No catch-and-delete here: a lost DB response may already have committed.
  // Conflict/orphan reconciliation must retain this receipt and inspect DB first.
  const receipt = await completeBugAttachment(
    db,
    command,
    storage.root,
    stored,
    storage.maxBytes,
  );
  return {
    status: "FILE_ATTEMPTED" as const,
    fileId: target.fileId,
    stored,
    receipt,
  };
}
