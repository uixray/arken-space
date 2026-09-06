// @vitest-environment jsdom
import { act } from "react";
import { expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "../test-support/render";
import { DiceTrayPanel } from "./DiceTrayPanel";

it("показывает ожидание сразу и принимает второй бросок до ответа первого (UIX-621)", async () => {
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
  await userEvent.click(screen.getByRole("button", { name: "d20" }));
  expect(screen.getByRole("status")).toHaveTextContent("Бросаем… 1");
  const first = finish;
  await userEvent.click(screen.getByRole("button", { name: "d6" }));
  expect(onRoll).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status")).toHaveTextContent("Бросаем… 2");
  await act(async () => {
    first();
    finish();
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
  expect(screen.getByRole("button", { name: "d20" })).toBeEnabled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
  const advantage = screen.getByRole("radio", { name: "Преимущество" });
  expect(advantage).toHaveAttribute("title", "Преимущество");
  expect(advantage.textContent).toBe("↑");
  await userEvent.click(advantage);
  expect(advantage).toHaveAttribute("aria-checked", "true");
  await userEvent.click(screen.getByRole("button", { name: "d20" }));
  expect(onRoll).toHaveBeenCalledWith(
    "1d20",
    "d20",
    "PUBLIC",
    "hero",
    "ADVANTAGE",
  );
  const visibility = screen.getByRole("button", { name: "Только мастеру" });
  expect(visibility).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(visibility);
  expect(onVisibilityChange).toHaveBeenCalledWith("GM_ONLY");
  expect(visibility.closest(".dice-tray-panel__toolbar")).toBe(
    advantage.closest(".dice-tray-panel__toolbar"),
  );
});
