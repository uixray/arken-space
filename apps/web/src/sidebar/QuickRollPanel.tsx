import type { CharacterDto } from "@arken/contracts";
import { STAT_VALUE_RANGE } from "@arken/system";
import { Button } from "@gravity-ui/uikit";
import { formulaBonus } from "../activity-roll-controls";
import { usePanelResize } from "../use-panel-resize";

/**
 * Plain, non-draggable character-stat quick-roll panel (UIX-387). Previously
 * (UIX-363) this was made a floating/draggable window via
 * `useWorkspaceWindow`, but that misread the request -- the physical dice
 * tray was meant to become sidebar-resident instead (see
 * `sidebar/DiceTrayPanel.tsx`). This is back to a normal sidebar section.
 */
export function QuickRollPanel({
  rollCharacter,
  campaignId,
  membershipId,
  rows,
  quickRollPending,
  gmOnly,
  onQuickRoll,
}: {
  rollCharacter: CharacterDto;
  campaignId: string;
  membershipId: string;
  /**
   * UIX-424: строки раскладки **кампании**, а не стартовой. Панель строилась
   * из `arkenSystem.stats`, и характеристика, добавленная мастером, кнопки не
   * получала: карточка её показывала, панель — нет.
   */
  rows: readonly { key: string; label: string }[];
  quickRollPending: boolean;
  /**
   * Mirrors the dice tray's shared GM-only toggle (see `ActivityPanel`). The
   * control itself lives next door, so without this the player would have no
   * way to tell from here that a stat roll is about to go only to the GM.
   */
  gmOnly: boolean;
  onQuickRoll: (formula: string, label: string, bonus: number) => void;
}) {
  /**
   * UIX-455: ручка высоты живёт здесь, а не у костей. Кнопок тут столько,
   * сколько строк в раскладке кампании плюс навыки персонажа, — список растёт
   * по ходу игры, и упереться в него можно по-настоящему.
   */
  const { height, handleProps } = usePanelResize({
    panel: "quickRolls",
    blockClassName: "quick-roll-panel",
    campaignId,
    membershipId,
  });
  return (
    <section
      className="quick-roll-panel"
      aria-label="Панель быстрых бросков"
      style={height != null ? { height } : undefined}
    >
      {/* Прокручивается содержимое, а не панель целиком: иначе ручка уезжает
       * из виду ровно тогда, когда до неё хотят дотянуться. */}
      <div className="quick-roll-panel__body">
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
          {rows.map((stat) => (
            <Button
              key={stat.key}
              disabled={quickRollPending}
              onClick={() =>
                onQuickRoll(
                  `1d20 + ${stat.key}`,
                  stat.label,
                  rollCharacter.stats[stat.key] ??
                    STAT_VALUE_RANGE.defaultValue,
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
      </div>
      <button
        type="button"
        className="panel-resize-handle"
        aria-label="Изменить высоту панели быстрых бросков"
        title="Перетащите, чтобы изменить высоту панели быстрых бросков"
        {...handleProps}
      />
    </section>
  );
}
