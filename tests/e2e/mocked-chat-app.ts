import type { GameSnapshot } from "@arken/contracts";
import type { Page, WebSocketRoute } from "@playwright/test";
import { mockAuthenticatedGameCapabilities } from "./mocked-game-capabilities";

export type MockedChatTransportOptions = {
  getSnapshot: () => GameSnapshot;
  socketId: string;
  onSocket?: (socket: WebSocketRoute) => void;
  onReady?: () => void;
};

const BOOTSTRAP_URL = /^https?:\/\/[^/]+\/api\/bootstrap(?:\?.*)?$/;

/**
 * Installs only the common authenticated mock bootstrap and Engine.IO/Socket.IO
 * transport. Callers keep their own broad API router and scenario-specific
 * responses; register that router before calling this helper.
 */
export async function installMockedChatTransport(
  page: Page,
  options: MockedChatTransportOptions,
): Promise<void> {
  await page.route(BOOTSTRAP_URL, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname !== "/api/bootstrap" || request.method() !== "GET")
      return route.fallback();

    return route.fulfill({ json: options.getSnapshot() });
  });

  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    options.onSocket?.(socket);
    socket.onMessage((message) => {
      if (message.toString() !== "40") return;

      socket.send("40" + JSON.stringify({ sid: options.socketId }));
      options.onReady?.();
    });
    socket.send(
      "0" +
        JSON.stringify({
          sid: options.socketId,
          upgrades: [],
          pingInterval: 60000,
          pingTimeout: 60000,
          maxPayload: 1000000,
        }),
    );
  });

  await mockAuthenticatedGameCapabilities(page);
}
