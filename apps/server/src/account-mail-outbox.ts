import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { accountActionTokens, accountMailOutbox, users } from "@arken/db";
import type { MailAdapter, MailKeyring, OutboundMail } from "./account-mail.js";
import { decryptMailEnvelope, encryptMailEnvelope } from "./account-mail.js";
import { hashToken, randomToken } from "./security.js";

type Purpose = "VERIFY_EMAIL" | "RESET_PASSWORD";
type Db = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
const ttl = (purpose: Purpose) => purpose === "VERIFY_EMAIL" ? 86_400_000 : 1_800_000;
const subject = (purpose: Purpose) => purpose === "VERIFY_EMAIL" ? "Verify your Arken account" : "Reset your Arken password";

/** Called inside the caller's user-serialized transaction. Returns only the test/request-local bearer. */
export async function enqueueAccountAction(tx: Transaction, args: { keyring: MailKeyring; publicUrl: string; email: string; userId: string; purpose: Purpose; now?: Date }) {
  const now = args.now ?? new Date();
  const token = randomToken(32), tokenId = randomUUID(), messageId = randomUUID();
  const expiresAt = new Date(now.getTime() + ttl(args.purpose));
  const route = args.purpose === "VERIFY_EMAIL" ? "/account/verify" : "/account/reset-password";
  const mail: OutboundMail = { to: args.email, subject: subject(args.purpose), text: `${subject(args.purpose)}: ${args.publicUrl.replace(/\/$/, "")}${route}#token=${encodeURIComponent(token)}` };
  const context = { messageId, actionTokenId: tokenId, purpose: args.purpose, formatVersion: 1, keyId: args.keyring.activeKeyId } as const;
  const sealed = encryptMailEnvelope(args.keyring, context, mail);
  const prior = await tx.select({ id: accountActionTokens.id }).from(accountActionTokens).where(and(eq(accountActionTokens.userId, args.userId), eq(accountActionTokens.purpose, args.purpose), isNull(accountActionTokens.usedAt)));
  const priorIds = prior.map((r: { id: string }) => r.id);
  if (priorIds.length) {
    await tx.update(accountActionTokens).set({ usedAt: now }).where(inArray(accountActionTokens.id, priorIds));
    await tx.update(accountMailOutbox).set({ status: "CANCELLED", payloadNonce: null, payloadCiphertext: null, payloadAuthTag: null, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, lastErrorCategory: "SUPERSEDED" }).where(and(inArray(accountMailOutbox.actionTokenId, priorIds), or(eq(accountMailOutbox.status, "PENDING"), eq(accountMailOutbox.status, "LEASED"))));
  }
  await tx.insert(accountActionTokens).values({ id: tokenId, userId: args.userId, purpose: args.purpose, tokenHash: hashToken(token), expiresAt });
  await tx.insert(accountMailOutbox).values({ id: messageId, actionTokenId: tokenId, purpose: args.purpose, formatVersion: 1, keyId: sealed.keyId, payloadNonce: sealed.nonce, payloadCiphertext: sealed.ciphertext, payloadAuthTag: sealed.authTag, expiresAt });
  return token;
}

export async function cancelActionMessages(tx: Transaction, actionIds: string[], category: "TOKEN_USED" | "SUPERSEDED") {
  if (!actionIds.length) return;
  await tx.update(accountMailOutbox).set({ status: "CANCELLED", payloadNonce: null, payloadCiphertext: null, payloadAuthTag: null, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, lastErrorCategory: category }).where(and(inArray(accountMailOutbox.actionTokenId, actionIds), or(eq(accountMailOutbox.status, "PENDING"), eq(accountMailOutbox.status, "LEASED"))));
}

