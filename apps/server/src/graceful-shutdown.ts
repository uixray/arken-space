import type { FastifyBaseLogger } from "fastify";

type Signal = "SIGINT" | "SIGTERM";
type SignalProcess = Pick<NodeJS.Process, "on" | "removeListener"> & {
  exit: (code: number) => void;
};

/**
 * Install one bounded, idempotent Fastify close path for container/process
 * termination. Never log the exception itself: drivers may include connection
 * details in rejection messages.
 */
export function installGracefulShutdown(
  close: () => Promise<unknown>,
  logger: Pick<FastifyBaseLogger, "info" | "error">,
  processLike: SignalProcess = process,
  timeoutMs = 8_000,
) {
  let shutdown: Promise<void> | null = null;

  const handleSignal = (signal: Signal) => {
    if (shutdown) return shutdown;

    logger.info({ signal }, "server.shutdown_started");
    const timeout = setTimeout(() => {
      logger.error({ signal, timeoutMs }, "server.shutdown_timeout");
      processLike.exit(1);
    }, timeoutMs);
    timeout.unref();

    shutdown = Promise.resolve()
      .then(close)
      .then(() => {
        clearTimeout(timeout);
        logger.info({ signal }, "server.shutdown_complete");
        processLike.exit(0);
      })
      .catch(() => {
        clearTimeout(timeout);
        logger.error({ signal }, "server.shutdown_failed");
        processLike.exit(1);
      });
    return shutdown;
  };

  const onTerm = () => void handleSignal("SIGTERM");
  const onInt = () => void handleSignal("SIGINT");
  processLike.on("SIGTERM", onTerm);
  processLike.on("SIGINT", onInt);

  return {
    handleSignal,
    dispose() {
      processLike.removeListener("SIGTERM", onTerm);
      processLike.removeListener("SIGINT", onInt);
    },
  };
}
