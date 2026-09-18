// @vitest-environment jsdom
import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import type { ComponentProps } from "react";
import {
  ThemeProvider,
  ToasterComponent,
  ToasterProvider,
} from "@gravity-ui/uikit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import type { Sidebar } from "./Sidebar";
import { gmSnapshot } from "./test-support/game-snapshot-fixtures";
import { installMatchMediaMock } from "./test-support/dom-mocks";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "./test-support/render";
import { appToaster } from "./ui/toaster";

const boundary = vi.hoisted(() => ({
  api: vi.fn(),
  events: new Map<string, (snapshot: GameSnapshot) => void>(),
  results: [] as string[],
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: boundary.api,
  reportClientEvent: vi.fn(),
}));
vi.mock("./operator-feedback", () => ({
  fetchOperatorCapability: vi.fn(async () => {
    throw new Error("FORBIDDEN");
  }),
}));
vi.mock("./realtime", () => ({
  createGameSocket: () => ({
    on: (event: string, callback: (snapshot: GameSnapshot) => void) =>
      boundary.events.set(event, callback),
    emit: vi.fn(),
    disconnect: vi.fn(),
    io: { on: vi.fn() },
  }),
}));
// Only the visual shell is replaced. These controls call the actual App queue;
// the queue, snapshot reconciliation, HTTP boundary and notification UI are real.
vi.mock("./Sidebar", () => ({
  Sidebar: (props: ComponentProps<typeof Sidebar>) => (
    <button
      onClick={() => {
        void props
          .onPatchCharacter("character-queue", { notes: "edited" })
          .then(() => boundary.results.push("saved"))
          .catch((error: unknown) =>
            boundary.results.push(
              error instanceof Error ? error.message : "unknown",
            ),
          );
      }}
    >
      Edit character queue
    </button>
  ),
}));
vi.mock("./MusicBar", () => ({ MusicBar: () => null }));
vi.mock("./FeedbackReporter", () => ({ FeedbackReporter: () => null }));

const message = "Персонаж больше недоступен. Обновите список персонажей.";
const character: CharacterDto = {
  id: "character-queue",
  name: "Проверка очереди",
  ownerMembershipId: null,
  controllerMembershipIds: [],
  portraitAssetId: null,
  stats: {},
  skills: [],
  spells: [],
  entries: [],
  notes: "",
  backstory: "",
  inventory: [],
  resources: {},
  wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
  revision: 1,
  lifecycle: "ACTIVE",
  archivedAt: null,
  archivedByMembershipId: null,
};
beforeEach(() => {
  installMatchMediaMock();
  boundary.events.clear();
  boundary.results.length = 0;
  boundary.api.mockReset();
  window.localStorage.clear();
});
afterEach(() => {
  appToaster.removeAll();
});

it("reports removed canonical character in Russian, skips the queued phantom PATCH and recovers", async () => {
  let canonical = gmSnapshot({ characters: [character] });
  let settleFirst!: (response: unknown) => void;
  const firstResponse = new Promise<unknown>((resolve) => {
    settleFirst = resolve;
  });
  const patches: RequestInit[] = [];
  boundary.api.mockImplementation(
    async (path: string, options?: RequestInit) => {
      if (path === "/api/bootstrap") return canonical;
      if (path === "/api/story/posts") return { posts: [], nextCursor: null };
      if (
        path === "/api/player-access" ||
        path.startsWith("/api/canvas/history")
      )
        return [];
      if (
        path === "/api/characters/character-queue" &&
        options?.method === "PATCH"
      ) {
        patches.push(options);
        if (patches.length === 1) return firstResponse;
        return { ...character, revision: 3, notes: "edited" };
      }
      throw new Error(`Unexpected test API: ${path}`);
    },
  );
  renderComponent(
    <ThemeProvider>
      <ToasterProvider toaster={appToaster}>
        <App />
        <ToasterComponent />
      </ToasterProvider>
    </ThemeProvider>,
  );
  const edit = await screen.findByRole("button", {
    name: "Edit character queue",
  });
  fireEvent.click(edit);
  await waitFor(() => expect(patches).toHaveLength(1));
  fireEvent.click(edit);
  // The legacy response requires an authoritative bootstrap. Removal occurs
  // while the second edit is queued, not through fabricated React state.
  canonical = gmSnapshot({ characters: [], snapshotVersion: 2 });
  await act(async () => {
    settleFirst({ duplicate: true });
  });
  await waitFor(() => expect(boundary.results).toEqual([message, message]));
  expect(patches).toHaveLength(1);
  expect(await screen.findAllByText(message)).not.toHaveLength(0);
  expect(screen.queryByText("CHARACTER_NOT_FOUND")).not.toBeInTheDocument();
  canonical = gmSnapshot({
    characters: [{ ...character, revision: 2 }],
    snapshotVersion: 3,
  });
  await act(async () => {
    boundary.events.get("game:snapshot")!(canonical);
  });
  fireEvent.click(screen.getByRole("button", { name: "Edit character queue" }));
  await waitFor(() =>
    expect(boundary.results).toEqual([message, message, "saved"]),
  );
  expect(patches).toHaveLength(2);
  expect(patches[1]).toBeDefined();
  expect(JSON.parse(String(patches[1]!.body))).toMatchObject({
    revision: 2,
    notes: "edited",
  });
});
