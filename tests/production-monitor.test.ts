import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMonitorTransition,
  checkProductionHealth,
  formatTransitionMessage,
  formatMonitorIssueBody,
  inspectHealthPayload,
  monitorEventId,
  parseMonitorState,
} from "../scripts/production-monitor-core.mjs";
import { runProductionHealthMonitor } from "../scripts/run-production-health-monitor.mjs";
import { syncProductionMonitorIssue } from "../scripts/sync-production-monitor-issue.mjs";

const revisionA = "a".repeat(40);
const revisionB = "b".repeat(40);
const checkedAt = "2026-08-31T12:00:00.000Z";

function healthyResult(revision = revisionA, schemaVersion = 2) {
  return {
    ok: true,
    checkedAt,
    reason: null,
    summary: "Production health contract is valid",
    health: {
      buildRevision: revision,
      schemaVersion,
      serverTime: checkedAt,
    },
  };
}

function unhealthyResult(reason = "NETWORK_ERROR") {
  return {
    ok: false,
    checkedAt,
    reason,
    summary: "Production health request failed",
    health: null,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const temporaryDirectories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("production health contract", () => {
  it("accepts the complete fresh production identity", () => {
    expect(
      inspectHealthPayload(
        {
          status: "ok",
          database: "ok",
          buildRevision: revisionA,
          schemaVersion: 2,
          time: checkedAt,
        },
        { checkedAt },
      ),
    ).toEqual(healthyResult());
  });

  it.each([
    [{ status: "ok", database: "unavailable" }, "UNHEALTHY_STATUS"],
    [
      {
        status: "ok",
        database: "ok",
        buildRevision: "short",
        schemaVersion: 2,
        time: checkedAt,
      },
      "INVALID_BUILD_REVISION",
    ],
    [
      {
        status: "ok",
        database: "ok",
        buildRevision: revisionA,
        schemaVersion: 2,
        time: "2026-08-31T11:40:00.000Z",
      },
      "STALE_SERVER_TIME",
    ],
  ])("rejects a broken health invariant", (payload, reason) => {
    expect(inspectHealthPayload(payload, { checkedAt })).toMatchObject({
      ok: false,
      reason,
    });
  });

  it.each([201, 503])(
    "turns HTTP %s into a bounded failure result",
    async (status) => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(status, { secret: "no" }),
      );
      const result = await checkProductionHealth({
        fetchImpl,
        now: () => Date.parse(checkedAt),
      });
      expect(result).toMatchObject({
        ok: false,
        reason: "HTTP_ERROR",
        httpStatus: status,
      });
      expect(result.summary).not.toContain("secret");
    },
  );

  it("fails closed on an invalid or credential-bearing health URL", async () => {
    await expect(
      checkProductionHealth({
        healthUrl: "https://user:secret@arken-khar.space/healthz",
        fetchImpl: vi.fn(),
        now: () => Date.parse(checkedAt),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "INVALID_CONFIGURATION",
      summary: "Production health URL must not contain credentials",
    });
  });

  it("writes a machine-readable result and exits through the returned state", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "arken-monitor-"));
    temporaryDirectories.push(directory);
    const resultPath = path.join(directory, "result.json");
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        status: "ok",
        database: "ok",
        buildRevision: revisionA,
        schemaVersion: 2,
        time: checkedAt,
      }),
    );
    const result = await runProductionHealthMonitor({
      environment: { ARKEN_MONITOR_RESULT_PATH: resultPath },
      fetchImpl,
      now: () => Date.parse(checkedAt),
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(resultPath, "utf8"))).toEqual(result);
  });

  it("returns a failing CLI exit code for an unhealthy result", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "arken-monitor-cli-"));
    temporaryDirectories.push(directory);
    const resultPath = path.join(directory, "result.json");
    const execution = spawnSync(
      process.execPath,
      ["scripts/run-production-health-monitor.mjs"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ARKEN_MONITOR_RESULT_PATH: resultPath,
          ARKEN_MONITOR_HEALTH_URL: "http://invalid.example/healthz",
        },
      },
    );
    expect(execution.status).toBe(1);
    expect(JSON.parse(readFileSync(resultPath, "utf8"))).toMatchObject({
      ok: false,
      reason: "INVALID_CONFIGURATION",
    });
  });
});

