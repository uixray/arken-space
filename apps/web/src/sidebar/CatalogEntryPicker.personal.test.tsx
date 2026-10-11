// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CatalogEntryPicker } from "./CatalogEntryPicker";

vi.mock("../ui/ArkenDialog", () => ({ ArkenDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../CatalogEntryForm", () => ({ CatalogEntryForm: ({ onSubmit }: { onSubmit: (input: unknown) => Promise<void> }) => <button onClick={() => void onSubmit({ kind: "ABILITY", name: "Личная способность", description: "", data: {} })}>Сохранить личную запись</button> }));
afterEach(cleanup);

it("closes after personal creation without assigning a nonexistent shared catalog entry", async () => {
  const onCreate = vi.fn().mockResolvedValue({ id: "personal-entry" });
  const onAssign = vi.fn();
  const onClose = vi.fn();
  render(<CatalogEntryPicker open kind="ABILITY" options={[]} statLabels={{}} resourceLabels={{ physical: "Физический", magic: "Магический" }} createAlreadyAssigned onCreate={onCreate} onAssign={onAssign} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Создать новую запись" }));
  fireEvent.click(screen.getByRole("button", { name: "Сохранить личную запись" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onAssign).not.toHaveBeenCalled();
});
