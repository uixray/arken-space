import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { openSync, writeSync, closeSync } from "node:fs";
import { setTimeout, clearTimeout } from "node:timers";

// Synchronous writes keep diagnostics durable even if the job is later killed.
// Cancellation gives Playwright time to tear down its webServers before forcing
// its owned group down. Separate webServer groups rely on cooperative cleanup;
// SIGKILL, an unresponsive runner or runner loss remains best-effort.
export async function runLogged(
  command,
  args,
  logPath,
  { gracefulSignal } = {},
) {
  if (gracefulSignal !== undefined && gracefulSignal !== "SIGINT")
    throw new Error("Unsupported graceful cancellation signal");
  const fd = openSync(logPath, "w");
  const child = spawn(command, args, {
    stdio: ["inherit", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let failure;
  let cancellation;
  let killTimer;
  let stopping = false;
  let pendingWrites = 0;
  let closed = false;
  let finish;
  const completion = new Promise((resolve, reject) => {
    finish = (code) => {
      if (!closed || pendingWrites) return;
      if (failure) reject(failure);
      else resolve(cancellation ?? code ?? 1);
    };
  });
  let exitCode;
  const stop = (signal) => {
    if (!child.pid || closed || stopping) return;
    stopping = true;
    if (process.platform === "win32") {
      // Windows child.kill is uncatchable and loses the parent PID before a
      // later tree kill. Terminate the owned tree while that PID still exists.
      const result = spawnSync("taskkill", [
        "/pid",
        String(child.pid),
        "/t",
        "/f",
      ]);
      if (result.error) failure ??= result.error;
      if (result.status !== 0) child.kill(signal);
      return;
    }
    // Playwright listens for SIGINT, not SIGTERM. Its caller opts into the
    // cooperative protocol; the wrapper still reports the original 130/143.
    child.kill(gracefulSignal ?? signal);
    if (!killTimer) {
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") failure ??= error;
        }
      }, 5000);
    }
  };
  const fail = (error) => {
    failure ??= error;
    stop("SIGTERM");
    // A broken tee must still drain the child pipes so close can settle.
    child.stdout.resume();
    child.stderr.resume();
    finish(exitCode);
  };
  const onInterrupt = () => {
    cancellation ??= 130;
    stop("SIGINT");
  };
  const onTerminate = () => {
    cancellation ??= 143;
    stop("SIGTERM");
  };
  const tee = (source, stream, chunk) => {
    if (failure) return;
    try {
      let offset = 0;
      while (offset < chunk.length) {
        const written = writeSync(fd, chunk, offset, chunk.length - offset);
        if (!written) throw new Error("Log write made no progress");
        offset += written;
      }
      pendingWrites++;
      try {
        if (
          !stream.write(chunk, (error) => {
            pendingWrites--;
            if (error) fail(error);
            finish(exitCode);
          })
        ) {
          source.pause();
          stream.once("drain", () => source.resume());
        }
      } catch (error) {
        pendingWrites--;
        throw error;
      }
    } catch (error) {
      fail(error);
    }
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  process.stdout.on("error", fail);
  process.stderr.on("error", fail);
  child.stdout.on("data", (chunk) => tee(child.stdout, process.stdout, chunk));
  child.stderr.on("data", (chunk) => tee(child.stderr, process.stderr, chunk));
  child.stdout.on("error", fail);
  child.stderr.on("error", fail);
  child.on("error", fail);
  child.on("close", (code) => {
    exitCode = code;
    closed = true;
    finish(code);
  });
  try {
    return await completion;
  } finally {
    clearTimeout(killTimer);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    process.stdout.off("error", fail);
    process.stderr.off("error", fail);
    closeSync(fd);
  }
}