describe("production monitor state", () => {
  it("deduplicates repeated outages and reports recovery", () => {
    const initial = buildMonitorTransition(null, healthyResult());
    const outage = buildMonitorTransition(initial.next, unhealthyResult());
    const repeated = buildMonitorTransition(outage.next, unhealthyResult());
    const recovery = buildMonitorTransition(repeated.next, healthyResult());

    expect(initial.event).toBeNull();
    expect(outage.event?.type).toBe("outage");
    expect(monitorEventId(outage.event)).toBe(
      monitorEventId(
        buildMonitorTransition(initial.next, unhealthyResult()).event,
      ),
    );
    expect(repeated).toMatchObject({ event: null, stateChanged: false });
    expect(recovery.event?.type).toBe("recovery");
    expect(
      formatTransitionMessage(recovery.event, "@uixray", undefined),
    ).toContain("production снова отвечает");
  });

  it("reports a healthy revision or schema transition", () => {
    const previous = buildMonitorTransition(null, healthyResult()).next;
    const transition = buildMonitorTransition(
      previous,
      healthyResult(revisionB, 3),
    );
    expect(transition.event).toMatchObject({ type: "identity-change" });
    expect(transition.next).toMatchObject({
      buildRevision: revisionB,
      schemaVersion: 3,
    });
  });

  it("round-trips state only through the service marker", () => {
    const state = buildMonitorTransition(null, healthyResult()).next;
    const body = formatMonitorIssueBody(state);
    expect(parseMonitorState(body)).toEqual(state);
    expect(parseMonitorState("обычный issue без маркера")).toBeNull();
  });
});

