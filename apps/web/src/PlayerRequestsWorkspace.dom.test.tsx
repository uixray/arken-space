// @vitest-environment jsdom
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, renderComponent, screen } from "./test-support/render";
import { playerSnapshot } from "./test-support/game-snapshot-fixtures";
import { PlayerRequestsWorkspace } from "./PlayerRequestsWorkspace";

vi.mock("./ui/ArkenDialog", () => ({
  ArkenDialog: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
  }) =>
    open ? (
      <section role="dialog" aria-label={title}>
        {children}
      </section>
    ) : null,
}));

it("keeps native request field labels exact after controlled draft rerenders", () => {
  renderComponent(
    <PlayerRequestsWorkspace
      open
      snapshot={playerSnapshot()}
      onClose={() => {}}
      onCreate={async () => {}}
      onUpdate={async () => {}}
      onAction={async () => {}}
    />,
  );

  const title = screen.getByLabelText<HTMLInputElement>("Название", {
    exact: true,
  });
  const description = screen.getByLabelText<HTMLTextAreaElement>("Описание", {
    exact: true,
  });
  fireEvent.change(description, { target: { value: "Черновик описания" } });
  fireEvent.change(title, { target: { value: "Черновик названия" } });

  expect(screen.getByLabelText("Название", { exact: true })).toBe(title);
  expect(screen.getByLabelText("Описание", { exact: true })).toBe(description);
  expect(title).toHaveValue("Черновик названия");
  expect(description).toHaveValue("Черновик описания");
  expect(description).toHaveAccessibleName("Описание");
  expect(description.labels).toHaveLength(1);
  expect(description.labels![0]!.textContent?.trim()).toBe("Описание");

  for (const name of ["Когда", "Кто увидит", "Персонаж (необязательно)"]) {
    const control = screen.getByRole<HTMLSelectElement>("combobox", { name });
    expect(control).toHaveAccessibleName(name);
    expect(control.labels).toHaveLength(1);
    expect(control.labels![0]!.textContent?.trim()).toBe(name);
    expect(screen.getByLabelText(name, { exact: true })).toBe(control);
  }
});
