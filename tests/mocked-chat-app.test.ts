import type { GameSnapshot } from "@arken/contracts";
import type { Page, Request, Route, WebSocketRoute } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { gmSnapshot } from "../apps/web/src/test-support/game-snapshot-fixtures";
import { unmockedResponse } from "./e2e/mock-api-contract";
import { installMockedChatTransport } from "./e2e/mocked-chat-app";

type RouteHandler = (route: Route) => unknown;
type Registration = { matcher: string | RegExp; handler: RouteHandler };
type Harness = {
  page: Page;
  registrations: Registration[];
  events: string[];
  socketHandler: ((socket: WebSocketRoute) => void) | undefined;
  rejectRoute: (matcher: string | RegExp) => void;
  rejectSocket: (error: Error) => void;
  completeSocketRegistration: () => void;
  deferSocketRegistration: () => void;
};

function makeHarness(): Harness {
  const registrations: Registration[] = [];
  const events: string[] = [];
  let socketHandler: ((socket: WebSocketRoute) => void) | undefined;
  let deferSocket = false;
  let resolveSocket: () => void = () => {};
  let rejectSocketPromise: (error: Error) => void = () => {};
  let rejectRouteMatcher: string | RegExp = "";
  let routeFailure = new Error("route registration failed");
  const page = {
    route: vi.fn((matcher: string | RegExp, handler: RouteHandler) => {
      events.push("route:" + String(matcher));
      if (String(matcher) === String(rejectRouteMatcher))
        return Promise.reject(routeFailure);
      registrations.push({ matcher, handler });
      return Promise.resolve();
    }),
    routeWebSocket: vi.fn(
      (
        _matcher: string | RegExp,
        handler: (socket: WebSocketRoute) => void,
      ) => {
        events.push("socket-register");
        socketHandler = handler;
        if (!deferSocket) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          resolveSocket = () => resolve();
          rejectSocketPromise = reject;
        });
      },
    ),
  } as unknown as Page;
  const harness: Harness = {
    page,
    registrations,
    events,
    get socketHandler() {
      return socketHandler;
    },
    rejectRoute(matcher) {
      rejectRouteMatcher = matcher;
      routeFailure = new Error("route registration rejected");
    },
    rejectSocket(error) {
      rejectSocketPromise(error);
    },
    completeSocketRegistration() {
      resolveSocket();
    },
    deferSocketRegistration() {
      deferSocket = true;
    },
  };
  return harness;
}

function matches(matcher: string | RegExp, url: string) {
  if (matcher instanceof RegExp) return matcher.test(url);
  const pathname = new URL(url).pathname;
  if (matcher === "**/api/**") return pathname.startsWith("/api/");
  if (matcher.startsWith("**/")) return pathname.endsWith(matcher.slice(2));
  return pathname === matcher;
}

async function dispatch(
  harness: Harness,
  url: string,
  method: string,
  body?: unknown,
) {
  const matching = harness.registrations
    .map((registration) => registration)
    .filter((registration) => matches(registration.matcher, url))
    .reverse();
  const responses: unknown[] = [];
  const run = async (position: number): Promise<unknown> => {
    if (position >= matching.length) return { kind: "network-fallback" };
    const registration = matching[position];
    const request = {
      url: () => url,
      method: () => method,
      postDataJSON: () =>
        body ?? { text: "delayed message", visibility: "PUBLIC" },
    } as unknown as Request;
    const route = {
      request: () => request,
      fulfill: vi.fn(async (response: unknown) => {
        responses.push(response);
        return response;
      }),
      fallback: vi.fn(() => run(position + 1)),
    } as unknown as Route;
    return registration.handler(route);
  };
  return { result: await run(0), responses };
}

