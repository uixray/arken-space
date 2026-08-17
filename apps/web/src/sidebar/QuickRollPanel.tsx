import { useState } from "react";
import type { CharacterDto } from "@arken/contracts";
import { STAT_VALUE_RANGE } from "@arken/system";
import { Button } from "@gravity-ui/uikit";
import { formulaBonus } from "../activity-roll-controls";
import { usePanelResize } from "../use-panel-resize";
import {
  readQuickRollsCollapsed,
  writeQuickRollsCollapsed,
} from "../quick-rolls-preference";
import { ROLL_MODIFIER_HINT, rollModeFromEvent } from "../roll-modifier-keys";
import type { RollMode } from "../roll-mode";

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
  onQuickRoll: (
    formula: string,
    label: string,
    bonus: number,
    mode: RollMode,
  ) => void;
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
  /**
   * UIX-475: блок сворачивается.
   *
   * Кнопок здесь столько, сколько строк в раскладке кампании плюс навыки
   * персонажа, — на боевой раскладке это половина колонки, и вне боя она занята
   * тем, чем не пользуются. Свёрнутый блок отдаёт место ленте.
   *
   * Состояние помнится: сворачивают его не на минуту, а на весь стиль игры.
   */
  const [collapsed, setCollapsed] = useState(() =>
    readQuickRollsCollapsed(window.localStorage, membershipId),
  );

  return (
    <section
      className={`quick-roll-panel${collapsed ? " is-collapsed" : ""}`}
      aria-label="Панель быстрых бросков"
      // Свёрнутому блоку заданная высота не нужна: он занимает свою строку.
      style={height != null && !collapsed ? { height } : undefined}
    >
      <button
        type="button"
        className="quick-roll-panel__toggle"
        aria-expanded={!collapsed}
        title={collapsed ? "Развернуть броски" : "Свернуть броски"}
        onClick={() => {
          const next = !collapsed;
          setCollapsed(next);
          writeQuickRollsCollapsed(window.localStorage, membershipId, next);
        }}
      >
        <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        Броски характеристик
      </button>
      {/* Прокручивается содержимое, а не панель целиком: иначе ручка уезжает
       * из виду ровно тогда, когда до неё хотят дотянуться. */}
      <div className="quick-roll-panel__body" hidden={collapsed}>
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
              title={`${stat.label} · ${ROLL_MODIFIER_HINT}`}
              onClick={(event) =>
                onQuickRoll(
                  `1d20 + ${stat.key}`,
                  stat.label,
                  rollCharacter.stats[stat.key] ??
                    STAT_VALUE_RANGE.defaultValue,
                  rollModeFromEvent(event.nativeEvent),
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
              title={`${skill.name} · ${ROLL_MODIFIER_HINT}`}
              onClick={(event) =>
                onQuickRoll(
                  skill.formula,
                  skill.name,
                  formulaBonus(skill.formula, rollCharacter.stats),
                  rollModeFromEvent(event.nativeEvent),
                )
              }
            >
              {skill.name}
            </Button>
          ))}
        </div>
      </div>
      {!collapsed && (
        <button
          type="button"
          className="panel-resize-handle"
          aria-label="Изменить высоту панели быстрых бросков"
          title="Перетащите, чтобы изменить высоту панели быстрых бросков"
          {...handleProps}
        />
      )}
    </section>
  );
}
