import { and, eq, sql } from "drizzle-orm";
import {
  bugIntakeMessages,
  bugIntakeVersions,
  bugIntakeFiles,
} from "@arken/db";
import { bugSourceMessageSchema } from "@arken/contracts";
import { bugDeliveryInFlight } from "./bug-intake-delivery-lock.js";
import {
  lockBugAlbum,
  invalidateBugAlbum,
  bugAlbumDeliveryInFlight,
} from "./bug-intake-album-lock.js";
import {
  bugSourceHash,
  bugSourceRevisionDecision,
} from "./bug-intake-state.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** Internal only: caller must authenticate the adapter/operator and allowlist the
 * numeric source chat. Never expose this as an unauthenticated webhook. */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function ingestBugSource(db: Database, input: unknown) {
  return db.transaction((tx) => ingestBugSourceInTransaction(tx, input));
}

/** Shared transaction permits inbox status and canonical source to commit together. */
export async function ingestBugSourceInTransaction(
  tx: Transaction,
  input: unknown,
) {
  const source = bugSourceMessageSchema.parse(input);
  const sourceHash = bugSourceHash(source);
  const album = await lockBugAlbum(tx, source);
  // Serializes first insert too, when SELECT FOR UPDATE has no row to lock.
  const identity = JSON.stringify([
    source.provider,
    source.chatId,
    source.messageId,
  ]);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${"bug-intake:" + identity}, 0))`,
  );
  const [current] = await tx
    .select()
    .from(bugIntakeMessages)
    .where(
      and(
        eq(bugIntakeMessages.provider, source.provider),
        eq(bugIntakeMessages.chatId, source.chatId),
        eq(bugIntakeMessages.messageId, source.messageId),
      ),
    )
    .for("update");
  if (current && current.albumId !== source.albumId)
    return {
      decision: "REVISION_COLLISION" as const,
      messageId: current.id,
      revision: current.revision,
    };
  const decision = bugSourceRevisionDecision(current ?? null, source);
  if (
    album &&
    (decision === "CREATE" || decision === "EDIT") &&
    (await bugAlbumDeliveryInFlight(tx, album.id))
  )
    return {
      decision: "DEFERRED_SENDING" as const,
      messageId: current?.id ?? null,
      revision: current?.revision ?? null,
    };
  if (
    current &&
    decision === "EDIT" &&
    (await bugDeliveryInFlight(tx, current.id))
  )
    return {
      decision: "DEFERRED_SENDING" as const,
      messageId: current.id,
      revision: current.revision,
    };
  if (decision !== "CREATE" && decision !== "EDIT") {
    // Collision intentionally leaves the current source and consent untouched.
    // Adapter must surface it for review, not retry forever or pick a winner.
    return { decision, messageId: current!.id, revision: current!.revision };
  }
  const fields = {
    albumId: source.albumId,
    sourceRevisionAt: new Date(source.sourceRevisionAt),
    sourceHash,
    source,
    state: "REVIEW",
    approval: null,
    updatedAt: new Date(),
  };
  const [message] = current
    ? await tx
        .update(bugIntakeMessages)
        .set({ ...fields, revision: current.revision + 1 })
        .where(eq(bugIntakeMessages.id, current.id))
        .returning()
    : await tx
        .insert(bugIntakeMessages)
        .values({
          ...fields,
          provider: source.provider,
          chatId: source.chatId,
          messageId: source.messageId,
        })
        .returning();
  if (!message) throw new Error("BUG_INTAKE_WRITE_FAILED");
  if (album) await invalidateBugAlbum(tx, album.id);
  const [version] = await tx
    .insert(bugIntakeVersions)
    .values({
      messageId: message.id,
      sourceHash,
      sourceRevisionAt: new Date(source.sourceRevisionAt),
      source,
    })
    .returning({ id: bugIntakeVersions.id });
  if (!version) throw new Error("BUG_INTAKE_VERSION_FAILED");
  if (source.attachments.length) {
    await tx.insert(bugIntakeFiles).values(
      source.attachments.map((file) => ({
        versionId: version.id,
        sourceFileId: file.sourceFileId,
        name: file.name,
        state: "MISSING",
      })),
    );
  }
  // Current source, history and placeholders commit or roll back together.
  // Existing Linear identity and old versions/files are never overwritten.
  return { decision, messageId: message.id, revision: message.revision };
}
