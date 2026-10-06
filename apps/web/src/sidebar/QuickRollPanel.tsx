import "./roll-controls.css";
import { useId, useState, type ReactElement, type ReactNode } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import type { CharacterCatalogEntryDto, CharacterDto } from "@arken/contracts";
import { STAT_VALUE_RANGE } from "@arken/system";
import { Button } from "../design-system/Button";
import { formulaBonus } from "../activity-roll-controls";
import { usePanelResize } from "../use-panel-resize";
import {
  readQuickRollsCollapsed,
  writeQuickRollsCollapsed,
} from "../quick-rolls-preference";
import { rollModeFromEvent } from "../roll-modifier-keys";
import type { RollMode } from "../roll-mode";
import { AppIcon } from "../ui/AppIcon";
import {
  CollapseSectionIcon,
  ExpandSectionIcon,
  SecretRollIcon,
} from "../ui/icons";
import { useRepeatRoll } from "./use-repeat-roll";

const signedBonus = (bonus: number) =>
  new Intl.NumberFormat("en-US", { signDisplay: "always" }).format(bonus);

function QuickRollTooltip({
  content,
  trigger,
}: {
  content: string;
  trigger: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger delay={250} render={trigger} />
      <Tooltip.Portal>
        <Tooltip.Positioner
          side="top"
          sideOffset={8}
          collisionPadding={8}
          className="quick-roll-tooltip-positioner"
        >
          <Tooltip.Popup className="quick-roll-tooltip" role="tooltip">
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

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
  physicalDiceControl,
  onQuickRoll,
  onEntryAction,
}: {
  rollCharacter: CharacterDto;
  campaignId: string;
  membershipId: string;
  /**
   * UIX-424: строки раскладки **кампании**, а не стартовой. Панель строилась
   * из `arkenSystem.stats`, и характеристика, добавленная мастером, кнопки не
   * получала: карточка её показывала, панель — нет.
   */
  rows: readonly { key: string; label: string; group?: string }[];
  quickRollPending: boolean;
  /**
   * Mirrors the dice tray's shared GM-only toggle (see `ActivityPanel`). The
   * control itself lives next door, so without this the player would have no
   * way to tell from here that a stat roll is about to go only to the GM.
   */
  gmOnly: boolean;
  physicalDiceControl?: ReactNode;
  onQuickRoll: (
    formula: string,
    label: string,
    bonus: number,
    mode: RollMode,
    count?: number,
  ) => void;
  onEntryAction?: (
    entry: CharacterCatalogEntryDto,
    mode: "EXECUTE" | "SHARE",
    rollActionId?: string,
  ) => Promise<void>;
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
  const tabsId = useId();
  const [activeTab, setActiveTab] = useState("stats");
  const [entryPending, setEntryPending] = useState<string | null>(null);
  const [entryError, setEntryError] = useState("");
  const { onRollClick, popover } = useRepeatRoll();
  const entries = rollCharacter.entries ?? [];
  const ordinaryRows = rows.filter(
    (row) => !row.group || row.group === "characteristics",
  );
  const combatRows = rows.filter((row) => row.group === "combat");
  const otherRows = rows.filter(
    (row) => row.group && !["characteristics", "combat"].includes(row.group),
  );
  const submitEntry = async (
    entry: CharacterCatalogEntryDto,
    mode: "EXECUTE" | "SHARE",
    rollActionId?: string,
  ) => {
    if (!onEntryAction || entryPending) return;
    setEntryPending(entry.id);
    setEntryError("");
    try {
      // Description-only entries have no executable roll. Match the character
      // card: post their description without consuming uses or resources.
      await onEntryAction(
        entry,
        mode === "EXECUTE" && !rollActionId ? "SHARE" : mode,
        rollActionId,
      );
    } catch (reason) {
      setEntryError(
        reason instanceof Error
          ? reason.message
          : "Не удалось отправить действие.",
      );
    } finally {
      setEntryPending(null);
    }
  };
  const statButtons = (
    groupRows: typeof rows,
    variant: "ordinary" | "combat" | "skill" = "ordinary",
  ) =>
    groupRows.map((stat) => (
      <QuickRollTooltip
        key={stat.key}
        content={`1d20${signedBonus(rollCharacter.stats[stat.key] ?? STAT_VALUE_RANGE.defaultValue)}\nCtrl — Преимущество\nAlt — Помеха`}
        trigger={
          <Button
            className={`quick-roll-button quick-roll-button--${variant}`}
            disabled={quickRollPending}
            onClick={(event) => {
              const mode = rollModeFromEvent(event.nativeEvent);
              onRollClick(event, (count) =>
                onQuickRoll(
                  `1d20 + ${stat.key}`,
                  stat.label,
                  rollCharacter.stats[stat.key] ??
                    STAT_VALUE_RANGE.defaultValue,
                  mode,
                  count,
                ),
              );
            }}
          >
            {stat.label}
          </Button>
        }
      />
    ));

  return (
    <section
      className={`quick-roll-panel${collapsed ? " is-collapsed" : ""}`}
      aria-label="Панель быстрых бросков"
      // Свёрнутому блоку заданная высота не нужна: он занимает свою строку.
      style={height != null && !collapsed ? { height } : undefined}
    >
      {popover}
      <div className="quick-roll-panel__header">
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
          <AppIcon icon={collapsed ? ExpandSectionIcon : CollapseSectionIcon} />
          Статы и скилы
        </button>
        {physicalDiceControl}
      </div>
      {/* Прокручивается содержимое, а не панель целиком: иначе ручка уезжает
       * из виду ровно тогда, когда до неё хотят дотянуться. */}
      <div className="quick-roll-panel__body" hidden={collapsed}>
        {gmOnly && (
          <p className="quick-roll-panel__gm-only" role="status">
            <AppIcon icon={SecretRollIcon} /> Броски уйдут только мастеру
          </p>
        )}
        <div
          className="quick-roll-panel__tabs"
          role="tablist"
          aria-label="Тип быстрых бросков"
        >
          {["stats", "abilities"].map((tab) => (
            <button
              type="button"
              role="tab"
              key={tab}
              id={`${tabsId}-${tab}`}
              aria-controls={`${tabsId}-${tab}-panel`}
              tabIndex={activeTab === tab ? 0 : -1}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "stats"
                    : event.key === "End"
                      ? "abilities"
                      : tab === "stats"
                        ? "abilities"
                        : "stats";
                setActiveTab(next);
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(`[id="${tabsId}-${next}"]`)
                  ?.focus();
              }}
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "stats" ? "Характеристики" : "Способности"}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`${tabsId}-stats-panel`}
          aria-labelledby={`${tabsId}-stats`}
          hidden={activeTab !== "stats"}
        >
          <div className="activity-quick-rolls" aria-busy={quickRollPending}>
            {statButtons(ordinaryRows, "ordinary")}
            {statButtons(combatRows, "combat")}
            {statButtons(otherRows, "ordinary")}
          </div>
        </div>
        <div
          role="tabpanel"
          id={`${tabsId}-abilities-panel`}
          aria-labelledby={`${tabsId}-abilities`}
          hidden={activeTab !== "abilities"}
        >
          {(rollCharacter.skills.length > 0 ||
            entries.some((entry) => entry.kind === "SKILL")) && (
            <div className="activity-quick-rolls" aria-busy={quickRollPending}>
              {rollCharacter.skills.map((skill) => (
                <QuickRollTooltip
                  key={skill.key}
                  content={`${skill.formula}\nCtrl — Преимущество\nAlt — Помеха`}
                  trigger={
                    <Button
                      className="quick-roll-button quick-roll-button--skill"
                      disabled={quickRollPending}
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
                  }
                />
              ))}
              {entries
                .filter((entry) => entry.kind === "SKILL")
                .map((entry) => (
                  <div className="quick-roll-panel__entry" key={entry.id}>
                    <Button
                      disabled={entryPending !== null || !onEntryAction}
                      onClick={() =>
                        void submitEntry(
                          entry,
                          "EXECUTE",
                          entry.data.rollActions?.[0]?.id,
                        )
                      }
                    >
                      {entry.name}
                    </Button>
                    <button
                      type="button"
                      disabled={entryPending !== null || !onEntryAction}
                      aria-label={`Показать без выполнения: ${entry.name}`}
                      title="Показать описание без выполнения и расхода"
                      onClick={() => void submitEntry(entry, "SHARE")}
                    >
                      i
                    </button>
                  </div>
                ))}
            </div>
          )}
          {entries.some((entry) => entry.kind === "ABILITY") && (
            <div
              className="activity-quick-rolls"
              aria-busy={entryPending !== null}
            >
              {entries
                .filter((entry) => entry.kind === "ABILITY")
                .map((entry) => (
                  <div className="quick-roll-panel__entry" key={entry.id}>
                    <Button
                      disabled={entryPending !== null || !onEntryAction}
                      onClick={() =>
                        void submitEntry(
                          entry,
                          "EXECUTE",
                          entry.data.rollActions?.[0]?.id,
                        )
                      }
                    >
                      {entry.name}
                    </Button>
                    <button
                      type="button"
                      disabled={entryPending !== null || !onEntryAction}
                      aria-label={`Показать без выполнения: ${entry.name}`}
                      title="Показать описание без выполнения и расхода"
                      onClick={() => void submitEntry(entry, "SHARE")}
                    >
                      i
                    </button>
                  </div>
                ))}
            </div>
          )}
          {rollCharacter.skills.length === 0 &&
            !entries.some((entry) =>
              ["SKILL", "ABILITY"].includes(entry.kind),
            ) && <p className="muted">Нет навыков и способностей.</p>}
        </div>
        {entryError && <p role="alert">{entryError}</p>}
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
