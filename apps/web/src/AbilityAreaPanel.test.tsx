// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fireEvent, renderComponent, screen } from "./test-support/render";
import { AbilityAreaPanel } from "./AbilityAreaPanel";

it("does not cancel a draft when Escape originates in the native origin selector", () => {
  const cancel = vi.fn();
  const area = {
    draft: {
      id: "draft",
      name: "Лучезарный",
      radiusMeters: 15,
      tokenId: "one",
      request: null,
      consumesItem: false,
    },
    tokens: [{ id: "one", name: "Герой", x: 0, y: 0 }],
    canCancel: true,
    canConfirm: true,
    pending: false,
    cancel,
    confirm: vi.fn(),
    selectOrigin: vi.fn(),
  } as unknown as Parameters<typeof AbilityAreaPanel>[0]["area"];
  renderComponent(
    <>
      <AbilityAreaPanel area={area} isGm={false} />
      <section role="dialog" aria-label="Другое окно">
        <button type="button">Другое действие</button>
      </section>
    </>,
  );
  fireEvent.keyDown(
    screen.getByRole("combobox", { name: "Фигурка применяющего" }),
    { key: "Escape" },
  );
  expect(cancel).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("button", { name: "Другое действие" }), {
    key: "Escape",
  });
  expect(cancel).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("heading", { name: /Лучезарный/ }), {
    key: "Escape",
  });
  expect(cancel).toHaveBeenCalledOnce();
});
