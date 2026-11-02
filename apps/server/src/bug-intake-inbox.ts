import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { bugIntakeUpdates } from "@arken/db";
import { normalizeTelegramBugUpdate } from "./bug-intake-telegram.js";
import { ingestBugSourceInTransaction } from "./bug-intake-store.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
function canonical(value: unknown, depth = 0): unknown {
  if (depth > 40) throw new Error("UPDATE_TOO_DEEP");
  if (Array.isArray(value))
    return value.map((item) => canonical(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, item]) => [key, canonical(item, depth + 1)]),
    );
  return value;
}

/** Authenticated transport only. Input is bounded raw JSON, not an HTTP request
 * with headers/token. Caller may acknowledge ONLY after this commit succeeds. */
export async function persistTelegramBugUpdate(
  db: Database,
  receiverId: string,
  allowedChatId: string,
  json: string,
) {
  z.string().uuid().parse(receiverId);
  if (!/^-?[1-9][0-9]*$/.test(allowedChatId))
    throw new Error("CHAT_ALLOWLIST_REQUIRED");
  if (Buffer.byteLength(json, "utf8") > 256 * 1024)
    throw new Error("UPDATE_TOO_LARGE");
  const input = JSON.parse(json);
  const header = z
    .object({ update_id: z.number().int().safe().nonnegative() })
    .parse(input);
  const keys = [
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
  ].filter((key) => input[key] !== undefined);
  if (keys.length !== 1) return { status: "UNSUPPORTED_UPDATE" as const };
  const chat = z
    .object({ chat: z.object({ id: z.number().int().safe() }) })
    .parse(input[keys[0]!]);
  if (String(chat.chat.id) !== allowedChatId)
    return { status: "OTHER_CHAT" as const };
  const payload = canonical(input) as Record<string, unknown>;
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  const updateId = String(header.update_id);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"bug-inbox:" + receiverId + ":" + updateId}, 0))`,
    );
    const [old] = await tx
      .select()
      .from(bugIntakeUpdates)
      .where(
        and(
          eq(bugIntakeUpdates.receiverId, receiverId),
          eq(bugIntakeUpdates.updateId, updateId),
        ),
      )
      .for("update");
    if (old) {
      if (old.payloadHash !== payloadHash) {
        const duplicate = old.conflictingPayloads.some(
          (variant) => variant.hash === payloadHash,
        );
        // Bounded quarantine: refuse acknowledgement if evidence cannot be saved.
        if (!duplicate && old.conflictingPayloads.length >= 8)
          return { status: "COLLISION_CAPACITY_EXCEEDED" as const, id: old.id };
        await tx
          .update(bugIntakeUpdates)
          .set({
            state: "QUARANTINED",
            reason: "UPDATE_ID_COLLISION",
            conflictingPayloads: duplicate
              ? old.conflictingPayloads
              : [...old.conflictingPayloads, { hash: payloadHash, payload }],
            updatedAt: new Date(),
          })
          .where(eq(bugIntakeUpdates.id, old.id));
        return {
          status: "PERSISTED" as const,
          quarantined: true,
          id: old.id,
          duplicate,
        };
      }
      return { status: "PERSISTED" as const, id: old.id, duplicate: true };
    }
    const [row] = await tx
      .insert(bugIntakeUpdates)
      .values({ receiverId, updateId, payloadHash, payload })
      .returning({ id: bugIntakeUpdates.id });
    if (!row) throw new Error("BUG_INBOX_WRITE_FAILED");
    return { status: "PERSISTED" as const, id: row.id, duplicate: false };
  });
}

/** Inbox row lock then source identity/message lock. Canonical writes and inbox
 * disposition commit together; never open a second pool connection while locked. */
export async function processTelegramBugUpdate(
  db: Database,
  receiverId: string,
  id: string,
  allowedChatId: string,
) {
  z.string().uuid().parse(receiverId);
  z.string().uuid().parse(id);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(bugIntakeUpdates)
      .where(
        and(
          eq(bugIntakeUpdates.id, id),
          eq(bugIntakeUpdates.receiverId, receiverId),
        ),
      )
      .for("update");
    if (!row || row.state !== "PENDING")
      return { status: "NOT_PENDING" as const };
    let normalized;
    try {
      normalized = normalizeTelegramBugUpdate(row.payload, allowedChatId);
    } catch {
      normalized = { status: "INVALID_UPDATE" as const };
    }
    const receipt =
      normalized.status === "READY"
        ? await ingestBugSourceInTransaction(tx, normalized.source)
        : null;
    if (receipt?.decision === "DEFERRED_SENDING")
      return { status: "DEFERRED_SENDING" as const };
    const reason =
      normalized.status !== "READY"
        ? normalized.status
        : receipt?.decision === "REVISION_COLLISION"
          ? "REVISION_COLLISION"
          : null;
    const [updated] = await tx
      .update(bugIntakeUpdates)
      .set({
        state: reason ? "QUARANTINED" : "PROCESSED",
        reason,
        messageId: receipt?.messageId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(bugIntakeUpdates.id, id), eq(bugIntakeUpdates.state, "PENDING")),
      )
      .returning({ state: bugIntakeUpdates.state });
    return { status: updated?.state ?? "STATE_CHANGED" };
  });
}