export type DrainResult = { accepted: number; retried: number; cancelled: number; blocked: number };
async function sendWithTimeout(adapter: MailAdapter, mail: OutboundMail, messageId: string, timeoutMs: number) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      adapter.send(mail, { messageId, signal: controller.signal }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error("TRANSPORT_TIMEOUT")); }, timeoutMs); }),
    ]);
  } finally { if (timeout) clearTimeout(timeout); }
}
/** Bounded at-least-once drain. The claim commits before transport; lease token fences acknowledgements. */
export async function drainAccountMailOutboxOnce(db: Db, options: { keyring: MailKeyring; adapter: MailAdapter; workerId: string; batchSize?: number; leaseMs?: number; maxAttempts?: number; transportTimeoutMs?: number; now?: Date }): Promise<DrainResult> {
  const requestedBatch = options.batchSize ?? 10, leaseMs = options.leaseMs ?? 30_000, transportTimeoutMs = options.transportTimeoutMs ?? 10_000;
  const maxAttempts = options.maxAttempts ?? 5;
  if (!Number.isInteger(requestedBatch) || requestedBatch < 1 || requestedBatch > 100 || !Number.isInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 300_000 || !Number.isInteger(transportTimeoutMs) || transportTimeoutMs < 100 || transportTimeoutMs > 30_000 || leaseMs < transportTimeoutMs + 5_000 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 || !options.workerId || options.workerId.length > 100)
    throw new Error("MAIL_DRAIN_OPTIONS_INVALID");
  // Sends are sequential in this bounded helper. Do not lease more work than
  // can finish before the lease deadline with a safety margin.
  const batchSize = Math.min(requestedBatch, Math.max(1, Math.floor((leaseMs - 5_000) / transportTimeoutMs)));
  const now = options.now ?? new Date(), leaseUntil = new Date(now.getTime() + leaseMs);
  const claim = await db.transaction(async (tx) => {
    const staleRows = await tx.select({ message: accountMailOutbox, token: accountActionTokens, user: users })
      .from(accountMailOutbox).innerJoin(accountActionTokens, eq(accountMailOutbox.actionTokenId, accountActionTokens.id)).innerJoin(users, eq(accountActionTokens.userId, users.id))
      .where(and(or(eq(accountMailOutbox.status, "PENDING"), eq(accountMailOutbox.status, "LEASED")), or(
        lte(accountMailOutbox.expiresAt, now), lte(accountActionTokens.expiresAt, now),
        sql`${accountActionTokens.usedAt} IS NOT NULL`, sql`${users.disabledAt} IS NOT NULL`,
        and(eq(accountMailOutbox.purpose, "VERIFY_EMAIL"), sql`${users.verifiedAt} IS NOT NULL`),
        and(eq(accountMailOutbox.purpose, "RESET_PASSWORD"), isNull(users.verifiedAt)),
      )))
      .for("update", { of: accountMailOutbox, skipLocked: true }).limit(batchSize);
    for (const row of staleRows) {
      const category = row.message.expiresAt <= now || row.token.expiresAt <= now ? "TOKEN_EXPIRED"
        : row.token.usedAt ? "TOKEN_USED" : "USER_INELIGIBLE";
      await tx.update(accountMailOutbox).set({ status: "CANCELLED", payloadNonce: null, payloadCiphertext: null, payloadAuthTag: null, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, lastErrorCategory: category }).where(eq(accountMailOutbox.id, row.message.id));
    }
    const exhausted = await tx.select({ id: accountMailOutbox.id }).from(accountMailOutbox).where(and(
      or(eq(accountMailOutbox.status, "PENDING"), eq(accountMailOutbox.status, "LEASED")),
      sql`${accountMailOutbox.attemptCount} >= ${maxAttempts}`,
      or(and(eq(accountMailOutbox.status, "PENDING"), lte(accountMailOutbox.nextAttemptAt, now)), and(eq(accountMailOutbox.status, "LEASED"), lte(accountMailOutbox.leaseExpiresAt, now))),
    )).for("update", { skipLocked: true }).limit(batchSize);
    for (const row of exhausted) await tx.update(accountMailOutbox).set({ status: "DEAD", payloadNonce: null, payloadCiphertext: null, payloadAuthTag: null, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, lastErrorCategory: "RETRY_EXHAUSTED" }).where(eq(accountMailOutbox.id, row.id));
    const rows = await tx.select({ message: accountMailOutbox, token: accountActionTokens, user: users })
      .from(accountMailOutbox).innerJoin(accountActionTokens, eq(accountMailOutbox.actionTokenId, accountActionTokens.id)).innerJoin(users, eq(accountActionTokens.userId, users.id))
      .where(and(
        or(eq(accountMailOutbox.status, "PENDING"), eq(accountMailOutbox.status, "LEASED")),
        or(
          and(eq(accountMailOutbox.status, "PENDING"), lte(accountMailOutbox.nextAttemptAt, now)),
          and(eq(accountMailOutbox.status, "LEASED"), lte(accountMailOutbox.leaseExpiresAt, now)),
          lte(accountMailOutbox.expiresAt, now), lte(accountActionTokens.expiresAt, now),
          sql`${accountActionTokens.usedAt} IS NOT NULL`, sql`${users.disabledAt} IS NOT NULL`,
        ),
        inArray(accountMailOutbox.keyId, [...options.keyring.keys.keys()]),
        sql`${accountMailOutbox.attemptCount} < ${maxAttempts}`,
      ))
      .for("update", { of: accountMailOutbox, skipLocked: true }).limit(batchSize);
    const out = [];
    for (const row of rows) {
      const invalid = row.message.expiresAt <= now || row.token.usedAt || row.token.expiresAt <= now
        ? (row.message.expiresAt <= now || row.token.expiresAt <= now ? "TOKEN_EXPIRED" : "TOKEN_USED")
        : row.user.disabledAt || (row.message.purpose === "VERIFY_EMAIL" ? Boolean(row.user.verifiedAt) : !row.user.verifiedAt) ? "USER_INELIGIBLE" : null;
      if (invalid) {
        await tx.update(accountMailOutbox).set({ status: "CANCELLED", payloadNonce: null, payloadCiphertext: null, payloadAuthTag: null, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, lastErrorCategory: invalid }).where(eq(accountMailOutbox.id, row.message.id));
        continue;
      }
      if (!options.keyring.keys.has(row.message.keyId)) continue; // excluded above; defensive and preserves ciphertext
      const leaseToken = randomUUID();
      const [leased] = await tx.update(accountMailOutbox).set({ status: "LEASED", leaseOwner: options.workerId, leaseToken, leaseExpiresAt: leaseUntil, attemptCount: row.message.attemptCount + 1 }).where(eq(accountMailOutbox.id, row.message.id)).returning();
      if (leased) out.push({ message: leased, token: row.token, user: row.user, leaseToken });
    }
    return { out, cancelled: staleRows.length + exhausted.length };
  });
  const result: DrainResult = { accepted: 0, retried: 0, cancelled: claim.cancelled, blocked: 0 };
  const claimed = claim.out;
  for (const row of claimed) {
    if (!row.message.payloadNonce || !row.message.payloadCiphertext || !row.message.payloadAuthTag) { result.blocked++; continue; }
    const context = { messageId: row.message.id, actionTokenId: row.message.actionTokenId, purpose: row.message.purpose as Purpose, formatVersion: row.message.formatVersion, keyId: row.message.keyId };
    let mail: OutboundMail;
    try { mail = decryptMailEnvelope(options.keyring, context, { keyId: row.message.keyId, nonce: row.message.payloadNonce, ciphertext: row.message.payloadCiphertext, authTag: row.message.payloadAuthTag }); }
    catch {
      const terminal = row.message.attemptCount >= maxAttempts;
      await db.update(accountMailOutbox).set({ status: terminal ? "DEAD" : "PENDING", nextAttemptAt: new Date(Date.now() + 60_000), payloadNonce: terminal ? null : row.message.payloadNonce, payloadCiphertext: terminal ? null : row.message.payloadCiphertext, payloadAuthTag: terminal ? null : row.message.payloadAuthTag, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, lastErrorCategory: terminal ? "RETRY_EXHAUSTED" : "DECRYPTION_FAILED" }).where(and(eq(accountMailOutbox.id, row.message.id), eq(accountMailOutbox.leaseToken, row.leaseToken)));
      result.blocked++; continue;
    }
    // Revalidate immediately before transport; already-invalid credentials never dispatch.
    const [current] = await db.select({ token: accountActionTokens, user: users }).from(accountActionTokens).innerJoin(users, eq(accountActionTokens.userId, users.id)).where(and(eq(accountActionTokens.id, row.message.actionTokenId), isNull(accountActionTokens.usedAt), sql`${accountActionTokens.expiresAt} > clock_timestamp()`, isNull(users.disabledAt)));
    const [stillOwned] = await db.select({ id: accountMailOutbox.id }).from(accountMailOutbox).where(and(
      eq(accountMailOutbox.id, row.message.id), eq(accountMailOutbox.status, "LEASED"), eq(accountMailOutbox.leaseToken, row.leaseToken), sql`${accountMailOutbox.leaseExpiresAt} > clock_timestamp()`,
    ));
    if (!stillOwned) continue; // lease expired/reclaimed; never dispatch from a stale claim
    const ineligible = !current || Boolean(current.user.disabledAt) || (row.message.purpose === "VERIFY_EMAIL" ? Boolean(current.user.verifiedAt) : !current.user.verifiedAt);
    if (ineligible) {
      const [cancelled] = await db.update(accountMailOutbox).set({ status: "CANCELLED", payloadNonce: null, payloadCiphertext: null, payloadAuthTag: null, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, lastErrorCategory: !current ? "TOKEN_USED" : "USER_INELIGIBLE" }).where(and(eq(accountMailOutbox.id, row.message.id), eq(accountMailOutbox.leaseToken, row.leaseToken))).returning({ id: accountMailOutbox.id });
      if (cancelled) result.cancelled++; continue;
    }
    try {
      if (!options.adapter.ready) throw new Error("TRANSPORT_UNAVAILABLE");
      await sendWithTimeout(options.adapter, mail, row.message.id, transportTimeoutMs);
      const ack = await db.update(accountMailOutbox).set({ status: "ACCEPTED", acceptedAt: new Date(), payloadNonce: null, payloadCiphertext: null, payloadAuthTag: null, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, lastErrorCategory: null }).where(and(eq(accountMailOutbox.id, row.message.id), eq(accountMailOutbox.status, "LEASED"), eq(accountMailOutbox.leaseToken, row.leaseToken))).returning({ id: accountMailOutbox.id });
      if (ack.length) result.accepted++;
    } catch {
      const terminal = row.message.attemptCount >= maxAttempts;
      const delay = Math.min(3_600_000, 1_000 * (2 ** Math.min(row.message.attemptCount, 10))) + Math.floor(Math.random() * 1_000);
      const updated = await db.update(accountMailOutbox).set({ status: terminal ? "DEAD" : "PENDING", nextAttemptAt: new Date(Date.now() + delay), payloadNonce: terminal ? null : row.message.payloadNonce, payloadCiphertext: terminal ? null : row.message.payloadCiphertext, payloadAuthTag: terminal ? null : row.message.payloadAuthTag, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, lastErrorCategory: terminal ? "RETRY_EXHAUSTED" : "TRANSPORT_FAILURE" }).where(and(eq(accountMailOutbox.id, row.message.id), eq(accountMailOutbox.status, "LEASED"), eq(accountMailOutbox.leaseToken, row.leaseToken))).returning({ id: accountMailOutbox.id });
      if (updated.length) result.retried++;
    }
  }
  return result;
}
