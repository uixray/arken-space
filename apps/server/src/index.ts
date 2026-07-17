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
import { createDatabase } from "@arken/db";
import { env } from "./env.js";
import { registerRealtime } from "./realtime.js";
import { registerRoutes } from "./routes.js";
import { ensureSeed } from "./seed.js";
import { requestActionId } from "./telemetry.js";

const app = Fastify({
  logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
  trustProxy: true,
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

const { client, db } = createDatabase(env.DATABASE_URL);
await ensureSeed(db);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
  cors: { origin: env.WEB_ORIGIN, credentials: true },
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: false,
  },
});

registerRealtime(io, db, app.log);
registerRoutes(app, db, io);

app.addHook("onClose", async () => {
  io.close();
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
  const details = {
    err: problem,
    requestId: request.id,
    actionId: requestActionId(request.headers["x-action-id"]),
    statusCode,
  };
  if (statusCode >= 500)
    request.log.error(details, "request.unexpected_failure");
  else request.log.warn(details, "request.rejected");
  if (isValidationError)
    return reply.code(400).send({
      error: "VALIDATION_ERROR",
      message:
        env.NODE_ENV === "production"
          ? "Некорректные данные запроса"
          : problem.message,
    });
  return reply.code(statusCode).send({
    error: "REQUEST_FAILED",
    message:
      env.NODE_ENV === "production"
        ? "Не удалось выполнить запрос"
        : problem.message,
  });
});

await app.listen({ host: "0.0.0.0", port: env.PORT });
