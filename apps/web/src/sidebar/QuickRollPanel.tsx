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
  gmOnly,
  onQuickRoll,
}: {
  rollCharacter: CharacterDto;
  quickRollPending: boolean;
  /**
   * Mirrors the dice tray's shared GM-only toggle (see `ActivityPanel`). The
   * control itself lives next door, so without this the player would have no
   * way to tell from here that a stat roll is about to go only to the GM.
   */
  gmOnly: boolean;
  onQuickRoll: (formula: string, label: string, bonus: number) => void;
}) {
  return (
    <section className="quick-roll-panel" aria-label="Панель быстрых бросков">
      {gmOnly && (
        <p className="quick-roll-panel__gm-only" role="status">
          <span aria-hidden="true">◆</span> Броски уйдут только мастеру
        </p>
      )}
      <div className="activity-quick-rolls">
        {/* UIX-424: «Инициатива» больше не отдельная кнопка поверх броска на
         * ловкость — это настоящая характеристика раскладки, и кнопка на неё
         * приходит из списка ниже. Оставить обе значило бы дать две кнопки с
         * одной подписью и разными числами. */}
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
