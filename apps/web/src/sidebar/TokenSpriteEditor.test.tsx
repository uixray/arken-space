// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "../test-support/render";
const call = vi.hoisted(() => vi.fn());
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: call,
}));
const { TokenSpriteEditor } = await import("./TokenSpriteEditor");
it("retries an uncertain sprite upload with the original action and bytes", async () => {
  const asset = { id: "00000000-0000-4000-8000-000000000001" };
  call.mockReset();
  call
    .mockRejectedValueOnce(new Error("response lost"))
    .mockResolvedValueOnce(asset);
  const definition = {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Герой",
    ownName: "Герой",
    characterId: null,
    defaultAssetId: null,
    defaultWidth: 64,
    defaultHeight: 64,
    controllerMembershipIds: [],
    revision: 0,
  };
  renderComponent(
    <TokenSpriteEditor
      definition={definition}
      refresh={async () => {}}
      onClose={() => {}}
    />,
  );
  const user = userEvent.setup(),
    file = new File(["synthetic contents"], "frame.png", { type: "image/png" });
  const input = screen.getAllByLabelText("Спереди — резервный кадр")[0]!;
  await user.upload(input, file);
  const retry = await screen.findByRole("button", {
    name: "Повторить загрузку кадра",
  });
  expect(
    screen.getByRole("button", { name: "Сохранить набор" }),
  ).toBeDisabled();
  expect(call).toHaveBeenCalledTimes(1);
  await user.click(retry);
  await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  const [first, second] = call.mock.calls.map(
    (c) => c[1] as { headers: Record<string, string>; body: FormData },
  );
  expect(second!.headers["x-action-id"]).toBe(first!.headers["x-action-id"]);
  expect((first!.body.get("file") as File).name).toBe("frame.png");
  expect(second!.body.get("file")).toBe(first!.body.get("file"));
  await screen.findByAltText("Стоит — Спереди");
  expect(
    screen.queryByRole("button", { name: "Повторить загрузку кадра" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Сохранить набор" })).toBeEnabled();
});
it("requires an explicit decision before abandoning an unconfirmed upload", async () => {
  call.mockReset();
  call.mockRejectedValueOnce(new Error("response lost"));
  const definition = {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Герой",
    ownName: "Герой",
    characterId: null,
    defaultAssetId: null,
    defaultWidth: 64,
    defaultHeight: 64,
    controllerMembershipIds: [],
    revision: 0,
  };
  const risk = vi.fn();
  renderComponent(
    <TokenSpriteEditor
      definition={definition}
      refresh={async () => {}}
      onClose={() => {}}
      onUploadRiskChange={risk}
    />,
  );
  const user = userEvent.setup();
  await user.upload(
    screen.getAllByLabelText("Спереди — резервный кадр")[0]!,
    new File(["frame"], "frame.png", { type: "image/png" }),
  );
  await screen.findByRole("button", { name: "Повторить загрузку кадра" });
  expect(risk).toHaveBeenLastCalledWith(true);
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  expect(
    screen.getByRole("button", { name: "Сохранить набор" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Закрыть без сохранения" }),
  ).toBeDisabled();
  expect(
    screen.getAllByLabelText("Спереди — резервный кадр")[0],
  ).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Отказаться от повтора" }),
  );
  await waitFor(() => expect(risk).toHaveBeenLastCalledWith(false));
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
  expect(screen.getByRole("button", { name: "Сохранить набор" })).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Закрыть без сохранения" }),
  ).toBeEnabled();
  expect(screen.getAllByLabelText("Спереди — резервный кадр")[0]).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("retains the original upload action when a success response has no valid asset ID", async () => {
  call.mockReset();
  call
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ id: "00000000-0000-4000-8000-000000000001" });
  const definition = {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Герой",
    ownName: "Герой",
    characterId: null,
    defaultAssetId: null,
    defaultWidth: 64,
    defaultHeight: 64,
    controllerMembershipIds: [],
    revision: 0,
  };
  renderComponent(
    <TokenSpriteEditor
      definition={definition}
      refresh={async () => {}}
      onClose={() => {}}
    />,
  );
  const user = userEvent.setup();
  await user.upload(
    screen.getAllByLabelText("Спереди — резервный кадр")[0]!,
    new File(["frame"], "frame.png", { type: "image/png" }),
  );
  await screen.findByRole("button", { name: "Повторить загрузку кадра" });
  expect(screen.getByRole("alert")).toHaveTextContent("не подтверждает кадр");
  await user.click(
    screen.getByRole("button", { name: "Повторить загрузку кадра" }),
  );
  await screen.findByAltText("Стоит — Спереди");
  expect(call.mock.calls[1]![1].headers["x-action-id"]).toBe(
    call.mock.calls[0]![1].headers["x-action-id"],
  );
});
it("does not close on a malformed save receipt and retries the same action", async () => {
  call.mockReset();
  call
    .mockResolvedValueOnce({ id: "00000000-0000-4000-8000-000000000001" })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ duplicate: true });
  const definition = {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Герой",
    ownName: "Герой",
    characterId: null,
    defaultAssetId: null,
    defaultWidth: 64,
    defaultHeight: 64,
    controllerMembershipIds: [],
    revision: 0,
  };
  const close = vi.fn();
  renderComponent(
    <TokenSpriteEditor
      definition={definition}
      refresh={async () => {}}
      onClose={close}
    />,
  );
  const user = userEvent.setup();
  await user.upload(
    screen.getAllByLabelText("Спереди — резервный кадр")[0]!,
    new File(["frame"], "frame.png", { type: "image/png" }),
  );
  await screen.findByAltText("Стоит — Спереди");
  await user.click(screen.getByRole("button", { name: "Сохранить набор" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "не подтверждает сохранение",
  );
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Сохранить набор" }));
  await waitFor(() => expect(close).toHaveBeenCalledWith(true));
  expect(JSON.parse(call.mock.calls[2]![1].body)).toEqual(
    JSON.parse(call.mock.calls[1]![1].body),
  );
});
