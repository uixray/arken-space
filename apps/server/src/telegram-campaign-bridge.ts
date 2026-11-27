import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { memberships, sessions, telegramCampaignChats as chats,
  telegramCampaignMembers as members, telegramCampaignLinkCodes as codes,
  telegramCampaignUpdates as updates } from "@arken/db";
import { requireAuth, sessionIsActive } from "./auth.js";
import { hashToken, randomToken } from "./security.js";
import { env } from "./env.js";
import { persistTelegramBugUpdate } from "./bug-intake-inbox.js";
import { campaignBotCommand, runCampaignBotCommand } from "./telegram-campaign-command.js";
import { createBugIntakeDrain } from "./bug-intake-drain.js";
import { createTelegramBugFileSource } from "./bug-intake-telegram-files.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Receipt = typeof updates.$inferSelect;
const numericId = z.string().regex(/^-?[1-9]\d*$/).max(24).refine(value => Number.isSafeInteger(Number(value)));
const groupId = numericId.refine(value => value.startsWith("-"));
const userId = z.string().regex(/^[1-9]\d*$/).max(24).refine(value => Number.isSafeInteger(Number(value)));
const threadId = z.string().regex(/^(0|[1-9]\d*)$/).max(20).refine(value => Number.isSafeInteger(Number(value)));
const integer = z.number().int().safe();
const messageSchema = z.object({ message_id: integer.positive(),
  from: z.object({ id: integer.positive(), is_bot: z.boolean() }),
  chat: z.object({ id: integer, type: z.enum(["private", "group", "supergroup"]) }),
  message_thread_id: integer.positive().optional(),
  text: z.string().max(4000).optional(), caption: z.string().max(1024).optional(),
}).passthrough();
const updateSchema = z.object({ update_id: integer.nonnegative(),
  message: messageSchema.optional(), edited_message: messageSchema.optional(),
}).passthrough();

function canonical(value: unknown, depth = 0): unknown {
  if (depth > 30) throw new Error("TELEGRAM_UPDATE_TOO_DEEP");
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item, depth + 1)]));
  return value;
}
async function identity(db: Database, sessionId: string) {
  if (!(await sessionIsActive(db, sessionId))) return null;
  const [row] = await db.select({ sessionId: sessions.id, campaignId: memberships.campaignId,
    role: memberships.role, membershipId: memberships.id }).from(sessions)
    .innerJoin(memberships, eq(sessions.membershipId, memberships.id))
    .where(eq(sessions.id, sessionId)).limit(1);
  return row ?? null;
}

