import type { CharacterDto } from "@arken/contracts";
import { arkenSystem } from "@arken/system";
import { Button } from "@gravity-ui/uikit";
import { formulaBonus } from "../activity-roll-controls";
import { useWorkspaceWindow } from "../ui/useWorkspaceWindow";

/**
 * Floating, draggable quick-roll tray (UIX-363). Reuses the same
 * `useWorkspaceWindow` drag/clamp mechanics as `ArkenDialog`'s workspace
 * variant so the panel can never be dragged fully off-screen, and matches
 * its drag-handle visual convention (grip row above the content).
 */
export function QuickRollPanel({
  rollCharacter,
  quickRollPending,
  onQuickRoll,
}: {
  rollCharacter: CharacterDto;
  quickRollPending: boolean;
  onQuickRoll: (formula: string, label: string, bonus: number) => void;
}) {
  const {
    setWindowElement,
    position,
    zIndex,
    bringToFront,
    onDragStart,
    onDragMove,
    stopDragging,
    resetLayout,
  } = useWorkspaceWindow(true);

  return (
    <section
      ref={setWindowElement}
      className="quick-roll-panel"
      aria-label="Панель быстрых бросков"
      data-positioned={position ? "true" : "false"}
      style={{
        ...(position ?? {}),
        zIndex,
      }}
      onPointerDown={bringToFront}
      onFocusCapture={bringToFront}
    >
      <div
        className="quick-roll-panel__handle"
        role="group"
        aria-label="Перетащить панель быстрых бросков"
        title="Перетащить панель быстрых бросков"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <span className="quick-roll-panel__grip" aria-hidden="true">
          ⠿
        </span>
        {position ? (
          <button
            type="button"
            className="quick-roll-panel__reset"
            onClick={resetLayout}
            aria-label="Сбросить расположение панели"
            title="Сбросить расположение панели"
          >
            ↺
          </button>
        ) : null}
      </div>
      <div className="activity-quick-rolls">
        <Button
          disabled={quickRollPending}
          onClick={() =>
            onQuickRoll(
              "1d20 + agility",
              "Инициатива",
              rollCharacter.stats.agility ?? 0,
            )
          }
        >
          Инициатива
        </Button>
        {arkenSystem.stats.map((stat) => (
          <Button
            key={stat.key}
            disabled={quickRollPending}
            onClick={() =>
              onQuickRoll(
                `1d20 + ${stat.key}`,
                stat.label,
                rollCharacter.stats[stat.key] ?? stat.defaultValue,
              )
            }
          >
            {stat.label}
          </Button>
        ))}
        {rollCharacter.skills.map((skill) => (
          <Button
            key={skill.key}
            disabled={quickRollPending}
            onClick={() =>
              onQuickRoll(
                skill.formula,
                skill.name,
                formulaBonus(skill.formula, rollCharacter.stats),
              )
            }
          >
            {skill.name}
          </Button>
        ))}
      </div>
    </section>
  );
}
