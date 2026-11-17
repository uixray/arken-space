// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";

vi.mock("./ui/ArkenDialog", () => ({ ArkenDialog: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("./use-creation-session", () => ({
  useCreationSession: () => ({ pending: null, busy: false, locked: false, refresh: vi.fn() }),
  useCreationQuery: () => ({ data: { items: [] }, loading: false, error: null }),
}));
vi.mock("./CreationStudio", () => ({ CreationStudio: () => null }));
vi.mock("./CreationObjects", () => ({ CreationObjects: () => <label>Черновик объекта<input /></label> }));
vi.mock("./CreationStore", () => ({ CreationStore: () => null }));
vi.mock("./CreationManager", () => ({ CreationManager: () => null }));
vi.mock("./CreationParts", () => ({ CreationMaterialNames: ({ children }: { children: ReactNode }) => <>{children}</>, QueryState: () => null }));
const { CreationWorkspace } = await import("./CreationWorkspace");

afterEach(() => vi.restoreAllMocks());

it("protects an unsaved object form when switching characters", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  const characters = [{ id: "a", name: "А" }, { id: "b", name: "Б" }] as Parameters<typeof CreationWorkspace>[0]["characters"];
  renderComponent(<CreationWorkspace campaignId="c" membershipId="m" gm={false} characters={characters} onClose={() => {}} />);
  const selector = screen.getByRole("combobox", { name: "Персонаж для предметов, материалов и покупок" }) as HTMLSelectElement;
  await user.selectOptions(selector, "b");
  expect(confirm).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Объекты и развитие" }));
  await user.type(screen.getByRole("textbox", { name: "Черновик объекта" }), "черновик");
  await user.selectOptions(selector, "a");
  expect(confirm).toHaveBeenCalledOnce();
  expect(selector.value).toBe("b");
  expect((screen.getByRole("textbox", { name: "Черновик объекта" }) as HTMLInputElement).value).toBe("черновик");
  confirm.mockReturnValue(true);
  await user.selectOptions(selector, "a");
  expect(selector.value).toBe("a");
  expect((screen.getByRole("textbox", { name: "Черновик объекта" }) as HTMLInputElement).value).toBe("");
});
