// @vitest-environment jsdom
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { renderComponent, screen } from "./test-support/render";
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

it("gives native request selects exact labels without option text", () => {
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

  for (const name of ["Когда", "Кто увидит", "Персонаж (необязательно)"]) {
    const control = screen.getByRole<HTMLSelectElement>("combobox", { name });
    expect(control).toHaveAccessibleName(name);
    expect(control.labels).toHaveLength(1);
    expect(control.labels![0]!.textContent?.trim()).toBe(name);
    expect(screen.getByLabelText(name, { exact: true })).toBe(control);
  }
});
