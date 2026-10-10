// @vitest-environment jsdom
import { act } from "react";
import { expect, it, vi } from "vitest";
import {
  fireEvent,
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "../test-support/render";
import { DiceTrayPanel } from "./DiceTrayPanel";

it("объявляет busy без видимой строки и принимает второй бросок до ответа первого (UIX-621)", async () => {
  let finish!: () => void;
  const onRoll = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  renderComponent(
    <DiceTrayPanel
      characterId={null}
      visibility="PUBLIC"
      onVisibilityChange={vi.fn()}
      onRoll={onRoll}
    />,
  );
  const panel = screen.getByLabelText("Физические кости");
  expect(panel).toHaveAttribute("aria-busy", "false");
  await userEvent.click(screen.getByRole("button", { name: "d20" }));
  await waitFor(() => expect(onRoll).toHaveBeenCalledTimes(1));
  expect(panel).toHaveAttribute("aria-busy", "true");
  expect(panel).not.toHaveTextContent("Бросаем");
  expect(panel.querySelector(":scope > p")).toBeNull();
  const first = finish;
  await userEvent.click(screen.getByRole("button", { name: "d6" }));
  await waitFor(() => expect(onRoll).toHaveBeenCalledTimes(2));
  const second = finish;
  expect(panel).toHaveAttribute("aria-busy", "true");
  await act(async () => {
    first();
    await Promise.resolve();
  });
  expect(panel).toHaveAttribute("aria-busy", "true");
  await act(async () => second());
  await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "false"));
});

it("показывает отказ сервера и разрешает повторный бросок", async () => {
  const onRoll = vi.fn().mockRejectedValue(new Error("Нет соединения"));
  renderComponent(
    <DiceTrayPanel
      characterId={null}
      visibility="PUBLIC"
      onVisibilityChange={vi.fn()}
      onRoll={onRoll}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "d20" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Нет соединения");
  expect(screen.getByLabelText("Физические кости")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(screen.getByRole("button", { name: "d20" })).toBeEnabled();
});

it("собирает кости и доступные иконные режимы в один компактный блок", async () => {
  const onRoll = vi.fn().mockResolvedValue(undefined);
  const onVisibilityChange = vi.fn();
  renderComponent(
    <DiceTrayPanel
      characterId="hero"
      visibility="PUBLIC"
      onVisibilityChange={onVisibilityChange}
      onRoll={onRoll}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Формула" }),
  ).not.toBeInTheDocument();
  const advantage = screen.getByRole("button", { name: "Преимущество" });
  expect(advantage).toHaveAttribute("title", "Преимущество");
  expect(
    screen.queryByRole("button", { name: "Обычно" }),
  ).not.toBeInTheDocument();
  const icons = ["Преимущество", "Помеха"].map((name) => {
    const control = screen.getByRole("button", { name });
    expect(control.textContent).toBe("");
    expect(control.querySelectorAll("svg.arken-icon")).toHaveLength(1);
    const icon = control.querySelector("svg")!;
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("focusable", "false");
    expect(icon.innerHTML.length).toBeGreaterThan(0);
    return icon.innerHTML;
  });
  expect(new Set(icons).size).toBe(2);
  await userEvent.click(advantage);
  expect(advantage).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "d20" }));
  await waitFor(() =>
    expect(onRoll).toHaveBeenCalledWith(
      "1d20",
      "Чистый бросок двадцатки",
      "PUBLIC",
      "hero",
      "ADVANTAGE",
    ),
  );
  expect(advantage).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(screen.getByRole("button", { name: "d6" }));
  await waitFor(() =>
    expect(onRoll).toHaveBeenLastCalledWith(
      "1d6",
      "Чистый бросок куба",
      "PUBLIC",
      "hero",
      "NORMAL",
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "d100" }));
  await waitFor(() =>
    expect(onRoll).toHaveBeenLastCalledWith(
      "1d100",
      "Чистый бросок стогранника",
      "PUBLIC",
      "hero",
      "NORMAL",
    ),
  );
  const visibility = screen.getByRole("button", { name: "Только мастеру" });
  expect(visibility).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(visibility);
  expect(onVisibilityChange).toHaveBeenCalledWith("GM_ONLY");
  expect(visibility.closest(".dice-tray-panel__toolbar")).toBe(
    advantage.closest(".dice-tray-panel__toolbar"),
  );
});

it("двойной клик даёт ровно два чистых броска без окна", async () => {
  const resolvers: Array<() => void> = [];
  const onRoll = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  renderComponent(
    <DiceTrayPanel
      characterId={null}
      visibility="PUBLIC"
      onVisibilityChange={vi.fn()}
      onRoll={onRoll}
    />,
  );
  await userEvent.dblClick(screen.getByRole("button", { name: "d12" }));
  const panel = screen.getByLabelText("Физические кости");
  await waitFor(() => expect(onRoll).toHaveBeenCalledTimes(1));
  expect(panel).toHaveAttribute("aria-busy", "true");
  expect(panel).not.toHaveTextContent("Бросаем");
  expect(panel.querySelector(":scope > p")).toBeNull();
  await act(async () => resolvers[0]!());
  await waitFor(() => expect(onRoll).toHaveBeenCalledTimes(2));
  expect(panel).toHaveAttribute("aria-busy", "true");
  expect(panel).not.toHaveTextContent("Бросаем");
  expect(panel.querySelector(":scope > p")).toBeNull();
  await act(async () => resolvers[1]!());
  await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "false"));
  expect(
    screen.queryByRole("group", { name: "Сколько раз бросить" }),
  ).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(onRoll).toHaveBeenCalledTimes(2);
});

it("Shift открывает выбор числа повторов без предварительного броска", async () => {
  const onRoll = vi.fn().mockResolvedValue(undefined);
  renderComponent(
    <DiceTrayPanel
      characterId={null}
      visibility="PUBLIC"
      onVisibilityChange={vi.fn()}
      onRoll={onRoll}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "d6" }), {
    shiftKey: true,
  });
  expect(onRoll).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "3" }));
  await waitFor(() => expect(onRoll).toHaveBeenCalledTimes(3));
});
