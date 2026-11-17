// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
vi.mock("./CreationRules", () => ({ CreationRules: () => null }));
vi.mock("./use-creation-session", () => ({
  useCreationQuery: () => ({ data: { recipes: [], drafts: [] }, loading: false, error: "" }),
  useCreationPage: () => ({ data: { items: [] }, loading: false, error: "", hasPrevious: false, next: vi.fn(), first: vi.fn() }),
}));
const { CreationManager } = await import("./CreationManager");
it("keeps an unfinished recipe when the master cancels switching", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  renderComponent(<CreationManager session={{ busy: false, locked: false } as never} packs={[]} active />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Рецепты мастерской" }));
  const name = screen.getByLabelText("Название", { exact: true });
  await user.type(name, "Черновик");
  await user.click(screen.getByRole("button", { name: "Новый рецепт" }));
  expect(name).toHaveValue("Черновик");
  await user.click(screen.getByRole("button", { name: "Новый рецепт" }));
  expect(name).toHaveValue("");
  expect(confirm).toHaveBeenCalledTimes(2);
  confirm.mockRestore();
});