describe("GitHub issue alert channel", () => {
  it("creates one state issue on the first healthy run", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url: String(url), method, body });
      if (String(url).includes("/labels/production-monitor"))
        return jsonResponse(200, { name: "production-monitor" });
      if (String(url).includes("/issues?")) return jsonResponse(200, []);
      if (String(url).endsWith("/issues") && method === "POST")
        return jsonResponse(201, { number: 42 });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await expect(
      syncProductionMonitorIssue({
        result: healthyResult(),
        repository: "uixray/arken-space",
        token: "test-token",
        fetchImpl,
      }),
    ).resolves.toEqual({ action: "created", issueNumber: 42 });
    const creation = requests.find(
      (request) => request.method === "POST" && request.url.endsWith("/issues"),
    );
    expect(creation?.body).toMatchObject({
      title: "[monitor] Состояние production",
      labels: ["production-monitor"],
    });
  });

  it("delivers the first unhealthy alert without exposing it in state metadata", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url: String(url), method, body });
      if (String(url).includes("/labels/production-monitor"))
        return jsonResponse(200, { name: "production-monitor" });
      if (String(url).includes("/issues?")) return jsonResponse(200, []);
      if (String(url).endsWith("/issues") && method === "POST")
        return jsonResponse(201, { number: 42 });
      if (String(url).includes("/comments?") && method === "GET")
        return jsonResponse(200, []);
      if (String(url).endsWith("/comments") && method === "POST")
        return jsonResponse(201, { id: 1 });
      if (String(url).endsWith("/issues/42") && method === "PATCH")
        return jsonResponse(200, { number: 42 });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await syncProductionMonitorIssue({
      result: unhealthyResult(),
      repository: "uixray/arken-space",
      token: "test-token",
      fetchImpl,
    });
    const creation = requests.find(
      (request) => request.method === "POST" && request.url.endsWith("/issues"),
    );
    const creationBody = String(
      (creation?.body as { body?: string } | undefined)?.body,
    );
    expect(creationBody).not.toContain("@uixray");
    expect(creationBody).not.toContain("arken-production-monitor-event");
    expect(creationBody.match(/-->/g)).toHaveLength(1);
    const alert = requests.find(
      (request) =>
        request.method === "POST" && request.url.endsWith("/comments"),
    );
    expect(JSON.stringify(alert?.body)).toContain("@uixray");
  });

  it("persists an outage before commenting and then clears pending state", async () => {
    const previous = buildMonitorTransition(null, healthyResult()).next;
    const issue = {
      number: 42,
      title: "[monitor] Состояние production",
      state: "open",
      body: formatMonitorIssueBody(previous),
    };
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url: String(url), method, body });
      if (String(url).includes("/labels/production-monitor"))
        return jsonResponse(200, { name: "production-monitor" });
      if (String(url).includes("/issues?")) return jsonResponse(200, [issue]);
      if (String(url).includes("/comments?") && method === "GET")
        return jsonResponse(200, []);
      if (String(url).endsWith("/comments") && method === "POST")
        return jsonResponse(201, { id: 1 });
      if (String(url).endsWith("/issues/42") && method === "PATCH")
        return jsonResponse(200, { number: 42 });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const result = await syncProductionMonitorIssue({
      result: unhealthyResult(),
      repository: "uixray/arken-space",
      token: "test-token",
      runUrl: "https://github.com/uixray/arken-space/actions/runs/1",
      fetchImpl,
    });
    expect(result.action).toBe("outage");
    const writes = requests.filter((request) => request.method !== "GET");
    expect(writes.map((request) => request.method)).toEqual([
      "PATCH",
      "POST",
      "PATCH",
    ]);
    expect(writes[0].url).toMatch(/\/issues\/42$/);
    expect(writes[1].url).toMatch(/\/issues\/42\/comments$/);
    expect(writes[2].url).toMatch(/\/issues\/42$/);
    expect(JSON.stringify(writes[1].body)).toContain("@uixray");
  });

  it("does not repeat a transition comment after a partial sync failure", async () => {
    const previous = buildMonitorTransition(null, healthyResult()).next;
    const transition = buildMonitorTransition(previous, unhealthyResult());
    if (!transition.event) throw new Error("Expected outage transition");
    const eventBody = formatTransitionMessage(
      transition.event,
      "@uixray",
      undefined,
    );
    const pendingState = {
      ...transition.next,
      pendingNotification: {
        id: monitorEventId(transition.event),
        bodyBase64: Buffer.from(eventBody, "utf8").toString("base64url"),
      },
    };
    const issue = {
      number: 42,
      title: "[monitor] Состояние production",
      state: "open",
      body: formatMonitorIssueBody(pendingState),
    };
    const requests: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ url: String(url), method });
      if (String(url).includes("/labels/production-monitor"))
        return jsonResponse(200, { name: "production-monitor" });
      if (String(url).includes("/issues?")) return jsonResponse(200, [issue]);
      if (
        String(url).includes("/comments?") &&
        String(url).endsWith("page=1") &&
        method === "GET"
      )
        return jsonResponse(
          200,
          Array.from({ length: 100 }, (_, index) => ({
            body: `old event ${index}`,
          })),
        );
      if (
        String(url).includes("/comments?") &&
        String(url).endsWith("page=2") &&
        method === "GET"
      )
        return jsonResponse(200, [
          {
            body: `already sent\n<!-- arken-production-monitor-event:${pendingState.pendingNotification.id} -->`,
          },
        ]);
      if (String(url).endsWith("/issues/42") && method === "PATCH")
        return jsonResponse(200, { number: 42 });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await syncProductionMonitorIssue({
      result: unhealthyResult(),
      repository: "uixray/arken-space",
      token: "test-token",
      fetchImpl,
    });
    expect(
      requests.filter(
        (request) =>
          request.method === "POST" && request.url.includes("/comments"),
      ),
    ).toHaveLength(0);
    expect(
      requests.filter(
        (request) =>
          request.method === "PATCH" && request.url.endsWith("/issues/42"),
      ),
    ).toHaveLength(1);
    expect(
      requests.filter(
        (request) =>
          request.method === "GET" && request.url.includes("/comments?"),
      ),
    ).toHaveLength(2);
  });
});

describe("workflow and operational contract", () => {
  it("runs externally every five minutes and preserves a failed health exit", () => {
    const workflow = readFileSync(
      ".github/workflows/production-monitor.yml",
      "utf8",
    );
    expect(workflow).toContain('cron: "2-59/5 * * * *"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("continue-on-error: true");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain(
      "if: steps.production_health.outcome != 'success'",
    );
    expect(workflow).toContain("https://arken-khar.space/healthz");
  });

  it("requires a pre-game backup without inventing an accepted RPO", () => {
    const deployment = readFileSync("docs/deployment.md", "utf8");
    const operations = readFileSync("docs/operations.md", "utf8");
    expect(deployment).toContain("может достигать 24 часов 15 минут");
    expect(deployment).toMatch(/ещё не\s+принимал этот риск/);
    expect(operations).toContain("Предыгровой бэкап");
    expect(operations).toContain("systemctl start arken-space-backup.service");
    expect(operations).toContain("не проверяет свежесть бэкапа");
  });
});
