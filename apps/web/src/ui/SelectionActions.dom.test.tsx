// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "../test-support/render";
import { SelectionActions } from "./SelectionActions";

it("hides selection actions when no objects are selected", () => {
  renderComponent(
    <SelectionActions
      count={0}
      onMove={vi.fn()}
      onDelete={vi.fn()}
      onClear={vi.fn()}
    />,
  );
  expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
});

it.each([1, 4])(
  "preserves every action without a persistent counter for %i selected objects",
  async (count) => {
    const onMove = vi.fn();
    const onDelete = vi.fn();
    const onClear = vi.fn();
    const user = userEvent.setup();
    renderComponent(
      <SelectionActions
        count={count}
        onMove={onMove}
        onDelete={onDelete}
        onClear={onClear}
      />,
    );
    const toolbar = screen.getByRole("toolbar", {
      name: "Действия с выбранными объектами",
    });
    expect(toolbar).not.toHaveTextContent(/Выбрано|Токенов:|Рисунков:|[0-9]/);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Переместить" }));
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    await user.click(screen.getByRole("button", { name: "Снять выделение" }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  },
);
