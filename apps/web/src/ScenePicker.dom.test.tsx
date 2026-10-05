// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fireEvent, renderComponent, screen } from "./test-support/render";
import { ScenePicker } from "./ScenePicker";
import type { GameSnapshot } from "@arken/contracts";
const scenes = [
  { id: "one", name: "Первая сцена", mapAssetId: null },
  { id: "two", name: "Вторая сцена", mapAssetId: null },
] as GameSnapshot["scenes"];
it("edits the exact scene without selecting it or nesting buttons", () => {
  const select = vi.fn();
  const edit = vi.fn();
  const { container } = renderComponent(
    <ScenePicker
      activeScene={scenes[0]}
      scenes={scenes}
      assets={[]}
      tokens={[]}
      isGm
      isPreview={false}
      onSelectScene={select}
      onEditScene={edit}
    />,
  );
  const details = container.querySelector("details")!;
  details.open = true;
  fireEvent.click(
    screen.getByRole("menuitem", {
      name: "Редактировать сцену «Вторая сцена»",
    }),
  );
  expect(edit).toHaveBeenCalledWith("two");
  expect(select).not.toHaveBeenCalled();
  expect(details.open).toBe(false);
  expect(container.querySelector("button button")).toBeNull();
  expect(container.querySelector("summary")).toHaveFocus();
});
it("supports keyboard movement between selection and its independent edit action", () => {
  renderComponent(
    <ScenePicker
      activeScene={scenes[0]}
      scenes={scenes}
      assets={[]}
      tokens={[]}
      isGm
      isPreview={false}
      onSelectScene={vi.fn()}
      onEditScene={vi.fn()}
    />,
  );
  screen
    .getByLabelText("Выбрать просматриваемую сцену")
    .closest("details")!.open = true;
  const option = screen.getByRole("menuitemradio", { name: /Первая сцена/ });
  option.focus();
  fireEvent.keyDown(option, { key: "ArrowDown" });
  expect(
    screen.getByRole("menuitem", {
      name: "Редактировать сцену «Первая сцена»",
    }),
  ).toHaveFocus();
});
it("keeps players and player previews read-only", () => {
  const { container } = renderComponent(
    <ScenePicker
      activeScene={scenes[0]}
      scenes={scenes}
      assets={[]}
      tokens={[]}
      isGm={false}
      isPreview={false}
      onSelectScene={vi.fn()}
      onEditScene={vi.fn()}
    />,
  );
  expect(container.querySelector("button")).toBeNull();
  expect(screen.getByLabelText("Активная сцена")).toHaveTextContent(
    "Первая сцена",
  );
});
