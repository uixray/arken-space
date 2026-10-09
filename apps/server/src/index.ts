import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";
import { createDatabase, createPgliteDatabase } from "@arken/db";
import { env } from "./env.js";
import { countQuery, SNAPSHOT_METRICS_ENABLED } from "./snapshot-metrics.js";
import { registerRealtime } from "./realtime.js";
import { registerRoutes } from "./routes.js";
import { ensureSeed } from "./seed.js";
import { requestActionId } from "./telemetry.js";
import { isCampaignCanvasGuardError } from "./campaign-pause-guard.js";
import { accountErrorLogDetails } from "./account-error-logging.js";
import { installGracefulShutdown } from "./graceful-shutdown.js";
import { createAccountMailRuntime } from "./account-mail-runtime.js";
import { createAccountMailContext } from "./account-mail-context.js";

// Validate transport/key configuration before opening the database connection.
const accountMailContext = createAccountMailContext(env);

const app = Fastify({
  logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
  // Never trust forwarded headers by default. Public auth rate limits use the
  // direct TCP peer; proxy trust needs an explicit peer allow-list first.
  bodyLimit: env.MAX_AUDIO_BYTES + 1024,
});

await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
await app.register(cookie);
await app.register(multipart, {
  attachFieldsToBody: false,
  limits: { files: 2 },
});
await app.register(rateLimit, {
  max: env.RATE_LIMIT_MAX,
  timeWindow: "1 minute",
});

app.addHook("onRequest", async (request, reply) => {
  reply.header("x-request-id", request.id);
  const actionId = requestActionId(request.headers["x-action-id"]);
  if (actionId) request.log = request.log.child({ actionId });
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.origin;
  if (origin && origin !== env.WEB_ORIGIN)
    return reply.code(403).send({ error: "ORIGIN_FORBIDDEN" });
});

let client: { end: () => Promise<void> };
let db: Parameters<typeof registerRoutes>[1];

if (env.DEV_DATABASE_DRIVER === "pglite") {
  const result = await createPgliteDatabase();
  client = result.client;
  db = result.db as Parameters<typeof registerRoutes>[1];
  app.log.info("database.pglite_connected");
} else {
  const result = createDatabase(
    env.DATABASE_URL,
    // UIX-408/409, этап 0. При выключенной оснастке хук не передаётся вовсе.
    SNAPSHOT_METRICS_ENABLED ? countQuery : undefined,
  );
  try {
    await result.client`SELECT 1`;
  } catch {
    await result.client.end().catch(() => undefined);
    throw new Error("Не удалось подключиться к PostgreSQL при запуске сервера");
  }
  client = result.client;
  db = result.db as Parameters<typeof registerRoutes>[1];
  app.log.info("database.postgres_connected");
}

if (!env.ACCOUNT_AUTH_ENABLED) {
  try {
    await ensureSeed(db);
  } catch {
    await client.end().catch(() => undefined);
    throw new Error("Не удалось подготовить базу данных при запуске сервера");
  }
}

const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
  cors: { origin: env.WEB_ORIGIN, credentials: true },
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: false,
  },
  allowRequest: (request, callback) => {
    callback(null, request.headers.origin === env.WEB_ORIGIN);
  },
});

const accountMailRuntime = createAccountMailRuntime({
  enabled: accountMailContext.runtimeEnabled,
  db,
  keyring: accountMailContext.keyring,
  adapter: accountMailContext.adapter,
  workerId: `server-${process.pid}`,
  logger: app.log,
});

registerRealtime(io, db, app.log);
registerRoutes(app, db, io, accountMailContext);

app.addHook("onClose", async () => {
  await accountMailRuntime.stop();
  await io.close();
  await client.end();
});

app.setErrorHandler((error, request, reply) => {
  const problem = error as Error & {
    validation?: unknown;
    statusCode?: number;
  };
  const isValidationError =
    Boolean(problem.validation) || problem.name === "ZodError";
  const statusCode = isValidationError ? 400 : (problem.statusCode ?? 500);
  const sensitiveAccountRoute = request.url.startsWith("/api/account/") || request.url.startsWith("/api/auth/");
  const details = {
    ...(sensitiveAccountRoute ? accountErrorLogDetails({ requestId: request.id, actionId: requestActionId(request.headers["x-action-id"]), statusCode, validation: isValidationError }) : { err: problem }),
    requestId: request.id,
    actionId: requestActionId(request.headers["x-action-id"]),
    statusCode,
  };
  if (statusCode >= 500)
    request.log.error(details, "request.unexpected_failure");
  else request.log.warn(details, "request.rejected");
  if (isCampaignCanvasGuardError(error))
    return reply.code(error.statusCode).send({ error: error.code });
  if (isValidationError)
    return reply.code(400).send({
      error: "VALIDATION_ERROR",
      message: sensitiveAccountRoute ? "Не удалось выполнить запрос" :
        env.NODE_ENV === "production"
          ? "Некорректные данные запроса"
          : problem.message,
    });
  return reply.code(statusCode).send({
    error: "REQUEST_FAILED",
    message: sensitiveAccountRoute ? "Не удалось выполнить запрос" :
      env.NODE_ENV === "production"
        ? "Не удалось выполнить запрос"
        : problem.message,
  });
});

installGracefulShutdown(() => app.close(), app.log);
await app.listen({ host: "0.0.0.0", port: env.PORT });
// Start only after the listener is live. Default runtime/SMTP config is off.
accountMailRuntime.start();
