// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
  userEvent,
} from "./test-support/render";
import type { ArkenDialogProps } from "./ui/ArkenDialog";
import type { FeedbackDetail } from "./operator-feedback";
import * as feedback from "./operator-feedback";
import { OperatorFeedbackWorkspace } from "./OperatorFeedbackWorkspace";
import { ApiError } from "./api";

// This suite tests async privacy lifetime, not the real dialog's focus/layout.
vi.mock("./ui/ArkenDialog", () => ({
  ArkenDialog: ({ open, children, onClose }: ArkenDialogProps) =>
    open ? (
      <section>
        <button onClick={onClose}>Закрыть окно</button>
        {children}
      </section>
    ) : null,
}));
vi.mock("./operator-feedback", async (original) => ({
  ...(await original<typeof import("./operator-feedback")>()),
  fetchFeedbackList: vi.fn(),
  fetchFeedbackDetail: vi.fn(),
  fetchRedactedExport: vi.fn(),
  fetchAttachment: vi.fn(),
  updateFeedback: vi.fn(),
}));

const detail: FeedbackDetail = {
  id: "report",
  kind: "BUG",
  status: "NEW",
  buildVersion: null,
  buildRevision: null,
  linearKey: null,
  linearUrl: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  title: "Тестовый отчёт",
  description: "Описание",
  attachments: [
    {
      id: "image",
      kind: "IMAGE",
      mimeType: "image/png",
      sizeBytes: 1,
      width: 1,
      height: 1,
    },
  ],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.mocked(feedback.fetchFeedbackList).mockResolvedValue({
    items: [detail],
    nextCursor: null,
  });
  vi.mocked(feedback.fetchFeedbackDetail).mockResolvedValue(detail);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

async function setup() {
  const onClose = vi.fn();
  const rendered = renderComponent(
    <OperatorFeedbackWorkspace open onClose={onClose} />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Ошибка/ }));
  await screen.findByText(detail.title);
  return {
    ...rendered,
    user,
    onClose,
    open: (open: boolean) =>
      rendered.rerender(
        <OperatorFeedbackWorkspace open={open} onClose={onClose} />,
      ),
  };
}

it("does not restore revealed data after close and reopen", async () => {
  const view = await setup();
  const pending = deferred<FeedbackDetail>();
  vi.mocked(feedback.fetchFeedbackDetail).mockReturnValueOnce(pending.promise);
  await view.user.click(
    screen.getByRole("button", { name: "Показать чувствительные данные" }),
  );
  await view.user.click(screen.getByRole("button", { name: "Закрыть окно" }));
  view.open(false);
  await act(async () =>
    pending.resolve({ ...detail, contact: "PRIVATE-CONTACT" }),
  );
  view.open(true);
  await screen.findByRole("button", { name: /Ошибка/ });
  expect(screen.queryByText("PRIVATE-CONTACT")).not.toBeInTheDocument();
  expect(screen.queryByText(detail.title)).not.toBeInTheDocument();
});

it("does not write a late export to the clipboard after close", async () => {
  const view = await setup();
  const pending = deferred<Record<string, unknown>>();
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  vi.mocked(feedback.fetchRedactedExport).mockReturnValueOnce(pending.promise);
  await view.user.click(
    screen.getByRole("button", { name: "Копировать обезличенную версию" }),
  );
  view.open(false);
  await act(async () => pending.resolve({ redacted: true }));
  expect(write).not.toHaveBeenCalled();
});

it("does not allocate a private image URL after unmount", async () => {
  const view = await setup();
  const pending = deferred<Blob>();
  vi.mocked(feedback.fetchAttachment).mockReturnValueOnce(pending.promise);
  await view.user.click(
    screen.getByRole("button", { name: "Открыть изображение" }),
  );
  view.unmount();
  await act(async () =>
    pending.resolve(new Blob(["image"], { type: "image/png" })),
  );
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("opens an in-scope attachment and revokes it on unmount", async () => {
  const view = await setup();
  vi.mocked(feedback.fetchAttachment).mockResolvedValue(
    new Blob(["image"], { type: "image/png" }),
  );
  await view.user.click(
    screen.getByRole("button", { name: "Открыть изображение" }),
  );
  expect(
    await screen.findByRole("img", { name: "Вложение обратной связи" }),
  ).toHaveAttribute("src", "blob:private-preview");
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-preview");
});

it("ignores a previous open's list failure rather than closing a new session", async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof feedback.fetchFeedbackList>>>();
  vi.mocked(feedback.fetchFeedbackList).mockReturnValueOnce(pending.promise);
  const onClose = vi.fn();
  const view = renderComponent(
    <OperatorFeedbackWorkspace open onClose={onClose} />,
  );
  view.rerender(<OperatorFeedbackWorkspace open={false} onClose={onClose} />);
  view.rerender(<OperatorFeedbackWorkspace open onClose={onClose} />);
  await screen.findByRole("button", { name: /Ошибка/ });
  await act(async () => pending.reject(new Error("old request failed")));
  expect(onClose).not.toHaveBeenCalled();
});

it("requires a fresh Linear link after switching reports and submits only the chosen report", async () => {
  const first: FeedbackDetail = { ...detail, status: "ACKNOWLEDGED" };
  const second: FeedbackDetail = {
    ...first,
    id: "second",
    kind: "IDEA",
    title: "Второй отчёт",
  };
  vi.mocked(feedback.fetchFeedbackList).mockResolvedValue({
    items: [first, second],
    nextCursor: null,
  });
  vi.mocked(feedback.fetchFeedbackDetail).mockImplementation(async (id) =>
    id === first.id ? first : second,
  );
  vi.mocked(feedback.updateFeedback).mockResolvedValue(undefined);
  const view = await setup();
  await view.user.type(screen.getByLabelText("Ключ Linear"), "UIX-318");
  await view.user.type(
    screen.getByLabelText("URL задачи Linear"),
    "https://linear.app/uixray/issue/UIX-318/first",
  );
  expect(
    screen.getByRole("button", { name: "Связано с задачей" }),
  ).toBeEnabled();
  await view.user.click(screen.getByRole("button", { name: /Идея/ }));
  await screen.findByText(second.title);
  expect(screen.getByLabelText("Ключ Linear")).toHaveValue("");
  expect(screen.getByLabelText("URL задачи Linear")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "Связано с задачей" }),
  ).toBeDisabled();
  expect(feedback.updateFeedback).not.toHaveBeenCalled();
  await view.user.type(screen.getByLabelText("Ключ Linear"), "UIX-293");
  await view.user.type(
    screen.getByLabelText("URL задачи Linear"),
    "https://linear.app/uixray/issue/UIX-293/second",
  );
  await view.user.click(
    screen.getByRole("button", { name: "Связано с задачей" }),
  );
  expect(feedback.updateFeedback).toHaveBeenCalledExactlyOnceWith("second", {
    status: "LINKED",
    linearKey: "UIX-293",
    linearUrl: "https://linear.app/uixray/issue/UIX-293/second",
  });
});

