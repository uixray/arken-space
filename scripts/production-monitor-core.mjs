/* global AbortController, fetch */
import { createHash } from "node:crypto";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";

export const DEFAULT_PRODUCTION_HEALTH_URL = "https://arken-khar.space/healthz";
export const DEFAULT_HEALTH_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_CLOCK_SKEW_MS = 10 * 60 * 1_000;
export const MONITOR_ISSUE_TITLE = "[monitor] Состояние production";
export const MONITOR_LABEL = "production-monitor";

const stateMarkerPattern =
  /<!-- arken-production-monitor-state:(\{[^\r\n]*\}) -->/;
const productionRevisionPattern = /^[0-9a-f]{40}$/;

function safeIsoTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function failureResult(checkedAt, reason, summary, extra = {}) {
  return {
    ok: false,
    checkedAt,
    reason,
    summary,
    health: null,
    ...extra,
  };
}

export function validateHealthUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Health URL must be a valid absolute URL");
  }
  if (url.protocol !== "https:")
    throw new Error("Production health URL must use HTTPS");
  if (url.username || url.password)
    throw new Error("Production health URL must not contain credentials");
  if (url.pathname !== "/healthz" || url.search || url.hash)
    throw new Error("Production health URL must point exactly to /healthz");
  return url.toString();
}

export function inspectHealthPayload(
  payload,
  {
    checkedAt = new Date().toISOString(),
    maxClockSkewMs = DEFAULT_MAX_CLOCK_SKEW_MS,
  } = {},
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return failureResult(
      checkedAt,
      "INVALID_JSON_CONTRACT",
      "Health response is not a JSON object",
    );

  if (payload.status !== "ok" || payload.database !== "ok")
    return failureResult(
      checkedAt,
      "UNHEALTHY_STATUS",
      "Health response does not report status=ok and database=ok",
    );

  if (
    typeof payload.buildRevision !== "string" ||
    !productionRevisionPattern.test(payload.buildRevision)
  )
    return failureResult(
      checkedAt,
      "INVALID_BUILD_REVISION",
      "Health response does not contain a full production commit revision",
    );

  if (!Number.isInteger(payload.schemaVersion) || payload.schemaVersion <= 0)
    return failureResult(
      checkedAt,
      "INVALID_SCHEMA_VERSION",
      "Health response does not contain a positive schema version",
    );

  const serverTime = safeIsoTime(payload.time);
  const checkedAtMs = Date.parse(checkedAt);
  if (
    !serverTime ||
    !Number.isFinite(maxClockSkewMs) ||
    maxClockSkewMs <= 0 ||
    Math.abs(checkedAtMs - Date.parse(serverTime)) > maxClockSkewMs
  )
    return failureResult(
      checkedAt,
      "STALE_SERVER_TIME",
      "Health response time is missing or outside the allowed clock skew",
    );

  return {
    ok: true,
    checkedAt,
    reason: null,
    summary: "Production health contract is valid",
    health: {
      buildRevision: payload.buildRevision,
      schemaVersion: payload.schemaVersion,
      serverTime,
    },
  };
}

export async function checkProductionHealth({
  healthUrl = DEFAULT_PRODUCTION_HEALTH_URL,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  maxClockSkewMs = DEFAULT_MAX_CLOCK_SKEW_MS,
  now = () => Date.now(),
} = {}) {
  const checkedAt = new Date(now()).toISOString();
  let normalizedUrl;
  try {
    normalizedUrl = validateHealthUrl(healthUrl);
  } catch (error) {
    return failureResult(
      checkedAt,
      "INVALID_CONFIGURATION",
      error instanceof Error ? error.message : "Invalid monitor configuration",
    );
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
    return failureResult(
      checkedAt,
      "INVALID_CONFIGURATION",
      "Health timeout must be a positive integer",
    );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(normalizedUrl, {
      cache: "no-store",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status !== 200)
      return failureResult(
        checkedAt,
        "HTTP_ERROR",
        `Production health returned HTTP ${response.status}`,
        { httpStatus: response.status },
      );

    let payload;
    try {
      payload = await response.json();
    } catch {
      return failureResult(
        checkedAt,
        "INVALID_JSON",
        "Production health did not return valid JSON",
      );
    }
    return inspectHealthPayload(payload, { checkedAt, maxClockSkewMs });
  } catch {
    const timedOut = controller.signal.aborted;
    return failureResult(
      checkedAt,
      timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      timedOut
        ? `Production health exceeded ${timeoutMs} ms`
        : "Production health request failed",
    );
  } finally {
    clearTimeout(timer);
  }
}

function validStoredState(value) {
  return (
    value &&
    value.version === 1 &&
    (value.status === "healthy" || value.status === "unhealthy") &&
    typeof value.changedAt === "string" &&
    (value.buildRevision === null ||
      productionRevisionPattern.test(value.buildRevision)) &&
    (value.schemaVersion === null ||
      (Number.isInteger(value.schemaVersion) && value.schemaVersion > 0)) &&
    (value.failureReason === null || typeof value.failureReason === "string") &&
    (value.pendingNotification === null ||
      (value.pendingNotification &&
        /^[0-9a-f]{24}$/.test(value.pendingNotification.id) &&
        typeof value.pendingNotification.bodyBase64 === "string" &&
        /^[A-Za-z0-9_-]+$/.test(value.pendingNotification.bodyBase64) &&
        value.pendingNotification.bodyBase64.length <= 12_000))
  );
}

export function parseMonitorState(issueBody) {
  const match = issueBody?.match(stateMarkerPattern);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    if (!validStoredState(value)) throw new Error("Invalid monitor state");
    return value;
  } catch {
    throw new Error("GitHub monitor issue contains invalid state metadata");
  }
}

