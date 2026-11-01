import { describe, expect, it } from "vitest";
import { summarizePerformance } from "../scripts/report-client-performance.mjs";
const now = Date.parse("2026-11-01T12:00:00Z");
const heartbeat = {
  schema: 1,
  receivedAt: new Date(now).toISOString(),
  event: "client.performance.heartbeat",
  serverRevision: "b".repeat(40),
  context: {
    sessionId: "session",
    clientRevision: "a".repeat(40),
    sequence: 1,
    sendFailures: 0,
    longTaskObserver: "active",
    interactionObserver: "active",
    windowMs: 300_000,
    longTasks: 0,
    blockingMs: 0,
    longestTaskMs: 0,
    interactions: 0,
    slowInteractions: 0,
    slowestInteractionMs: 0,
  },
};
describe("operator performance interpretation", () => {
  it("does not present no data or an old heartbeat as healthy", () => {
    expect(summarizePerformance([], now).sessions).toEqual([]);
    expect(
      summarizePerformance([heartbeat], now + 601_000).sessions[0].state,
    ).toBe("no-recent-heartbeat");
  });
  it("distinguishes quiet measurements, delays and unsupported observers", () => {
    expect(summarizePerformance([heartbeat], now).sessions[0].state).toBe(
      "collecting-no-measured-delays",
    );
    const delayed = {
      ...heartbeat,
      context: { ...heartbeat.context, slowInteractions: 1 },
    };
    expect(summarizePerformance([delayed], now).sessions[0].state).toBe(
      "collecting-measured-delays",
    );
    const unsupported = {
      ...heartbeat,
      context: { ...heartbeat.context, longTaskObserver: "unsupported" },
    };
    expect(summarizePerformance([unsupported], now).sessions[0].state).toBe(
      "collecting-limited-observers",
    );
  });
  it("exposes failed sends and gaps and does not add overlapping minute measurements", () => {
    const later = {
      ...heartbeat,
      receivedAt: new Date(now + 300_000).toISOString(),
      context: {
        ...heartbeat.context,
        sequence: 3,
        sendFailures: 1,
        blockingMs: 300,
      },
    };
    const window = {
      ...heartbeat,
      event: "client.performance",
      context: { ...heartbeat.context, blockingMs: 300 },
    };
    const report = summarizePerformance(
      [heartbeat, window, later],
      now + 300_000,
    ).sessions[0];
    expect(report.heartbeatSequenceGaps).toBe(true);
    expect(report.reportedSendFailures).toBe(1);
    expect(report.lastHeartbeatMeasurements.blockingMs).toBe(300);
    expect(report.notableWindowRecords).toBe(1);
  });
});
