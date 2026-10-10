import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installGracefulShutdown } from "./graceful-shutdown.js";

function setup(timeoutMs = 100) {
  const signals = new EventEmitter();
  const exit = vi.fn();
  const logger = { info: vi.fn(), error: vi.fn() };
  const processLike = Object.assign(signals, { exit }) as unknown as NodeJS.Process & {
    exit: (code: number) => void;
  };
  const shutdown = installGracefulShutdown(
    vi.fn().mockResolvedValue(undefined),
    logger,
    processLike,
    timeoutMs,
  );
  return { signals, exit, logger, shutdown };
}

afterEach(() => vi.useRealTimers());

describe("installGracefulShutdown", () => {
  it("closes once and exits successfully for repeated termination signals", async () => {
    const signals = new EventEmitter();
    const exit = vi.fn();
    let resolveClose!: () => void;
    const close = vi.fn(
      () => new Promise<void>((resolve) => { resolveClose = resolve; }),
    );
    const logger = { info: vi.fn(), error: vi.fn() };
    const proc = Object.assign(signals, { exit }) as unknown as NodeJS.Process & {
      exit: (code: number) => void;
    };
    const installed = installGracefulShutdown(close, logger, proc, 100);

    signals.emit("SIGTERM");
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    resolveClose();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { signal: "SIGTERM" },
      "server.shutdown_complete",
    );
    installed.dispose();
  });

  it("fails closed with exit 1 but does not log driver rejection details", async () => {
    const { signals, exit, logger, shutdown } = setup();
    const close = vi.fn().mockRejectedValue(new Error("sensitive connection string"));
    shutdown.dispose();
    const proc = Object.assign(signals, { exit }) as unknown as NodeJS.Process & {
      exit: (code: number) => void;
    };
    const installed = installGracefulShutdown(close, logger, proc, 100);
    signals.emit("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("sensitive connection string");
    installed.dispose();
  });

  it("uses a finite deadline and exits nonzero when close hangs", async () => {
    vi.useFakeTimers();
    const signals = new EventEmitter();
    const exit = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };
    const proc = Object.assign(signals, { exit }) as unknown as NodeJS.Process & {
      exit: (code: number) => void;
    };
    const installed = installGracefulShutdown(() => new Promise(() => {}), logger, proc, 25);
    signals.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(25);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      { signal: "SIGTERM", timeoutMs: 25 },
      "server.shutdown_timeout",
    );
    installed.dispose();
  });
});
