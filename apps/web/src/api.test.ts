import { afterEach, describe, expect, it, vi } from "vitest";

import {
  api,
  ApiError,
  flushClientEventBuffer,
  formatApiError,
  reportClientEvent,
  resetClientEventBufferForTest,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  resetClientEventBufferForTest();
});

describe("api telemetry and correlation", () => {
  it("adds only bounded safe correlation ids to API error messages", () => {
    expect(
      formatApiError(
        new ApiError(409, "CONFLICT", "Conflict", "request-1", "action_2"),
      ),
    ).toBe("Conflict (requestId: request-1, actionId: action_2)");
  });

  it("omits unsafe or oversized correlation ids", () => {
    const formatted = formatApiError(
      new ApiError(
        409,
        "CONFLICT",
        "Conflict",
        "request/private?token=secret",
        `action-${"x".repeat(128)}`,
      ),
    );
    expect(formatted).toBe("Conflict");
    expect(formatted).not.toContain("private");
    expect(formatted).not.toContain("secret");
  });

  it("adds an action id to mutations and exposes correlation on ApiError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "CHARACTER_CONFLICT", message: "Conflict" }),
          {
            status: 409,
            headers: {
              "content-type": "application/json",
              "x-request-id": "request-1",
            },
          },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const failure = (await api("/api/characters/character-secret", {
      method: "PATCH",
      body: JSON.stringify({ private: "must-not-leak" }),
    }).catch((error: unknown) => error)) as ApiError;

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 409,
      code: "CHARACTER_CONFLICT",
      requestId: "request-1",
    });
    const requestHeaders = new Headers(fetchMock.mock.calls[0]![1].headers);
    expect(requestHeaders.get("x-action-id")).toBe(failure.actionId);

    const telemetry = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(telemetry).toMatchObject({
      event: "api.request_failed",
      context: {
        operation: "character.mutate",
        status: 409,
        code: "CHARACTER_CONFLICT",
        requestId: "request-1",
        actionId: failure.actionId,
      },
    });
    expect(JSON.stringify(telemetry)).not.toContain("must-not-leak");
    expect(JSON.stringify(telemetry)).not.toContain("character-secret");
  });

  it("shows actionable resource details for an insufficient-cost response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "INSUFFICIENT_CHARACTER_RESOURCE",
            resource: "magic",
            required: 4,
            available: 1,
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const failure = (await api(
      "/api/characters/character-1/catalog/entry-1/roll",
      {
        method: "POST",
        body: "{}",
      },
    ).catch((error: unknown) => error)) as ApiError;

    expect(failure.code).toBe("INSUFFICIENT_CHARACTER_RESOURCE");
    expect(failure.message).toContain("магической силы");
    expect(failure.message).toContain("Нужно: 4");
    expect(failure.message).toContain("доступно: 1");
  });

  it("preserves a caller action id and does not report non-critical endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "FAILED" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const failure = (await api("/api/chat", {
      method: "POST",
      headers: { "x-action-id": "caller-action" },
      body: "{}",
    }).catch((error: unknown) => error)) as ApiError;

    expect(failure).toMatchObject({ actionId: "caller-action" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/api/dice", "roll.submit"],
    ["/api/assets?kind=MAP", "upload.asset"],
    ["/api/scenes/scene-1", "scene.mutate"],
    ["/api/scenes/scene-1/canvas", "toolbar.mutate"],
    ["/api/characters/character-1/counters", "wallet.mutate"],
  ])("uses a safe operation label for %s", async (path, operation) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "FAILED" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api(path, { method: "POST", body: "{}" }).catch(() => undefined);

    const telemetry = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(telemetry.context.operation).toBe(operation);
  });
});

describe("client event buffer durability", () => {
  it("keeps a report buffered when the network is unavailable, and sends it on the next flush", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    reportClientEvent({
      level: "error",
      event: "window.error",
      errorName: "TypeError",
      stack: "TypeError: boom\n    at f (file.js:1:1)",
    });
    // Let the failed send's microtasks settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Network recovers; a later flush (e.g. triggered by the `online` event)
    // resends the still-buffered report instead of having lost it.
    vi.unstubAllGlobals();
    const recoveredFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", recoveredFetch);
    await flushClientEventBuffer();

    expect(recoveredFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(recoveredFetch.mock.calls[0]![1].body as string);
    expect(body.event).toBe("window.error");
    expect(body.errorName).toBe("TypeError");
  });

  it("keeps a pre-auth (401) report buffered and flushes it after login", async () => {
    const preAuthFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", preAuthFetch);

    reportClientEvent({ level: "error", event: "window.error", errorName: "Error" });
    await Promise.resolve();
    await Promise.resolve();
    expect(preAuthFetch).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
    const postAuthFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", postAuthFetch);
    await flushClientEventBuffer();

    expect(postAuthFetch).toHaveBeenCalledTimes(1);
  });
});
