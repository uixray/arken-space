import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api telemetry and correlation", () => {
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
