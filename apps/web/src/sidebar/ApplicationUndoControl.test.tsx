// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "../test-support/render";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: apiMock,
}));
const { ApplicationUndoControl } = await import("./ChatPanels");
const message = {
  id: "11111111-1111-4111-8111-111111111111",
  membershipId: "author",
  applicationUndo: { cancelled: false },
} as never;
const snapshot = (id: string, role: "GM" | "PLAYER") =>
  ({ me: { id, role } }) as never;
beforeEach(() => {
  apiMock.mockReset();
});

it("lets the author undo once and displays the cancelled state", async () => {
  apiMock.mockResolvedValue({ ok: true });
  renderComponent(
    <ApplicationUndoControl
      message={message}
      snapshot={snapshot("author", "PLAYER")}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Отменить применение" }));
  await screen.findByText("Применение отменено");
  expect(apiMock).toHaveBeenCalledTimes(1);
  const [path, options] = apiMock.mock.calls[0]!;
  expect(path).toBe("/api/chat/application-undo");
  expect(JSON.parse(options.body)).toMatchObject({
    messageId: "11111111-1111-4111-8111-111111111111",
    actionId: expect.any(String),
  });
});

it("does not offer cancellation to another player", () => {
  renderComponent(
    <ApplicationUndoControl
      message={message}
      snapshot={snapshot("other", "PLAYER")}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Отменить применение" }),
  ).toBeNull();
});

it("keeps the original application visible if the server rejects a stale revision", async () => {
  apiMock.mockRejectedValue(new Error("Данные уже изменились"));
  renderComponent(
    <ApplicationUndoControl
      message={message}
      snapshot={snapshot("gm", "GM")}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Отменить применение" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Данные уже изменились",
    ),
  );
  expect(screen.queryByText("Применение отменено")).toBeNull();
});