export function buildMonitorTransition(previous, result) {
  if (!result || typeof result.ok !== "boolean")
    throw new Error("Monitor result is invalid");
  if (previous?.pendingNotification)
    throw new Error("Pending notification must be delivered first");

  const status = result.ok ? "healthy" : "unhealthy";
  const next = {
    version: 1,
    status,
    buildRevision: result.ok
      ? result.health.buildRevision
      : (previous?.buildRevision ?? null),
    schemaVersion: result.ok
      ? result.health.schemaVersion
      : (previous?.schemaVersion ?? null),
    failureReason: result.ok ? null : result.reason,
    changedAt: result.checkedAt,
    pendingNotification: null,
  };

  let event = null;
  if (!previous) {
    if (!result.ok) event = { type: "outage", result, previous: null };
  } else if (previous.status === "healthy" && status === "unhealthy") {
    event = { type: "outage", result, previous };
  } else if (previous.status === "unhealthy" && status === "healthy") {
    event = { type: "recovery", result, previous };
  } else if (
    status === "healthy" &&
    (previous.buildRevision !== next.buildRevision ||
      previous.schemaVersion !== next.schemaVersion)
  ) {
    event = { type: "identity-change", result, previous };
  }

  const stateChanged =
    !previous ||
    previous.status !== next.status ||
    previous.buildRevision !== next.buildRevision ||
    previous.schemaVersion !== next.schemaVersion ||
    previous.failureReason !== next.failureReason;

  if (!stateChanged) next.changedAt = previous.changedAt;
  return { next, event, stateChanged };
}

export function normalizeMention(value, repositoryOwner) {
  const candidate = value?.trim() || `@${repositoryOwner}`;
  const normalized = candidate.startsWith("@") ? candidate : `@${candidate}`;
  if (
    !/^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))?$/.test(
      normalized,
    )
  )
    throw new Error("Monitor mention must be a GitHub user or team mention");
  return normalized;
}

export function formatMonitorIssueBody(state) {
  if (!validStoredState(state)) throw new Error("Monitor state is invalid");
  const status = state.status === "healthy" ? "работает" : "недоступен";
  const revision = state.buildRevision
    ? `\`${state.buildRevision}\``
    : "ещё не наблюдалась";
  const schema = state.schemaVersion ?? "ещё не наблюдалась";
  const failure = state.failureReason
    ? `\n- Последняя причина: \`${state.failureReason}\``
    : "";
  const pending = state.pendingNotification
    ? "\n- Уведомление: **ожидает доставки**"
    : "";
  return `# Внешний мониторинг Arken Space

Этот issue обновляет GitHub Actions workflow. Не редактируйте служебный маркер
внизу: он нужен для дедупликации уведомлений.

- Состояние: **${status}**
- Последняя известная ревизия: ${revision}
- Последняя известная схема: ${schema}
- Состояние изменилось: ${state.changedAt}${failure}${pending}

История падений, восстановлений и смен identity находится в комментариях.

<!-- arken-production-monitor-state:${JSON.stringify(state)} -->
`;
}

export function formatTransitionMessage(event, mention, runUrl) {
  if (!event) return null;
  const run = runUrl ? `\n\n[Открыть проверку](${runUrl})` : "";
  const marker = `\n\n<!-- arken-production-monitor-event:${monitorEventId(event)} -->`;
  if (event.type === "outage")
    return `${mention} production health недоступен: **${event.result.reason}** — ${event.result.summary}.${run}${marker}`;
  if (event.type === "recovery")
    return `${mention} production снова отвечает. Ревизия \`${event.result.health.buildRevision}\`, схема \`${event.result.health.schemaVersion}\`.${run}${marker}`;
  if (event.type === "identity-change")
    return `${mention} identity production изменилась без потери health:\n\n- ревизия: \`${event.previous.buildRevision}\` → \`${event.result.health.buildRevision}\`;\n- схема: \`${event.previous.schemaVersion}\` → \`${event.result.health.schemaVersion}\`.${run}${marker}`;
  throw new Error("Unknown monitor transition");
}

export function monitorEventId(event) {
  if (!event) throw new Error("Monitor event is required");
  let identity;
  if (event.type === "outage")
    identity = `outage:${event.previous?.changedAt ?? event.result.checkedAt}`;
  else if (event.type === "recovery")
    identity = `recovery:${event.previous.changedAt}:${event.result.health.buildRevision}:${event.result.health.schemaVersion}`;
  else if (event.type === "identity-change")
    identity = `identity:${event.previous.changedAt}:${event.previous.buildRevision}:${event.previous.schemaVersion}:${event.result.health.buildRevision}:${event.result.health.schemaVersion}`;
  else throw new Error("Unknown monitor transition");
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}
