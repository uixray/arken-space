// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CharacterDto } from "@arken/contracts";
import { renderComponent, screen } from "../test-support/render";
import { DiceTrayPanel } from "./DiceTrayPanel";
import { QuickRollPanel } from "./QuickRollPanel";

/**
 * UIX-455 — ручка высоты стоит там, где в неё упираются.
 *
 * Проверяется размещение, а не механика перетаскивания: перетаскивание общее
 * (`use-panel-resize`), а ошибка задачи была именно в том, у какой панели ручка
 * висит. Границы и хранение проверяет `panel-height-preference.test.ts`.
 */
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    disabled,
    onClick,
    children,
  }: {
    disabled?: boolean;
    onClick?: () => void;
    children?: ReactNode;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onClick?.()}>
      {children}
    </button>
  ),
}));

vi.mock("../RollModeControl", () => ({
  RollModeControl: () => <div />,
}));
vi.mock("../ui/TextPromptDialog", () => ({
  TextPromptDialog: () => null,
}));

const character = {
  id: "c1",
  name: "Ллойд",
  stats: { strength: 3 },
  skills: [{ key: "melee", name: "Ближний бой", rank: 0, formula: "1d20 + 3" }],
  resources: {},
} as unknown as CharacterDto;

describe("ручка изменения высоты", () => {
  it("есть у панели быстрых бросков", () => {
    // Там список растёт вместе с раскладкой кампании и навыками персонажа —
    // именно в него упираются по ходу игры.
    renderComponent(
      <QuickRollPanel
        rollCharacter={character}
        campaignId="camp"
        membershipId="mem"
        rows={[{ key: "initiative", label: "Инициатива" }]}
        quickRollPending={false}
        gmOnly={false}
        onQuickRoll={() => {}}
      />,
    );
    expect(
      screen.getByLabelText("Изменить высоту панели быстрых бросков"),
    ).toBeTruthy();
  });

  it("отсутствует у панели костей", () => {
    // Кнопок там ровно семь костей плюс два переключателя: высота не зависит
    // от содержимого, и тянуть было нечего.
    renderComponent(
      <DiceTrayPanel
        characterId="c1"
        visibility="PUBLIC"
        onVisibilityChange={() => {}}
        onRoll={async () => {}}
      />,
    );
    expect(document.querySelector(".panel-resize-handle")).toBeNull();
    expect(document.querySelector(".dice-tray-resize-handle")).toBeNull();
  });

  it("прокручивает содержимое, а не панель целиком", () => {
    // Иначе ручка уезжает из виду ровно тогда, когда до неё тянутся.
    renderComponent(
      <QuickRollPanel
        rollCharacter={character}
        campaignId="camp"
        membershipId="mem"
        rows={[{ key: "initiative", label: "Инициатива" }]}
        quickRollPending={false}
        gmOnly={false}
        onQuickRoll={() => {}}
      />,
    );
    const panel = document.querySelector(".quick-roll-panel");
    const body = panel?.querySelector(".quick-roll-panel__body");
    expect(body).toBeTruthy();
    expect(
      body?.contains(document.querySelector(".activity-quick-rolls")),
    ).toBe(true);
    expect(
      panel?.lastElementChild?.classList.contains("panel-resize-handle"),
    ).toBe(true);
  });
});
