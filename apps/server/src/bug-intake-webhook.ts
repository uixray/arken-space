import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { persistTelegramBugUpdate } from "./bug-intake-inbox.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** Dormant registration function, intentionally not called by application startup.
 * Owner activation must first verify bot ownership/use, TLS, header redaction,
 * receiver identity/chat binding and migrations. Never calls setWebhook. */
export function registerTelegramBugWebhook(
  app: FastifyInstance,
  db: Database,
  config: {
    receiverId: string;
    allowedChatId: string;
    secret: string;
  },
) {
  z.string().uuid().parse(config.receiverId);
  if (!/^-?[1-9][0-9]*$/.test(config.allowedChatId))
    throw new Error("CHAT_ALLOWLIST_REQUIRED");
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(config.secret))
    throw new Error("INVALID_WEBHOOK_SECRET");
  const expected = createHash("sha256").update(config.secret).digest();
  app.post(
    "/api/integrations/telegram/bugs",
    {
      bodyLimit: 256 * 1024,
      logLevel: "silent",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      onRequest: async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const header = request.headers["x-telegram-bot-api-secret-token"];
        if (
          typeof header !== "string" ||
          header.length > 256 ||
          !timingSafeEqual(
            createHash("sha256").update(header).digest(),
            expected,
          )
        )
          return reply.code(401).send({ error: "UNAUTHORIZED" });
      },
    },
    async (request, reply) => {
      if (
        !request.headers["content-type"]
          ?.toLowerCase()
          .startsWith("application/json")
      )
        return reply.code(415).send({ error: "JSON_REQUIRED" });
      try {
        const receipt = await persistTelegramBugUpdate(
          db,
          config.receiverId,
          config.allowedChatId,
          JSON.stringify(request.body),
        );
        if (receipt.status === "COLLISION_CAPACITY_EXCEEDED")
          return reply.code(503).send({ error: "INBOX_REQUIRES_ATTENTION" });
        if (
          receipt.status === "OTHER_CHAT" ||
          receipt.status === "UNSUPPORTED_UPDATE"
        )
          return reply.code(204).send(); // out-of-scope update; no content retained
        // Persisted does not mean normalized, files downloaded or sent to Linear.
        // A worker drains the durable inbox independently; no detached promise here.
        return reply.code(200).send({ accepted: true });
      } catch {
        // No database error payload/parameters, raw Update, headers or token logged.
        // Non-2xx tells Telegram not to treat failed persistence as successful intake.
        return reply.code(503).send({ error: "INBOX_NOT_ACCEPTED" });
      }
    },
  );
}
