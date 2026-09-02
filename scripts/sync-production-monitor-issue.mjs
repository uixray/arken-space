/* global fetch */
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import {
  buildMonitorTransition,
  formatMonitorIssueBody,
  formatTransitionMessage,
  MONITOR_ISSUE_TITLE,
  MONITOR_LABEL,
  monitorEventId,
  normalizeMention,
  parseMonitorState,
} from "./production-monitor-core.mjs";

function validateRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value ?? ""))
    throw new Error("GITHUB_REPOSITORY must have owner/repository format");
  return value;
}

function validateApiUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error("GITHUB_API_URL must use HTTPS");
  return url.toString().replace(/\/$/, "");
}

async function githubRequest(
  fetchImpl,
  url,
  token,
  { method = "GET", body, allowStatuses = [] } = {},
) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "arken-space-production-monitor",
      "x-github-api-version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (allowStatuses.includes(response.status))
    return { status: response.status, body: null };
  if (!response.ok)
    throw new Error(`GitHub API ${method} failed with HTTP ${response.status}`);
  if (response.status === 204) return { status: response.status, body: null };
  return { status: response.status, body: await response.json() };
}

function notificationFor(event, mention, runUrl) {
  if (!event) return null;
  const body = formatTransitionMessage(event, mention, runUrl);
  return {
    id: monitorEventId(event),
    bodyBase64: Buffer.from(body, "utf8").toString("base64url"),
  };
}

async function persistState(
  fetchImpl,
  repositoryApi,
  token,
  issueNumber,
  state,
) {
  await githubRequest(
    fetchImpl,
    `${repositoryApi}/issues/${issueNumber}`,
    token,
    {
      method: "PATCH",
      body: { body: formatMonitorIssueBody(state), state: "open" },
    },
  );
}

