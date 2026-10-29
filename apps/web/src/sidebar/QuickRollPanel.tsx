import "./roll-controls.css";
import "./bugpool-ui2.css";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { createPortal } from "react-dom";
import type { CharacterCatalogEntryDto, CharacterDto } from "@arken/contracts";
import { STAT_VALUE_RANGE } from "@arken/system";
import { Button } from "../design-system/Button";
import { CatalogActionIcon } from "../CatalogActionIcon";
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
  DiceTrayIcon,
  ExpandSectionIcon,
  SecretRollIcon,
  PreparedActionIcon,
} from "../ui/icons";
import { useRepeatRoll } from "./use-repeat-roll";

const signedBonus = (bonus: number) =>
  new Intl.NumberFormat("en-US", { signDisplay: "always" }).format(bonus);

type PreparedCatalogAction = {
  scope: string;
  id: string;
  entryId: string;
  entryRevision: number;
  actionId?: string;
  intent:
    | "SIMPLE_SKILL"
    | "ROLL_ACTION"
    | "ABILITY_ACTIVATION"
    | "ABILITY_EXECUTE_ALL";
  label: string;
};

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
  canControlCharacter = false,
  gmOnly,
  physicalDiceControl,
  preparedActionTarget,
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
  canControlCharacter?: boolean;
  /**
   * Mirrors the dice tray's shared GM-only toggle (see `ActivityPanel`). The
   * control itself lives next door, so without this the player would have no
   * way to tell from here that a stat roll is about to go only to the GM.
   */
  gmOnly: boolean;
  physicalDiceControl?: ReactNode;
  preparedActionTarget?: HTMLElement | null;
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
    executeAll?: true,
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
  const entryPendingRef = useRef(false);
  const [entryError, setEntryError] = useState("");
  const [preparedAction, setPreparedAction] =
    useState<PreparedCatalogAction | null>(null);
  const { onRollClick, popover } = useRepeatRoll();
  const entries = rollCharacter.entries ?? [];
  const ordinaryRows = rows.filter(
    (row) => !row.group || row.group === "characteristics",
  );
  const combatRows = rows.filter((row) => row.group === "combat");
  // UIX-766: skills are stat-like quick rolls, not ability activations.
  const skillRows = rows.filter((row) => row.group === "skills");
  const skillEntries = entries.filter((entry) => entry.kind === "SKILL");
  const abilityEntries = entries.filter((entry) => entry.kind === "ABILITY");
  const draftScope = `${campaignId}:${membershipId}:${rollCharacter.id}`;
  const draftScopeRef = useRef(draftScope);
  useLayoutEffect(() => {
    draftScopeRef.current = draftScope;
  }, [draftScope]);
  useEffect(() => {
    setPreparedAction(null);
  }, [draftScope]);
  const otherRows = rows.filter(
    (row) =>
      row.group && !["characteristics", "combat", "skills"].includes(row.group),
  );
  const submitEntry = async (
    entry: CharacterCatalogEntryDto,
    mode: "EXECUTE" | "SHARE",
    rollActionId?: string,
    executeAll = false,
  ): Promise<boolean> => {
    if (!onEntryAction || entryPendingRef.current) return false;
    entryPendingRef.current = true;
    setEntryPending(entry.id);
    setEntryError("");
    try {
      // A no-roll ability is still an activation. Only description-only skills
      // fall back to the explicit, no-cost SHARE path.
      await onEntryAction(
        entry,
        mode === "EXECUTE" &&
          !rollActionId &&
          !executeAll &&
          entry.kind !== "ABILITY" &&
          !Number.isFinite(entry.data.skillValue)
          ? "SHARE"
          : mode,
        rollActionId,
        executeAll ? true : undefined,
      );
      return true;
    } catch (reason) {
      setEntryError(
        reason instanceof Error
          ? reason.message
          : "Не удалось отправить действие.",
      );
      return false;
    } finally {
      entryPendingRef.current = false;
      setEntryPending(null);
    }
  };
  const prepareEntryAction = (
    entry: CharacterCatalogEntryDto,
    intent: PreparedCatalogAction["intent"],
    actionId?: string,
    label = entry.name,
  ) => {
    if (!canControlCharacter) return;
    setPreparedAction({
      scope: draftScope,
      id: `${entry.id}:${intent}:${actionId ?? "simple"}:${Date.now()}`,
      entryId: entry.id,
      entryRevision: entry.revision,
      actionId,
      intent,
      label,
    });
  };
  const preparedEntry =
    preparedAction?.scope === draftScope
      ? entries.find((entry) => entry.id === preparedAction.entryId)
      : undefined;
  const preparedIsCurrent = Boolean(
    preparedAction &&
    preparedEntry &&
    preparedEntry.revision === preparedAction.entryRevision &&
    (preparedAction.intent === "SIMPLE_SKILL"
      ? preparedEntry.kind === "SKILL" &&
        Number.isInteger(preparedEntry.data.skillValue)
      : preparedAction.intent === "ABILITY_ACTIVATION"
        ? preparedEntry.kind === "ABILITY" &&
          !preparedEntry.data.rollActions?.length
        : preparedAction.intent === "ABILITY_EXECUTE_ALL"
          ? preparedEntry.kind === "ABILITY" &&
            Boolean(preparedEntry.data.rollActions?.length)
          : preparedEntry.data.rollActions?.some(
              (action) => action.id === preparedAction.actionId,
            )),
  );
  const executePreparedAction = async () => {
    if (
      !preparedAction ||
      !preparedEntry ||
      !preparedIsCurrent ||
      !canControlCharacter
    )
      return;
    const submitted = preparedAction;
    const submittedScope = draftScope;
    const success = await submitEntry(
      preparedEntry,
      "EXECUTE",
      submitted.intent === "ROLL_ACTION" ? submitted.actionId : undefined,
      submitted.intent === "ABILITY_EXECUTE_ALL",
    );
    if (success && draftScopeRef.current === submittedScope) {
      setPreparedAction((current) =>
        current?.id === submitted.id ? null : current,
      );
    }
  };
  const statButtons = (
    groupRows: typeof rows,
    variant: "ordinary" | "combat" | "skill" = "ordinary",
  ) =>
    groupRows.map((stat) => {
      const statValue = rollCharacter.stats[stat.key];
      const hasVisibleValue =
        typeof statValue === "number" && Number.isFinite(statValue);
      return (
        <QuickRollTooltip
          key={stat.key}
          content={`1d20${signedBonus(statValue ?? STAT_VALUE_RANGE.defaultValue)}\nCtrl — Преимущество\nAlt — Помеха`}
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
                    statValue ?? STAT_VALUE_RANGE.defaultValue,
                    mode,
                    count,
                  ),
                );
              }}
            >
              <span className="quick-roll-button__name">
                <AppIcon icon={DiceTrayIcon} />
                {stat.label}
              </span>
              {hasVisibleValue && (
                <span className="quick-roll-button__value">{statValue}</span>
              )}
            </Button>
          }
        />
      );
    });

  const preparedPanel = preparedAction && (
    <div
      className="quick-roll-prepared-action"
      role="status"
      title="Подготовлено вручную. Выполните, когда наступит ваш ход."
    >
      <strong>Подготовлено</strong>
      <span>{preparedAction.label}</span>
      {!preparedIsCurrent && (
        <span className="muted">
          Действие изменилось или больше недоступно. Выберите его заново.
        </span>
      )}
      <Button
        disabled={
          !preparedIsCurrent || !canControlCharacter || entryPending !== null
        }
        onClick={() => void executePreparedAction()}
      >
        {entryPending ? "Выполняем…" : "Выполнить сейчас"}
      </Button>
      <Button
        type="button"
        disabled={entryPending !== null}
        onClick={() => setPreparedAction(null)}
      >
        Очистить
      </Button>
      {!canControlCharacter && (
        <span className="muted">Нет права управлять этим персонажем.</span>
      )}
    </div>
  );

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
              {tab === "stats" ? "Статы" : "Скилы"}
            </button>
          ))}
        </div>
        {preparedAction && !preparedActionTarget && preparedPanel}
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
            {statButtons(skillRows, "skill")}
          </div>
          {(rollCharacter.skills.length > 0 || skillEntries.length > 0) && (
            <div
              className="activity-quick-rolls quick-roll-panel__ability-group"
              aria-busy={entryPending !== null}
            >
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
                      <AppIcon icon={DiceTrayIcon} />
                      {skill.name}
                      {Number.isFinite(skill.rank) && (
                        <span className="quick-roll-button__value">
                          {skill.rank}
                        </span>
                      )}
                    </Button>
                  }
                />
              ))}
              {skillEntries.map((entry) => (
                <div className="quick-roll-panel__entry" key={entry.id}>
                  {Number.isInteger(entry.data.skillValue) && (
                    <Button
                      className="quick-roll-button quick-roll-button--skill"
                      disabled={
                        !canControlCharacter ||
                        entryPending !== null ||
                        !onEntryAction
                      }
                      onClick={() => void submitEntry(entry, "EXECUTE")}
                    >
                      <AppIcon icon={DiceTrayIcon} />
                      {entry.name}
                      <span className="quick-roll-button__value">
                        {entry.data.skillValue}
                      </span>
                    </Button>
                  )}
                  {Number.isInteger(entry.data.skillValue) && (
                    <Button
                      type="button"
                      aria-label={`Подготовить навык: ${entry.name}`}
                      title="Подготовить навык"
                      disabled={!canControlCharacter || entryPending !== null}
                      onClick={() =>
                        prepareEntryAction(
                          entry,
                          "SIMPLE_SKILL",
                          undefined,
                          entry.name,
                        )
                      }
                    >
                      <AppIcon icon={PreparedActionIcon} />
                    </Button>
                  )}
                  {entry.data.rollActions?.map((action) => (
                    <div key={action.id}>
                      <Button
                        key={action.id}
                        disabled={
                          !canControlCharacter ||
                          entryPending !== null ||
                          !onEntryAction
                        }
                        onClick={() =>
                          void submitEntry(entry, "EXECUTE", action.id)
                        }
                      >
                        <CatalogActionIcon
                          kind={action.kind}
                          semanticText={`${entry.name} ${action.label}`}
                        />
                        {action.label}
                      </Button>
                      <Button
                        type="button"
                        aria-label={`Подготовить действие: ${entry.name} · ${action.label}`}
                        title="Подготовить действие"
                        disabled={!canControlCharacter || entryPending !== null}
                        onClick={() =>
                          prepareEntryAction(
                            entry,
                            "ROLL_ACTION",
                            action.id,
                            `${entry.name} · ${action.label}`,
                          )
                        }
                      >
                        <AppIcon icon={PreparedActionIcon} />
                      </Button>
                    </div>
                  ))}
                  {!Number.isInteger(entry.data.skillValue) &&
                    !entry.data.rollActions?.length && (
                      <span className="muted">
                        Навык не настроен для броска.
                      </span>
                    )}
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
          {ordinaryRows.length +
            combatRows.length +
            otherRows.length +
            skillRows.length ===
            0 &&
            rollCharacter.skills.length === 0 &&
            skillEntries.length === 0 && (
              <p className="muted">Нет характеристик и навыков.</p>
            )}
        </div>
        <div
          role="tabpanel"
          id={`${tabsId}-abilities-panel`}
          aria-labelledby={`${tabsId}-abilities`}
          hidden={activeTab !== "abilities"}
        >
          {abilityEntries.length > 0 && (
            <div
              className="activity-quick-rolls quick-roll-panel__ability-group"
              aria-busy={entryPending !== null}
            >
              {abilityEntries.map((entry) => (
                <div className="quick-roll-panel__entry" key={entry.id}>
                  {(entry.data.rollActions?.length ?? 0) > 0 ? (
                    <>
                      <Button
                        disabled={
                          !canControlCharacter ||
                          entryPending !== null ||
                          !onEntryAction ||
                          (entry.data.rollActions?.some(
                            (action) => action.consumeUse,
                          ) === true &&
                            entry.data.uses?.current === 0)
                        }
                        onClick={() =>
                          void submitEntry(entry, "EXECUTE", undefined, true)
                        }
                      >
                        <CatalogActionIcon
                          kind="CUSTOM"
                          semanticText={entry.name}
                        />
                        {entry.name}
                      </Button>
                      <Button
                        type="button"
                        aria-label={`Подготовить способность: ${entry.name}`}
                        title="Подготовить способность"
                        disabled={!canControlCharacter || entryPending !== null}
                        onClick={() =>
                          prepareEntryAction(
                            entry,
                            "ABILITY_EXECUTE_ALL",
                            undefined,
                            entry.name,
                          )
                        }
                      >
                        <AppIcon icon={PreparedActionIcon} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        title="Активировать способность"
                        disabled={
                          !canControlCharacter ||
                          entryPending !== null ||
                          !onEntryAction
                        }
                        onClick={() => void submitEntry(entry, "EXECUTE")}
                      >
                        <CatalogActionIcon
                          kind="CUSTOM"
                          semanticText={entry.name}
                        />
                        {entry.name}
                      </Button>
                      <Button
                        type="button"
                        aria-label={`Подготовить активацию: ${entry.name}`}
                        title="Подготовить активацию"
                        disabled={!canControlCharacter || entryPending !== null}
                        onClick={() =>
                          prepareEntryAction(
                            entry,
                            "ABILITY_ACTIVATION",
                            undefined,
                            entry.name,
                          )
                        }
                      >
                        <AppIcon icon={PreparedActionIcon} />
                      </Button>
                    </>
                  )}
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
          {abilityEntries.length === 0 && (
            <p className="muted">Нет способностей.</p>
          )}
        </div>
        {entryError && <p role="alert">{entryError}</p>}
      </div>
      {preparedActionTarget && preparedPanel
        ? createPortal(preparedPanel, preparedActionTarget)
        : null}
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
