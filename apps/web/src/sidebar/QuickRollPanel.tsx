import type { CharacterDto } from "@arken/contracts";
import { arkenSystem } from "@arken/system";
import { Button } from "@gravity-ui/uikit";
import { formulaBonus } from "../activity-roll-controls";

/**
 * Plain, non-draggable character-stat quick-roll panel (UIX-387). Previously
 * (UIX-363) this was made a floating/draggable window via
 * `useWorkspaceWindow`, but that misread the request -- the physical dice
 * tray was meant to become sidebar-resident instead (see
 * `sidebar/DiceTrayPanel.tsx`). This is back to a normal sidebar section.
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
  return (
    <section className="quick-roll-panel" aria-label="Панель быстрых бросков">
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
