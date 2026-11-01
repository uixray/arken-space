#!/usr/bin/env node
// Read-only operator report. Heartbeat totals overlap minute samples: NEVER sum both.
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

export function summarizePerformance(records, now = Date.now()) {
  const sessions = new Map();
  let legacyWindows = 0;
  for (const record of records) {
    const context = record.context;
    if (!context?.sessionId) {
      legacyWindows++;
      continue;
    }
    const session = sessions.get(context.sessionId) ?? {
      heartbeats: [],
      windows: [],
    };
    if (record.event === "client.performance.heartbeat")
      session.heartbeats.push(record);
    else if (record.event === "client.performance")
      session.windows.push(record);
    sessions.set(context.sessionId, session);
  }
  return {
    generatedAt: new Date(now).toISOString(),
    legacyWindows,
    sessions: [...sessions].map(([sessionId, session]) => {
      session.heartbeats.sort(
        (a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt),
      );
      const latest = session.heartbeats.at(-1);
      const context = latest?.context;
      const ageMs = latest ? now - Date.parse(latest.receivedAt) : null;
      const fresh = ageMs !== null && ageMs >= 0 && ageMs <= 10 * 60_000;
      const supported =
        context?.longTaskObserver === "active" &&
        context?.interactionObserver === "active";
      const delayed =
        (context?.blockingMs ?? 0) >= 200 ||
        (context?.slowInteractions ?? 0) > 0 ||
        session.windows.some(
          (record) => Date.parse(record.receivedAt) >= now - 10 * 60_000,
        );
      const state = !fresh
        ? "no-recent-heartbeat"
        : !supported
          ? "collecting-limited-observers"
          : delayed
            ? "collecting-measured-delays"
            : (context?.windowMs ?? 0) > 0
              ? "collecting-no-measured-delays"
              : "collecting-insufficient-window";
      const gaps = session.heartbeats.some(
        (record, index, all) =>
          index > 0 &&
          record.context.sequence > all[index - 1].context.sequence + 1,
      );
      return {
        sessionId,
        state,
        lastHeartbeat: latest?.receivedAt ?? null,
        ageMs,
        clientRevision: context?.clientRevision ?? "unknown",
        serverRevision: latest?.serverRevision ?? null,
        longTaskObserver: context?.longTaskObserver ?? "unknown",
        interactionObserver: context?.interactionObserver ?? "unknown",
        observedWindowMs: context?.windowMs ?? 0,
        lastHeartbeatMeasurements: context
          ? {
              longTasks: context.longTasks,
              blockingMs: context.blockingMs,
              longestTaskMs: context.longestTaskMs,
              interactions: context.interactions,
              slowInteractions: context.slowInteractions,
              slowestInteractionMs: context.slowestInteractionMs,
            }
          : null,
        notableWindowRecords: session.windows.length,
        heartbeatSequenceGaps: gaps,
        reportedSendFailures: context?.sendFailures ?? 0,
      };
    }),
    note: "No recent heartbeat can mean closed/hidden/logged-out client or failed delivery. No sessions is no data, not a healthy game. Measurements cover supported observers only; visible idle tabs also heartbeat.",
  };
}

export async function readPerformanceJournal(directory, since) {
  const records = [];
  let malformedLines = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !/^performance-\d{13}-[0-9a-f-]{36}\.jsonl$/.test(entry.name)
    )
      continue;
    const input = createReadStream(join(directory, entry.name));
    const lines = createInterface({ input, crlfDelay: Infinity });
    // Forward stream errors rather than allowing an unhandled error on input.
    input.on("error", (error) => lines.emit("error", error));
    try {
      for await (const line of lines) {
        try {
          if (line.length > 8192) throw new Error("Oversize");
          const record = JSON.parse(line);
          if (
            record.schema !== 1 ||
            !["client.performance", "client.performance.heartbeat"].includes(
              record.event,
            ) ||
            !Number.isFinite(Date.parse(record.receivedAt)) ||
            !record.context
          )
            throw new Error("Invalid record");
          if (Date.parse(record.receivedAt) >= since) records.push(record);
        } catch {
          malformedLines++;
        }
      }
    } finally {
      lines.close();
      input.destroy();
    }
  }
  return { records, malformedLines };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [directory, hours = "24"] = process.argv.slice(2);
  if (
    !directory ||
    !Number.isFinite(Number(hours)) ||
    Number(hours) <= 0 ||
    Number(hours) > 336
  ) {
    console.error(
      "Usage: node scripts/report-client-performance.mjs <journal-directory> [hours: 1..336]",
    );
    process.exitCode = 2;
  } else {
    try {
      const now = Date.now();
      const { records, malformedLines } = await readPerformanceJournal(
        directory,
        now - Number(hours) * 3_600_000,
      );
      console.log(
        JSON.stringify(
          { ...summarizePerformance(records, now), malformedLines },
          null,
          2,
        ),
      );
    } catch {
      console.error(
        "Performance journal unreadable; collection status unknown.",
      );
      process.exitCode = 2;
    }
  }
}
