// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type ReactElement, type ReactNode } from "react";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: vi.fn() };
});

import { ApiError, api } from "../api";
import {
  renderComponent as renderBase,
  screen,
  userEvent,
  waitFor,
} from "../test-support/render";
import { MemberRulerColors } from "./MemberRulerColorField";

/** UIX-509: the GM's per-member ruler colour picker. */
function renderComponent(ui: ReactElement) {
  return renderBase(ui, {
    wrapper: ({ children }: { children: ReactNode }) => <>{children}</>,
  });
}

const gmId = "11111111-1111-4111-8111-111111111111";
const playerId = "22222222-2222-4222-8222-222222222222";
const members = [
  { id: gmId, role: "GM" as const, displayName: "Мастер", characterId: null },
  {
    id: playerId,
    role: "PLAYER" as const,
    displayName: "Андрей",
    characterId: null,
    rulerColor: "green" as const,
  },
];

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  member: string,
  color: string,
) {
  await user.click(screen.getByRole("combobox", { name: member }));
  await user.click(screen.getByRole("option", { name: color }));
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("lists every member with their current colour or the automatic one", () => {
  renderComponent(<MemberRulerColors members={members} />);
  expect(screen.getByRole("combobox", { name: "Мастер" })).toHaveTextContent(
    "Автоматический",
  );
  expect(screen.getByRole("combobox", { name: "Андрей" })).toHaveTextContent(
    "Зелёный",
  );
});

it("saves the chosen key for that member and keeps the server's answer", async () => {
  const user = userEvent.setup();
  vi.mocked(api).mockResolvedValueOnce({ id: gmId, rulerColor: "black" });
  renderComponent(<MemberRulerColors members={members} />);
  await choose(user, "Мастер", "Чёрный");
  expect(api).toHaveBeenCalledWith(`/api/members/${gmId}/ruler-color`, {
    method: "PATCH",
    body: JSON.stringify({ rulerColor: "black" }),
  });
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Мастер" })).toHaveTextContent(
      "Чёрный",
    ),
  );
});

it("sends null to return a member to the automatic colour", async () => {
  const user = userEvent.setup();
  vi.mocked(api).mockResolvedValueOnce({ id: playerId, rulerColor: null });
  renderComponent(<MemberRulerColors members={members} />);
  await choose(user, "Андрей", "Автоматический");
  expect(api).toHaveBeenCalledWith(`/api/members/${playerId}/ruler-color`, {
    method: "PATCH",
    body: JSON.stringify({ rulerColor: null }),
  });
});

it("keeps the saved colour and shows an alert when the save fails", async () => {
  const user = userEvent.setup();
  vi.mocked(api).mockRejectedValueOnce(
    new ApiError(403, "GM_REQUIRED", "GM_REQUIRED"),
  );
  renderComponent(<MemberRulerColors members={members} />);
  await choose(user, "Андрей", "Синий");
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Андрей" })).toHaveTextContent(
    "Зелёный",
  );
});