describe("installMockedChatTransport", () => {
  it("awaits deferred socket registration before capabilities without waiting for a connection", async () => {
    const harness = makeHarness();
    harness.deferSocketRegistration();
    const current = gmSnapshot();
    let settled = false;
    const install = installMockedChatTransport(harness.page, {
      getSnapshot: () => current,
      socketId: "unit-socket",
    }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(harness.events[0]).toMatch(/^route:\/\^https\?:/);
    expect(harness.events[1]).toBe("socket-register");
    expect(harness.registrations.map(({ matcher }) => matcher)).toEqual([
      /^https?:\/\/[^/]+\/api\/bootstrap(?:\?.*)?$/,
    ]);

    harness.completeSocketRegistration();
    await install;
    expect(settled).toBe(true);
    expect(
      harness.registrations.slice(1).map(({ matcher }) => matcher),
    ).toEqual([
      "**/api/soundpad",
      "**/api/client-logs",
      "**/api/account/capabilities",
    ]);
    expect(harness.events.slice(-3)).toEqual([
      "route:**/api/soundpad",
      "route:**/api/client-logs",
      "route:**/api/account/capabilities",
    ]);
    expect(
      (await dispatch(harness, "http://localhost/api/soundpad", "GET"))
        .responses,
    ).toEqual([{ json: { packs: [], playerPlaybackEnabled: true } }]);
    expect(
      (await dispatch(harness, "http://localhost/api/client-logs", "GET"))
        .responses,
    ).toEqual([{ json: { ok: true } }]);
    expect(
      (
        await dispatch(
          harness,
          "http://localhost/api/account/capabilities",
          "GET",
        )
      ).responses,
    ).toEqual([
      {
        json: {
          accountAuthEnabled: false,
          campaignLinkAccessEnabled: false,
          legacyDevEnabled: true,
        },
      },
    ]);
  });

  it("propagates bootstrap, socket, and capability registration rejections", async () => {
    const bootstrap = makeHarness();
    bootstrap.rejectRoute(/^https?:\/\/[^/]+\/api\/bootstrap(?:\?.*)?$/);
    await expect(
      installMockedChatTransport(bootstrap.page, {
        getSnapshot: gmSnapshot,
        socketId: "reject-bootstrap",
      }),
    ).rejects.toThrow("route registration rejected");
    expect(bootstrap.events).toHaveLength(1);

    const socket = makeHarness();
    socket.deferSocketRegistration();
    const socketInstall = installMockedChatTransport(socket.page, {
      getSnapshot: gmSnapshot,
      socketId: "reject-socket",
    });
    await Promise.resolve();
    const socketError = new Error("socket registration rejected");
    socket.rejectSocket(socketError);
    await expect(socketInstall).rejects.toBe(socketError);
    expect(socket.registrations).toHaveLength(1);

    const capabilities = makeHarness();
    capabilities.rejectRoute("**/api/client-logs");
    await expect(
      installMockedChatTransport(capabilities.page, {
        getSnapshot: gmSnapshot,
        socketId: "reject-capabilities",
      }),
    ).rejects.toThrow("route registration rejected");
    expect(capabilities.events.at(-1)).toBe("route:**/api/client-logs");
  });

  it("preserves caller route precedence, bootstrap boundaries, and current snapshots", async () => {
    const harness = makeHarness();
    const callerRouter = vi.fn(async (route: Route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/bootstrap" && request.method() !== "GET")
        return route.fulfill({
          status: 405,
          json: { error: "METHOD_NOT_ALLOWED" },
        });
      return route.fulfill({
        status: 200,
        json: unmockedResponse(request.method(), path),
      });
    });
    await harness.page.route("**/api/**", callerRouter);
    let snapshot: GameSnapshot = gmSnapshot();
    const replacement = gmSnapshot({ buildVersion: "refreshed" });
    await installMockedChatTransport(harness.page, {
      getSnapshot: () => snapshot,
      socketId: "route-chain",
    });

    const first = await dispatch(
      harness,
      "http://localhost/api/bootstrap?campaign=1",
      "GET",
    );
    expect(first.responses).toEqual([{ json: snapshot }]);
    snapshot = replacement;
    const refreshed = await dispatch(
      harness,
      "http://localhost/api/bootstrap",
      "GET",
    );
    expect(refreshed.responses).toEqual([{ json: replacement }]);

    const post = await dispatch(
      harness,
      "http://localhost/api/bootstrap",
      "POST",
    );
    expect(post.responses).toEqual([
      { status: 405, json: { error: "METHOD_NOT_ALLOWED" } },
    ]);
    expect(callerRouter).toHaveBeenCalled();
    await expect(
      dispatch(harness, "http://localhost/api/bootstrap/extra", "GET"),
    ).rejects.toThrow("Unmocked API request: GET /api/bootstrap/extra");
  });

  it("keeps local delayed POST and explicit forbidden response while strict unknown reads fail", async () => {
    const harness = makeHarness();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: unknown[] = [];
    let completed = false;
    await harness.page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/chat" && request.method() === "POST") {
        sent.push(request.postDataJSON());
        await pending;
        completed = true;
        return route.fulfill({ json: { ok: true } });
      }
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      return route.fulfill({
        status: 200,
        json: unmockedResponse(request.method(), path),
      });
    });
    await installMockedChatTransport(harness.page, {
      getSnapshot: gmSnapshot,
      socketId: "local-write",
    });

    const postPromise = dispatch(harness, "http://localhost/api/chat", "POST", {
      text: "delayed message",
      visibility: "PUBLIC",
    });
    await Promise.resolve();
    expect(sent).toEqual([{ text: "delayed message", visibility: "PUBLIC" }]);
    expect(completed).toBe(false);
    release();
    const post = await postPromise;
    expect(completed).toBe(true);
    expect(post.responses).toEqual([{ json: { ok: true } }]);

    const denied = await dispatch(
      harness,
      "http://localhost/api/operator/feedback/capability",
      "GET",
    );
    expect(denied.responses).toEqual([
      { status: 403, json: { error: "FORBIDDEN" } },
    ]);
    await expect(
      dispatch(harness, "http://localhost/api/not-a-contract", "GET"),
    ).rejects.toThrow("Unmocked API request: GET /api/not-a-contract");
  });

  it("preserves exact Engine.IO packets and caller-owned live snapshot hooks", async () => {
    const harness = makeHarness();
    const events: string[] = [];
    const snapshot = gmSnapshot({ buildVersion: "socket-push" });
    let emitSnapshot: ((value: GameSnapshot) => void) | undefined;
    const onReady = vi.fn(() => events.push("ready"));
    await installMockedChatTransport(harness.page, {
      getSnapshot: gmSnapshot,
      socketId: "uix289-bundled-motion",
      onSocket: (socket) => {
        events.push("socket");
        emitSnapshot = (value) =>
          socket.send('42["game:snapshot",' + JSON.stringify(value) + "]");
      },
      onReady,
    });
    let messageHandler: ((message: string) => void) | undefined;
    const packets: string[] = [];
    const socket = {
      send: (packet: string) => {
        packets.push(packet);
        events.push(packet.startsWith("40") ? "ack" : "open");
      },
      onMessage: (handler: (message: string) => void) => {
        events.push("listener");
        messageHandler = handler;
      },
    } as unknown as WebSocketRoute;

    harness.socketHandler?.(socket);
    expect(events).toEqual(["socket", "listener", "open"]);
    expect(packets).toEqual([
      '0{"sid":"uix289-bundled-motion","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    ]);
    messageHandler?.("not-connected");
    expect(packets).toHaveLength(1);
    expect(onReady).not.toHaveBeenCalled();
    messageHandler?.("40");
    expect(packets[1]).toBe('40{"sid":"uix289-bundled-motion"}');
    expect(events).toEqual(["socket", "listener", "open", "ack", "ready"]);
    expect(onReady).toHaveBeenCalledOnce();
    emitSnapshot?.(snapshot);
    expect(packets[2]).toBe(
      '42["game:snapshot",' + JSON.stringify(snapshot) + "]",
    );
  });

  it("keeps hookless B clients free of unsolicited app events or connection waits", async () => {
    const harness = makeHarness();
    let installSettled = false;
    const installation = installMockedChatTransport(harness.page, {
      getSnapshot: gmSnapshot,
      socketId: "chat-icons",
    }).then(() => {
      installSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    harness.completeSocketRegistration();
    await installation;
    expect(installSettled).toBe(true);

    const packets: string[] = [];
    let messageHandler: ((message: string) => void) | undefined;
    harness.socketHandler?.({
      send: (packet: string) => packets.push(packet),
      onMessage: (handler: (message: string) => void) => {
        messageHandler = handler;
      },
    } as unknown as WebSocketRoute);
    messageHandler?.("40");
    expect(packets).toEqual([
      '0{"sid":"chat-icons","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      '40{"sid":"chat-icons"}',
    ]);
  });
});