it("appends the next page once, keeps filters and clears detail when applying new filters", async () => {
  const second: FeedbackDetail = { ...detail, id: "second", kind: "IDEA" };
  vi.mocked(feedback.fetchFeedbackList)
    .mockResolvedValueOnce({ items: [detail], nextCursor: "opaque+/=" })
    .mockResolvedValueOnce({ items: [detail, second], nextCursor: null })
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  const view = await setup();
  await view.user.click(screen.getByRole("button", { name: "Загрузить ещё" }));
  await screen.findByRole("button", { name: /Идея/ });
  expect(screen.getAllByRole("button", { name: /Ошибка/ })).toHaveLength(1);
  expect(feedback.fetchFeedbackList).toHaveBeenNthCalledWith(2, {
    cursor: "opaque+/=",
  });
  expect(
    screen.queryByRole("button", { name: "Загрузить ещё" }),
  ).not.toBeInTheDocument();
  await view.user.selectOptions(screen.getByLabelText("Тип обращения"), "IDEA");
  await view.user.selectOptions(
    screen.getByLabelText("Статус обращения"),
    "NEW",
  );
  await view.user.type(screen.getByLabelText("Сборка"), "build-2");
  await view.user.click(
    screen.getByRole("button", { name: "Применить фильтры" }),
  );
  await screen.findByText("По выбранным фильтрам обращений нет.");
  expect(feedback.fetchFeedbackList).toHaveBeenLastCalledWith({
    kind: "IDEA",
    status: "NEW",
    build: "build-2",
    from: undefined,
    to: undefined,
  });
  expect(screen.queryByText(detail.title)).not.toBeInTheDocument();
});

it("keeps existing rows and retries the same cursor after a failed next page", async () => {
  vi.mocked(feedback.fetchFeedbackList)
    .mockResolvedValueOnce({ items: [detail], nextCursor: "page2" })
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  const view = await setup();
  await view.user.click(screen.getByRole("button", { name: "Загрузить ещё" }));
  await screen.findByText("Не удалось загрузить обращения.");
  expect(screen.getByRole("button", { name: /Ошибка/ })).toBeEnabled();
  await view.user.click(
    screen.getByRole("button", { name: "Повторить загрузку" }),
  );
  expect(feedback.fetchFeedbackList).toHaveBeenNthCalledWith(3, {
    cursor: "page2",
  });
  expect(view.onClose).not.toHaveBeenCalled();
});

it("closes and clears the viewer if a page reports revoked authorization", async () => {
  vi.mocked(feedback.fetchFeedbackList)
    .mockResolvedValueOnce({ items: [detail], nextCursor: "page2" })
    .mockRejectedValueOnce(new ApiError(403, "FORBIDDEN", "Запрещено"));
  const view = await setup();
  await view.user.click(screen.getByRole("button", { name: "Загрузить ещё" }));
  expect(view.onClose).toHaveBeenCalledOnce();
  expect(screen.queryByText(detail.title)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Ошибка/ }),
  ).not.toBeInTheDocument();
});

it("rejects an inverted date range locally and sends valid local dates as UTC", async () => {
  const view = await setup();
  fireEvent.change(screen.getByLabelText("С даты"), {
    target: { value: "2026-09-17T12:00" },
  });
  fireEvent.change(screen.getByLabelText("По дату"), {
    target: { value: "2026-09-16T12:00" },
  });
  await view.user.click(
    screen.getByRole("button", { name: "Применить фильтры" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "начало не позже окончания",
  );
  expect(feedback.fetchFeedbackList).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("По дату"), {
    target: { value: "2026-09-18T12:00" },
  });
  await view.user.click(
    screen.getByRole("button", { name: "Применить фильтры" }),
  );
  expect(feedback.fetchFeedbackList).toHaveBeenLastCalledWith({
    from: new Date("2026-09-17T12:00").toISOString(),
    to: new Date("2026-09-18T12:00").toISOString(),
    kind: undefined,
    status: undefined,
    build: undefined,
  });
  await view.user.click(
    screen.getByRole("button", { name: "Сбросить фильтры" }),
  );
  expect(feedback.fetchFeedbackList).toHaveBeenLastCalledWith({});
  expect(screen.getByLabelText("С даты")).toHaveValue("");
  expect(screen.getByLabelText("По дату")).toHaveValue("");
});