async function notificationExists(
  fetchImpl,
  repositoryApi,
  token,
  issueNumber,
  notificationId,
) {
  const marker = `<!-- arken-production-monitor-event:${notificationId} -->`;
  for (let page = 1; page <= 100; page += 1) {
    const comments = await githubRequest(
      fetchImpl,
      `${repositoryApi}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(comments.body))
      throw new Error("GitHub comments response is invalid");
    if (comments.body.some((comment) => comment.body?.includes(marker)))
      return true;
    if (comments.body.length < 100) return false;
  }
  throw new Error("Production monitor comment history is unexpectedly large");
}

async function flushPendingNotification(
  fetchImpl,
  repositoryApi,
  token,
  issueNumber,
  state,
) {
  const pending = state.pendingNotification;
  if (!pending) return state;
  const pendingBody = Buffer.from(pending.bodyBase64, "base64url").toString(
    "utf8",
  );
  if (
    !pendingBody.includes(
      `<!-- arken-production-monitor-event:${pending.id} -->`,
    )
  )
    throw new Error("Pending monitor notification marker is invalid");
  const delivered = await notificationExists(
    fetchImpl,
    repositoryApi,
    token,
    issueNumber,
    pending.id,
  );
  if (!delivered)
    await githubRequest(
      fetchImpl,
      `${repositoryApi}/issues/${issueNumber}/comments`,
      token,
      {
        method: "POST",
        body: { body: pendingBody },
      },
    );
  const cleared = { ...state, pendingNotification: null };
  await persistState(fetchImpl, repositoryApi, token, issueNumber, cleared);
  return cleared;
}

export async function syncProductionMonitorIssue({
  result,
  repository,
  token,
  apiUrl = "https://api.github.com",
  mention,
  runUrl,
  fetchImpl = fetch,
}) {
  const validatedRepository = validateRepository(repository);
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const normalizedApiUrl = validateApiUrl(apiUrl);
  const [owner, repositoryName] = validatedRepository.split("/");
  const repositoryApi = `${normalizedApiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}`;
  const normalizedMention = normalizeMention(mention, owner);

  const labelLookup = await githubRequest(
    fetchImpl,
    `${repositoryApi}/labels/${encodeURIComponent(MONITOR_LABEL)}`,
    token,
    { allowStatuses: [404] },
  );
  if (labelLookup.status === 404)
    await githubRequest(fetchImpl, `${repositoryApi}/labels`, token, {
      method: "POST",
      body: {
        name: MONITOR_LABEL,
        color: "b60205",
        description: "Автоматические оповещения production health",
      },
    });

  const listed = await githubRequest(
    fetchImpl,
    `${repositoryApi}/issues?state=all&labels=${encodeURIComponent(MONITOR_LABEL)}&per_page=100`,
    token,
  );
  const matchingIssues = listed.body.filter(
    (issue) =>
      issue.title === MONITOR_ISSUE_TITLE &&
      !Object.prototype.hasOwnProperty.call(issue, "pull_request"),
  );
  if (matchingIssues.length > 1)
    throw new Error("More than one production monitor state issue exists");

  const issue = matchingIssues[0];
  if (!issue) {
    const transition = buildMonitorTransition(null, result);
    const pendingNotification = notificationFor(
      transition.event,
      normalizedMention,
      runUrl,
    );
    const initialState = { ...transition.next, pendingNotification };
    const created = await githubRequest(
      fetchImpl,
      `${repositoryApi}/issues`,
      token,
      {
        method: "POST",
        body: {
          title: MONITOR_ISSUE_TITLE,
          body: formatMonitorIssueBody(initialState),
          labels: [MONITOR_LABEL],
        },
      },
    );
    if (pendingNotification)
      await flushPendingNotification(
        fetchImpl,
        repositoryApi,
        token,
        created.body.number,
        initialState,
      );
    return { action: "created", issueNumber: created.body.number };
  }

  let previous = parseMonitorState(issue.body);
  if (!previous)
    throw new Error("Existing production monitor issue has no state metadata");
  if (previous.pendingNotification)
    previous = await flushPendingNotification(
      fetchImpl,
      repositoryApi,
      token,
      issue.number,
      previous,
    );
  const transition = buildMonitorTransition(previous, result);
  const pendingNotification = notificationFor(
    transition.event,
    normalizedMention,
    runUrl,
  );
  if (pendingNotification) {
    const pendingState = { ...transition.next, pendingNotification };
    await persistState(
      fetchImpl,
      repositoryApi,
      token,
      issue.number,
      pendingState,
    );
    await flushPendingNotification(
      fetchImpl,
      repositoryApi,
      token,
      issue.number,
      pendingState,
    );
  } else if (transition.stateChanged || issue.state !== "open")
    await persistState(
      fetchImpl,
      repositoryApi,
      token,
      issue.number,
      transition.next,
    );
  return {
    action: pendingNotification
      ? transition.event.type
      : transition.stateChanged || issue.state !== "open"
        ? "updated"
        : "unchanged",
    issueNumber: issue.number,
  };
}

export async function runProductionMonitorIssueSync({
  environment = process.env,
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  const resultPath = environment.ARKEN_MONITOR_RESULT_PATH;
  if (!resultPath) throw new Error("ARKEN_MONITOR_RESULT_PATH is required");
  let result;
  try {
    result = JSON.parse(readFileSync(resultPath, "utf8"));
  } catch {
    result = {
      ok: false,
      checkedAt: new Date(now()).toISOString(),
      reason: "MONITOR_EXECUTION_ERROR",
      summary: "Health checker did not produce a readable result",
      health: null,
    };
  }
  return syncProductionMonitorIssue({
    result,
    repository: environment.GITHUB_REPOSITORY,
    token: environment.GITHUB_TOKEN,
    apiUrl: environment.GITHUB_API_URL,
    mention: environment.ARKEN_MONITOR_MENTION,
    runUrl: environment.ARKEN_MONITOR_RUN_URL,
    fetchImpl,
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const outcome = await runProductionMonitorIssueSync();
  process.stdout.write(
    `GitHub monitor issue #${outcome.issueNumber}: ${outcome.action}\n`,
  );
}