/** Dormant by default. Setting configuration is a separate owner activation. */
export function registerTelegramCampaignBridge(app: FastifyInstance, db: Database) {
  const enabled = env.TELEGRAM_CAMPAIGN_ENABLED === "true";
  const config = enabled ? z.object({ receiverId: z.string().uuid(),
    username: z.string().regex(/^[A-Za-z0-9_]{5,32}$/),
    token: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/),
    secret: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
    bugChatId: groupId,
  }).safeParse({ receiverId: env.TELEGRAM_CAMPAIGN_RECEIVER_ID,
    username: env.TELEGRAM_CAMPAIGN_USERNAME, token: env.TELEGRAM_CAMPAIGN_TOKEN,
    secret: env.TELEGRAM_CAMPAIGN_SECRET, bugChatId: env.TELEGRAM_CAMPAIGN_BUG_CHAT_ID }) : null;
  if (enabled && !config?.success) throw new Error("TELEGRAM_CAMPAIGN_CONFIGURATION_INVALID");
  if (enabled && env.DEPLOYMENT_MODE !== "HOSTED") throw new Error("TELEGRAM_CAMPAIGN_REQUIRES_HOSTED_MODE");
  if (enabled && (env.BUG_INTAKE_ENABLED !== "true" || !isAbsolute(env.BUG_INTAKE_ROOT)))
    throw new Error("TELEGRAM_CAMPAIGN_REQUIRES_PRIVATE_BUG_INTAKE");
  const settings = config?.success ? config.data : null;
  const receiverId = settings?.receiverId ?? "";
  const workerId = randomUUID();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  const options = { logLevel: "silent" as const,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };
  const originAllowed = (origin: string | undefined) => origin === env.WEB_ORIGIN;
  const boundAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "private, no-store");
    const auth = await requireAuth(request, reply, db);
    if (!auth) return null;
    if (request.headers["x-arken-membership-id"] !== auth.membershipId) {
      await reply.code(409).send({ error: "MEMBERSHIP_SESSION_CHANGED" });
      return null;
    }
    return auth;
  };

  app.get("/api/telegram/campaign", options, async (request, reply) => {
    const auth = await boundAuth(request, reply);
    if (!auth) return;
    reply.header("Cache-Control", "private, no-store");
    if (!settings) return { enabled: false };
    const personal = await db.select({ id: members.id }).from(members).where(and(
      eq(members.receiverId, receiverId), eq(members.sessionId, auth.sessionId))).limit(1);
    const group = await db.select({ id: chats.id, owner: chats.ownerSessionId }).from(chats).where(and(
      eq(chats.receiverId, receiverId), eq(chats.campaignId, auth.campaignId))).limit(1);
    const groupOwner = group[0] ? await identity(db, group[0].owner) : null;
    const receipts = await db.select({ id: updates.id, state: updates.state,
      delivery: updates.replyState, error: updates.errorCode, createdAt: updates.createdAt,
      text: sql<string>`${updates.payload}->>'text'` }).from(updates).where(and(
        eq(updates.receiverId, receiverId), eq(updates.sessionId, auth.sessionId)))
      .orderBy(desc(updates.createdAt)).limit(30);
    return { enabled: true, username: settings.username, gm: auth.role === "GM",
      linked: personal.length > 0, groupLinked: groupOwner?.role === "GM" && groupOwner.campaignId === auth.campaignId,
      receipts: receipts.map(({ text, ...row }) => ({ ...row, command: campaignBotCommand(text)?.name ?? "command" })) };
  });
  app.post("/api/telegram/campaign/code", options, async (request, reply) => {
    const auth = await boundAuth(request, reply);
    if (!auth) return;
    reply.header("Cache-Control", "private, no-store");
    if (!settings) return reply.code(404).send({ error: "TELEGRAM_DISABLED" });
    if (!originAllowed(request.headers.origin)) return reply.code(403).send({ error: "ORIGIN_REQUIRED" });
    const body = z.object({ telegramUserId: userId, chatId: groupId.optional(),
      threadId: threadId.default("0") }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_LINK" });
    if (body.data.chatId && auth.role !== "GM") return reply.code(403).send({ error: "GM_REQUIRED" });
    const active = await db.select({ id: codes.id }).from(codes).where(and(
      eq(codes.sessionId, auth.sessionId), isNull(codes.consumedAt), gt(codes.expiresAt, new Date()))).limit(10);
    if (active.length >= 10) return reply.code(429).send({ error: "TOO_MANY_LINK_CODES" });
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await db.insert(codes).values({ receiverId, tokenHash: hashToken(token),
      sessionId: auth.sessionId, telegramUserId: body.data.telegramUserId,
      chatId: body.data.chatId ?? null, threadId: body.data.threadId, expiresAt });
    return { command: `/link ${token}`, expiresAt: expiresAt.toISOString() };
  });
  app.post("/api/telegram/campaign/unlink", options, async (request, reply) => {
    const auth = await boundAuth(request, reply);
    if (!auth) return;
    if (!originAllowed(request.headers.origin)) return reply.code(403).send({ error: "ORIGIN_REQUIRED" });
    if (!settings) return reply.code(404).send({ error: "TELEGRAM_DISABLED" });
    await db.transaction(async tx => {
      await tx.delete(members).where(and(eq(members.receiverId, receiverId), eq(members.sessionId, auth.sessionId)));
      await tx.delete(chats).where(and(eq(chats.receiverId, receiverId), eq(chats.ownerSessionId, auth.sessionId)));
      await tx.delete(codes).where(and(eq(codes.receiverId, receiverId), eq(codes.sessionId, auth.sessionId)));
    });
    return { unlinked: true };
  });
  if (!settings) return async () => {};
  const fileDrain = createBugIntakeDrain(db, {
    receiverId, allowedChatId: settings.bugChatId,
    storage: { root: env.BUG_INTAKE_ROOT,
      maxBytes: Math.min(env.BUG_INTAKE_MAX_FILE_BYTES, 20 * 1024 * 1024), maxTotalBytes: 1024 ** 3 },
  }, createTelegramBugFileSource(settings.token, Math.min(env.BUG_INTAKE_MAX_FILE_BYTES, 20 * 1024 * 1024)));
  const fileAbort = new AbortController();
  let fileRunning: Promise<void> | null = null;
  let fileTimer: ReturnType<typeof setTimeout> | undefined;
  let filePaused = false;
  function wakeFiles() {
    if (stopped || filePaused || fileRunning) return;
    clearTimeout(fileTimer);
    fileRunning = fileDrain(fileAbort.signal).then(result => {
      if (result.status === "RECONCILIATION_REQUIRED") {
        filePaused = true;
        app.log.warn({ event: "telegram_bug_files_require_reconciliation" }, "Bug attachments require review");
      }
    }).catch(() => {
      app.log.warn({ event: "telegram_bug_drain_unavailable" }, "Bug inbox requires attention");
    }).finally(() => {
      fileRunning = null;
      if (!stopped && !filePaused) { fileTimer = setTimeout(wakeFiles, 15_000); fileTimer.unref(); }
    });
  }

  app.post("/api/telegram/campaign/recover", options, async (request, reply) => {
    const auth = await boundAuth(request, reply);
    if (!auth) return;
    if (!originAllowed(request.headers.origin)) return reply.code(403).send({ error: "ORIGIN_REQUIRED" });
    const parsed = z.object({ id: z.string().uuid(),
      action: z.enum(["RETRY_COMMAND", "RETRY_SEND", "CONFIRM_SENT"]),
      previousWorkerStopped: z.boolean().default(false),
      confirmedNotSent: z.boolean().default(false), confirmedReceived: z.boolean().default(false), messageId: userId.optional(),
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_RECOVERY" });
    const body = parsed.data;
    const [row] = await db.select().from(updates).where(and(eq(updates.id, body.id),
      eq(updates.receiverId, receiverId), eq(updates.sessionId, auth.sessionId))).limit(1);
    if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
    if (row.workerId === workerId && running && (row.state === "RUNNING" || row.replyState === "SENDING"))
      return reply.code(409).send({ error: "WORKER_STILL_ACTIVE" });
    if (body.action === "RETRY_COMMAND") {
      if (!["RUNNING", "UNKNOWN"].includes(row.state) || !body.previousWorkerStopped)
        return reply.code(409).send({ error: "STOPPED_WORKER_CONFIRMATION_REQUIRED" });
      await db.update(updates).set({ state: "PENDING", errorCode: null, updatedAt: new Date() })
        .where(and(eq(updates.id, row.id), eq(updates.state, row.state), eq(updates.replyState, row.replyState)));
    } else if (body.action === "RETRY_SEND") {
      if (row.state !== "DONE" || !["FAILED", "UNKNOWN", "SENDING"].includes(row.replyState) ||
          (row.replyState !== "FAILED" && (!body.confirmedNotSent || !body.previousWorkerStopped)))
        return reply.code(409).send({ error: "DELIVERY_RECONCILIATION_REQUIRED" });
      await db.update(updates).set({ replyState: "PENDING", errorCode: null, updatedAt: new Date() })
        .where(and(eq(updates.id, row.id), eq(updates.replyState, row.replyState)));
    } else {
      if (row.state !== "DONE" || (!body.messageId && !body.confirmedReceived) || !["SENDING", "UNKNOWN"].includes(row.replyState) || !body.previousWorkerStopped)
        return reply.code(409).send({ error: "DELIVERY_RECONCILIATION_REQUIRED" });
      await db.update(updates).set({ replyState: "SENT", replyMessageId: body.messageId ?? row.replyMessageId,
        errorCode: "MANUALLY_RECONCILED", updatedAt: new Date() })
        .where(and(eq(updates.id, row.id), eq(updates.replyState, row.replyState)));
    }
    wake();
    return { accepted: true };
  });

  const actorFor = async (row: Receipt) => {
    const [link] = await db.select().from(members).where(and(
      eq(members.receiverId, receiverId), eq(members.telegramUserId, row.telegramUserId))).limit(1);
    const actor = link ? await identity(db, link.sessionId) : null;
    if (!actor || (row.sessionId && row.sessionId !== actor.sessionId)) return null;
    const payload = row.payload;
    if (payload.privateChat !== true) {
      const [group] = await db.select().from(chats).where(and(eq(chats.receiverId, receiverId),
        eq(chats.chatId, row.chatId), eq(chats.threadId, row.threadId),
        eq(chats.campaignId, actor.campaignId))).limit(1);
      const groupOwner = group ? await identity(db, group.ownerSessionId) : null;
      if (!groupOwner || groupOwner.role !== "GM" || groupOwner.campaignId !== actor.campaignId) return null;
    }
    return actor;
  };
  const finish = async (id: string, text: string, sessionId: string | null) => {
    await db.update(updates).set({ state: "DONE", replyState: "PENDING",
      replyText: text.length > 3500 ? text.slice(0, 3400) + "\nСводка сокращена. Полные данные доступны в приложении." : text,
      sessionId, errorCode: null, updatedAt: new Date() })
      .where(and(eq(updates.id, id), eq(updates.state, "RUNNING"), eq(updates.workerId, workerId)));
  };
  const processOne = async (row: Receipt) => {
    const command = campaignBotCommand(String(row.payload.text ?? ""));
    if (!command) throw new Error("INVALID_COMMAND");
    if (command.name === "whoami" || command.name === "where") {
      await finish(row.id, `Ваш Telegram ID: ${row.telegramUserId}\nID чата: ${row.chatId}\nID темы: ${row.threadId}`, null);
      return;
    }
    if (command.name === "bug") {
      await finish(row.id, "Баг сохранён в существующей очереди проверки. Отправка в Linear выполняется после подтверждения записи.", null);
      return;
    }
    if (command.name === "link") {
      const [code] = await db.select().from(codes).where(and(eq(codes.receiverId, receiverId),
        eq(codes.tokenHash, String(row.payload.linkHash)), eq(codes.telegramUserId, row.telegramUserId),
        isNull(codes.consumedAt), gt(codes.expiresAt, new Date()))).limit(1);
      const owner = code ? await identity(db, code.sessionId) : null;
      if (!code || !owner || (code.chatId === null ? row.payload.privateChat !== true :
          row.payload.privateChat === true || owner.role !== "GM" || code.chatId !== row.chatId || code.threadId !== row.threadId)) {
        await finish(row.id, "Код недействителен для этого пользователя или чата. Создайте новый код в приложении.", null);
        return;
      }
      try { await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"telegram-link:" + receiverId}, 0))`);
        const [claim] = await tx.update(codes).set({ consumedAt: new Date() }).where(and(
          eq(codes.id, code.id), isNull(codes.consumedAt), gt(codes.expiresAt, new Date())))
          .returning({ id: codes.id });
        if (!claim) throw new Error("LINK_ALREADY_USED");
        if (code.chatId) {
          // A destination already attached elsewhere cannot be silently stolen.
          const [occupied] = await tx.select().from(chats).where(and(eq(chats.receiverId, receiverId),
            eq(chats.chatId, code.chatId), eq(chats.threadId, code.threadId))).limit(1);
          if (occupied && occupied.campaignId !== owner.campaignId) throw new Error("CHAT_ALREADY_LINKED");
          await tx.insert(chats).values({ receiverId, campaignId: owner.campaignId,
            ownerSessionId: owner.sessionId, chatId: code.chatId, threadId: code.threadId })
            .onConflictDoUpdate({ target: [chats.receiverId, chats.campaignId], set: {
              ownerSessionId: owner.sessionId, chatId: code.chatId, threadId: code.threadId } });
        }
        await tx.insert(members).values({ receiverId, telegramUserId: row.telegramUserId, sessionId: owner.sessionId })
          .onConflictDoUpdate({ target: [members.receiverId, members.telegramUserId], set: { sessionId: owner.sessionId } });
        await tx.update(updates).set({ state: "DONE", replyState: "PENDING", sessionId: owner.sessionId,
          replyText: "Telegram подключён. Выход из исходного сеанса приложения отключает привязку.",
          updatedAt: new Date() }).where(eq(updates.id, row.id));
      }); } catch (error) {
        if (error instanceof Error && ["LINK_ALREADY_USED", "CHAT_ALREADY_LINKED"].includes(error.message)) {
          await finish(row.id, "Код уже использован или чат связан с другой кампанией. Проверьте привязки в приложении.", null);
        } else throw error;
      }
      return;
    }
    const actor = await actorFor(row);
    if (!actor) throw new Error("LINK_REVOKED");
    if (command.name === "unlink") {
      if (row.payload.privateChat !== true) { await finish(row.id, "Отключайте личную привязку в личном диалоге или приложении.", actor.sessionId); return; }
      await db.delete(members).where(and(eq(members.receiverId, receiverId), eq(members.telegramUserId, row.telegramUserId)));
      await finish(row.id, "Личная привязка отключена.", null);
      return;
    }
    await db.update(updates).set({ sessionId: actor.sessionId }).where(eq(updates.id, row.id));
    const text = await runCampaignBotCommand(app, db, { sessionId: actor.sessionId,
      campaignId: actor.campaignId, actionId: row.actionId, text: String(row.payload.text),
      privateChat: row.payload.privateChat === true });
    await finish(row.id, text, actor.sessionId);
  };

  const sendOne = async (row: Receipt) => {
    const now = Date.now();
    if (now < globalSendAfter || now < (sendAfter.get(row.chatId) ?? 0)) return;
    const name = campaignBotCommand(String(row.payload.text ?? ""))?.name;
    const harmless = row.sessionId === null && (
      ["whoami", "where", "link"].includes(name ?? "") ||
      (name === "unlink" && row.payload.privateChat === true) ||
      (name === "bug" && row.chatId === settings.bugChatId));
    if (!harmless && !(await actorFor(row))) {
      await db.update(updates).set({ replyState: "CANCELLED", updatedAt: new Date() }).where(eq(updates.id, row.id));
      return;
    }
    const [claimed] = await db.update(updates).set({ replyState: "SENDING", workerId, updatedAt: new Date() })
      .where(and(eq(updates.id, row.id), eq(updates.replyState, "PENDING"))).returning({ id: updates.id });
    if (!claimed) return;
    globalSendAfter = now + 100;
    if (!sendAfter.has(row.chatId) && sendAfter.size >= 1024)
      sendAfter.delete(sendAfter.keys().next().value!);
    sendAfter.set(row.chatId, now + 3500);
    try {
      const response = await fetch(`https://api.telegram.org/bot${settings.token}/sendMessage`, {
        method: "POST", signal: AbortSignal.timeout(15_000), redirect: "error",
        headers: { "content-type": "application/json" }, body: JSON.stringify({
          chat_id: row.chatId, text: row.replyText, link_preview_options: { is_disabled: true },
          ...(row.threadId === "0" ? {} : { message_thread_id: Number(row.threadId) }),
        }),
      });
      // Do not retain Telegram response bodies/errors containing request details.
      if (Number(response.headers.get("content-length") ?? 0) > 65536) throw new Error("OVERSIZED_REPLY");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("EMPTY_REPLY");
      let text = ""; let bytes = 0; const decoder = new TextDecoder();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 65536) { await reader.cancel(); throw new Error("OVERSIZED_REPLY"); }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
      const body = z.object({ ok: z.boolean(), result: z.object({ message_id: integer.positive() }).optional() })
        .safeParse(JSON.parse(text));
      if (!body.success) throw new Error("UNKNOWN_REPLY");
      if (body.data.ok && !body.data.result) throw new Error("UNCONFIRMED_MESSAGE_ID");
      const sent = body.data.ok && body.data.result;
      await db.update(updates).set({ replyState: sent ? "SENT" : "FAILED",
        replyMessageId: sent ? String(sent.message_id) : null,
        errorCode: sent ? null : "TELEGRAM_REJECTED", updatedAt: new Date() })
        .where(and(eq(updates.id, row.id), eq(updates.replyState, "SENDING"), eq(updates.workerId, workerId)));
    } catch {
      await db.update(updates).set({ replyState: "UNKNOWN", errorCode: "DELIVERY_UNCONFIRMED", updatedAt: new Date() })
        .where(and(eq(updates.id, row.id), eq(updates.replyState, "SENDING"), eq(updates.workerId, workerId)));
    }
  };
  const sendAfter = new Map<string, number>();
  let globalSendAfter = 0;
  const drain = async () => {
    const pending = await db.select().from(updates).where(and(eq(updates.receiverId, receiverId), eq(updates.state, "PENDING")))
      .orderBy(asc(updates.createdAt)).limit(20);
    for (const row of pending) {
      if (stopped) break;
      const [claim] = await db.update(updates).set({ state: "RUNNING", workerId, updatedAt: new Date() })
        .where(and(eq(updates.id, row.id), eq(updates.state, "PENDING"))).returning();
      if (!claim) continue;
      try { await processOne(claim); }
      catch {
        // Could be after a canonical mutation committed. Never invent success.
        await db.update(updates).set({ state: "UNKNOWN", errorCode: "COMMAND_REQUIRES_REVIEW", updatedAt: new Date() })
          .where(and(eq(updates.id, row.id), eq(updates.state, "RUNNING"), eq(updates.workerId, workerId)));
      }
    }
    const outbox = await db.select().from(updates).where(and(eq(updates.receiverId, receiverId),
      eq(updates.state, "DONE"), eq(updates.replyState, "PENDING"))).orderBy(asc(updates.createdAt)).limit(20);
    for (const row of outbox) { if (stopped) break; await sendOne(row); }
  };
  function wake() {
    if (stopped || running) return;
    clearTimeout(timer);
    running = drain().catch(() => { app.log.warn({ event: "telegram_campaign_queue_unavailable" }, "Telegram queue requires attention"); })
      .finally(() => { running = null; if (!stopped) { timer = setTimeout(wake, 1500); timer.unref(); } });
  }
  app.addHook("onReady", async () => { wake(); wakeFiles(); });
  const stopWorker = async () => { stopped = true; clearTimeout(timer); clearTimeout(fileTimer);
    fileAbort.abort(); await Promise.all([running, fileRunning]); };
  app.addHook("onClose", stopWorker);

  const expected = createHash("sha256").update(settings.secret).digest();
  app.post("/api/integrations/telegram/campaign", { logLevel: "silent", bodyLimit: 256 * 1024,
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    onRequest: async (request, reply) => {
      const header = request.headers["x-telegram-bot-api-secret-token"];
      if (typeof header !== "string" || header.length > 256 ||
          !timingSafeEqual(createHash("sha256").update(header).digest(), expected))
        return reply.code(401).send({ error: "UNAUTHORIZED" });
    },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_UPDATE" });
    const update = parsed.data;
    if (Boolean(update.message) === Boolean(update.edited_message)) return reply.code(204).send();
    const message = update.message ?? update.edited_message;
    if (!message || message.from.is_bot) return reply.code(204).send();
    const text = message.text ?? message.caption ?? "";
    const command = campaignBotCommand(text);
    const mention = /^\/[a-z_]+@([a-z0-9_]+)/i.exec(text.trim())?.[1];
    if (mention && mention.toLowerCase() !== settings.username.toLowerCase()) return reply.code(204).send();
    const chatId = String(message.chat.id), telegramUserId = String(message.from.id);
    const topic = String(message.message_thread_id ?? 0);
    const privateChat = message.chat.type === "private";
    if (privateChat && (chatId !== telegramUserId || topic !== "0")) return reply.code(204).send();
    const bug = chatId === settings.bugChatId && (!command || command.name === "bug");
    if (bug) {
      const receipt = await persistTelegramBugUpdate(db, receiverId, settings.bugChatId, JSON.stringify(request.body));
      if (receipt.status !== "PERSISTED") return reply.code(503).send({ error: "BUG_INBOX_REQUIRES_ATTENTION" });
    }
    if (update.edited_message) return reply.code(200).send({ accepted: bug });
    if (!command && !bug) return reply.code(204).send();
    if (!bug && (!message.text || ["photo", "document", "audio", "video", "animation", "voice", "sticker"]
      .some(key => message[key] !== undefined))) return reply.code(204).send();
    if (!bug && (message.forward_origin || message.sender_chat)) return reply.code(204).send();
    let sessionId: string | null = null;
    if (!bug && !["link", "whoami", "where"].includes(command!.name)) {
      const [member] = await db.select({ sessionId: members.sessionId }).from(members).where(and(
        eq(members.receiverId, receiverId), eq(members.telegramUserId, telegramUserId))).limit(1);
      if (!member) return reply.code(204).send();
      const actor = await identity(db, member.sessionId);
      if (!actor) return reply.code(204).send();
      if (!privateChat) {
        const [group] = await db.select({ owner: chats.ownerSessionId }).from(chats).where(and(
          eq(chats.receiverId, receiverId), eq(chats.chatId, chatId), eq(chats.threadId, topic),
          eq(chats.campaignId, actor.campaignId))).limit(1);
        const groupOwner = group ? await identity(db, group.owner) : null;
        if (!groupOwner || groupOwner.role !== "GM" || groupOwner.campaignId !== actor.campaignId) return reply.code(204).send();
      }
      sessionId = actor.sessionId;
    }
    const hash = hashToken(JSON.stringify(canonical(message)));
    const payload: Record<string, unknown> = { privateChat,
      text: bug ? "/bug" : ["link", "whoami", "where", "help", "start"].includes(command!.name) ? `/${command!.name}` : text,
      ...(command?.name === "link" ? { linkHash: hashToken(command.argument) } : {}),
    };
    const result = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"telegram-inbox:" + receiverId}, 0))`);
      const [old] = await tx.select({ hash: updates.payloadHash }).from(updates).where(and(
        eq(updates.receiverId, receiverId), or(eq(updates.updateId, String(update.update_id)), and(
          eq(updates.chatId, chatId), eq(updates.threadId, topic), eq(updates.messageId, String(message.message_id)))))).limit(1);
      if (old) return old.hash === hash ? "DUPLICATE" : "COLLISION";
      const [queued] = await tx.select({ count: count() }).from(updates).where(and(
        eq(updates.receiverId, receiverId), or(inArray(updates.state, ["PENDING", "RUNNING"]),
          inArray(updates.replyState, ["PENDING", "SENDING"]))));
      if ((queued?.count ?? 0) >= 1000) return "CAPACITY";
      const [stored] = await tx.insert(updates).values({ receiverId, updateId: String(update.update_id),
        messageId: String(message.message_id), sessionId, payloadHash: hash, payload,
        telegramUserId, chatId, threadId: topic }).onConflictDoNothing().returning({ id: updates.id });
      return stored ? "PERSISTED" : "COLLISION";
    });
    if (result === "COLLISION") return reply.code(409).send({ error: "UPDATE_COLLISION" });
    if (result === "CAPACITY") return reply.code(503).send({ error: "QUEUE_CAPACITY" });
    wake();
    return { accepted: true };
  });
  return stopWorker;
}
