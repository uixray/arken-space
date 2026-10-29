/* eslint-disable react-refresh/only-export-components */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CharacterCatalogEntryDto, DiceResult } from "@arken/contracts";
import { CatalogActionIcon } from "./CatalogActionIcon";
import type { DiceCritical } from "./dice-critical";
import { getDiceCritical } from "./dice-critical";
import { DicePoolFaces } from "./DicePoolFaces";
import { normalizeClientDiceResult } from "./dice-result";
import { humanizeFormula } from "./formula-display";
import { useCampaignStatLabels } from "./campaign-stat-labels-context";
import {
  previewRollActionFormula,
  type CatalogEntryPreviewContext,
} from "./sidebar/catalog-entry-preview";
import { AppIcon } from "./ui/AppIcon";
import { DiceTrayIcon } from "./ui/icons";

export type SkillCard = {
  version: 1;
  mode: "EXECUTE" | "SHARE";
  characterName: string;
  entry: {
    id: string;
    name: string;
    kind: "SKILL" | "ABILITY";
    description: string;
    revision: number | null;
    sourceCatalogEntryId: string | null;
    sourceRemoved: boolean;
  };
  action: {
    id: string;
    label: string;
    kind: string;
    formula: string;
    modifiers: string[];
  } | null;
  result:
    | (Pick<DiceResult, "total" | "rollMode" | "poolTerms" | "selectedPool"> & {
        breakdown: string;
      })
    | null;
  rolls?: Array<{
    action: {
      id: string;
      label: string;
      kind: string;
      dice: string;
      advantage: boolean;
      consumeUse: boolean;
    };
    formula: string;
    result: DiceResult;
  }>;
  uses: { before: number; after: number; max: number; recharge: string } | null;
  activationCost: {
    type: "physical" | "magic";
    amount: number;
    before: number;
    after: number;
  } | null;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown, max = 4000): string | null =>
  typeof value === "string" && value.length <= max ? value : null;
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const pickText = (source: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = text(source[key]);
    if (value !== null) return value;
  }
  return null;
};

/**
 * The chat projection is intentionally parsed at the edge. A future or corrupt
 * skill-card must fall through to the legacy dice renderer instead of breaking
 * the campaign history.
 */
export function parseSkillCard(dice: unknown): SkillCard | null {
  const root = record(dice);
  const raw = root && record(root.skillCard);
  if (!raw || raw.version !== 1) return null;
  const execution = raw.execution;
  const mode =
    execution === "EXECUTED"
      ? "EXECUTE"
      : execution === "SHARED"
        ? "SHARE"
        : raw.mode;
  if (mode !== "EXECUTE" && mode !== "SHARE") return null;
  const rawEntry = record(raw.entry);
  if (!rawEntry) return null;
  const id = pickText(rawEntry, "id", "entryId");
  const name = pickText(rawEntry, "name");
  const kind = rawEntry.kind;
  if (!id || !name || (kind !== "SKILL" && kind !== "ABILITY")) return null;

  const rawAction = record(raw.action);
  const action = rawAction
    ? (() => {
        const actionId = pickText(rawAction, "id", "actionId");
        const label = pickText(rawAction, "label", "name");
        const formula =
          pickText(raw, "formula") ??
          pickText(rawAction, "formula", "resolvedFormula", "dice");
        if (!actionId || !label || !formula) return null;
        const modifiers = Array.isArray(rawAction.modifiers)
          ? rawAction.modifiers
              .map((value) => text(value, 160))
              .filter((value): value is string => value !== null)
              .slice(0, 12)
          : [];
        return {
          id: actionId,
          label,
          kind: pickText(rawAction, "kind") ?? "CUSTOM",
          formula,
          modifiers,
        };
      })()
    : null;
  if (mode === "EXECUTE" && !action && kind !== "ABILITY") return null;

  const rawUses = record(raw.uses) ?? record(raw.resource);
  const before = rawUses && finite(rawUses.before);
  const after = rawUses && finite(rawUses.after);
  const max = rawUses && finite(rawUses.max);
  const uses =
    before !== null && after !== null && max !== null
      ? {
          before,
          after,
          max,
          recharge: pickText(rawUses!, "recharge", "rechargeLabel") ?? "",
        }
      : null;
  const rawRolls = raw.rolls;
  let rolls: SkillCard["rolls"];
  if (rawRolls !== undefined) {
    if (!Array.isArray(rawRolls) || rawRolls.length > 20) return null;
    rolls = [];
    for (const value of rawRolls) {
      const snapshot = record(value);
      const snapshotAction = record(snapshot?.action);
      const actionId = pickText(snapshotAction ?? {}, "id");
      const label = pickText(snapshotAction ?? {}, "label");
      const kind = pickText(snapshotAction ?? {}, "kind");
      const diceText = pickText(snapshotAction ?? {}, "dice");
      const rollFormula = pickText(snapshot ?? {}, "formula");
      const diceResult = normalizeClientDiceResult(snapshot?.result);
      if (
        !snapshot ||
        !actionId ||
        !label ||
        !kind ||
        !diceText ||
        !rollFormula ||
        !diceResult ||
        typeof snapshotAction?.advantage !== "boolean" ||
        typeof snapshotAction.consumeUse !== "boolean"
      )
        return null;
      rolls.push({
        action: {
          id: actionId,
          label,
          kind,
          dice: diceText,
          advantage: snapshotAction.advantage,
          consumeUse: snapshotAction.consumeUse,
        },
        formula: rollFormula,
        result: diceResult,
      });
    }
  }
  const rawResult = record(raw.result);
  const normalizedResult = normalizeClientDiceResult(rawResult);
  const total =
    finite(rawResult?.total) ?? finite(root.total) ?? finite(raw.resultTotal);
  const actor = record(raw.actor);
  const rawActivationCost = record(raw.activationCost);
  const activationCost =
    rawActivationCost &&
    (rawActivationCost.type === "physical" ||
      rawActivationCost.type === "magic") &&
    finite(rawActivationCost.amount) !== null &&
    finite(rawActivationCost.before) !== null &&
    finite(rawActivationCost.after) !== null
      ? {
          type: rawActivationCost.type as "physical" | "magic",
          amount: finite(rawActivationCost.amount)!,
          before: finite(rawActivationCost.before)!,
          after: finite(rawActivationCost.after)!,
        }
      : null;
  return {
    version: 1,
    mode,
    characterName:
      pickText(actor ?? {}, "characterName") ??
      pickText(raw, "characterName", "actorName") ??
      "Персонаж",
    entry: {
      id,
      name,
      kind,
      description: pickText(rawEntry, "description") ?? "",
      revision: finite(rawEntry.revision),
      sourceCatalogEntryId: pickText(rawEntry, "sourceCatalogEntryId"),
      sourceRemoved:
        rawEntry.sourceRemoved === true ||
        raw.sourceRemoved === true ||
        raw.sourceAvailable === false,
    },
    action,
    ...(rolls === undefined ? {} : { rolls }),
    result:
      total === null
        ? null
        : {
            total,
            breakdown:
              pickText(rawResult ?? {}, "resolvedFormula") ??
              pickText(raw, "breakdown", "resolvedFormula", "formula") ??
              "",
            ...(normalizedResult
              ? {
                  rollMode: normalizedResult.rollMode,
                  poolTerms: normalizedResult.poolTerms,
                  selectedPool: normalizedResult.selectedPool,
                }
              : {}),
          },
    uses,
    activationCost,
  };
}

export function CharacterActionCard({
  entry,
  disabled,
  draftScopeKey = entry.id,
  characterStats,
  skillModifiers,
  onAction,
}: {
  entry: CharacterCatalogEntryDto;
  disabled: boolean;
  draftScopeKey?: string;
  characterStats?: Readonly<Record<string, number>>;
  skillModifiers?: CatalogEntryPreviewContext["skillModifiers"];
  onAction: (input: {
    mode: "EXECUTE" | "SHARE";
    rollActionId?: string;
    executeAll?: true;
    entryRevision: number;
  }) => Promise<void>;
}) {
  const statLabels = useCampaignStatLabels();
  const [pending, setPending] = useState<"EXECUTE" | "SHARE" | null>(null);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);
  const [prepared, setPrepared] = useState<{
    id: string;
    scope: string;
    revision: number;
    actionId?: string;
    intent:
      | "ROLL_ACTION"
      | "SIMPLE_SKILL"
      | "ABILITY_ACTIVATION"
      | "ABILITY_EXECUTE_ALL";
    label: string;
  } | null>(null);
  const draftScopeRef = useRef(draftScopeKey);
  useLayoutEffect(() => {
    draftScopeRef.current = draftScopeKey;
  }, [draftScopeKey]);
  useEffect(() => setPrepared(null), [draftScopeKey]);
  const actions = [...(entry.data.rollActions ?? [])].sort(
    (a, b) =>
      ((a as { order?: number }).order ?? 0) -
      ((b as { order?: number }).order ?? 0),
  );
  const rawUses = entry.data.uses as
    | {
        current?: number;
        max?: number;
        maximum?: number;
        recharge?: string;
        rechargeRate?: string;
        progressText?: string;
      }
    | undefined;
  const uses = rawUses
    ? {
        current: rawUses.current ?? 0,
        max: rawUses.max ?? rawUses.maximum ?? 0,
        recharge: rawUses.recharge ?? rawUses.rechargeRate ?? "",
        progressText: rawUses.progressText ?? "",
      }
    : undefined;
  const exhausted = Boolean(uses && uses.current < 1);

  async function submit(
    mode: "EXECUTE" | "SHARE",
    rollActionId?: string,
    executeAll = false,
  ): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(mode);
    setError("");
    try {
      await onAction({
        mode,
        rollActionId,
        ...(executeAll ? { executeAll: true as const } : {}),
        entryRevision: entry.revision,
      });
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось отправить карточку способности.",
      );
      return false;
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }
  const prepare = (
    intent: NonNullable<typeof prepared>["intent"],
    actionId: string | undefined,
    label: string,
  ) => {
    if (disabled) return;
    setPrepared({
      id: `${entry.id}:${intent}:${actionId ?? "simple"}:${Date.now()}`,
      scope: draftScopeKey,
      revision: entry.revision,
      actionId,
      intent,
      label,
    });
  };
  const isPreparedCurrent = Boolean(
    prepared &&
    prepared.scope === draftScopeKey &&
    prepared.revision === entry.revision &&
    (prepared.intent === "SIMPLE_SKILL"
      ? entry.kind === "SKILL" && Number.isInteger(entry.data.skillValue)
      : prepared.intent === "ABILITY_ACTIVATION"
        ? entry.kind === "ABILITY" && !entry.data.rollActions?.length
        : prepared.intent === "ABILITY_EXECUTE_ALL"
          ? entry.kind === "ABILITY" && Boolean(entry.data.rollActions?.length)
          : entry.data.rollActions?.some(
              (action) => action.id === prepared.actionId,
            )),
  );
  async function executePrepared() {
    if (!prepared || !isPreparedCurrent || disabled) return;
    const current = prepared;
    const currentScope = draftScopeKey;
    if (
      (await submit(
        "EXECUTE",
        current.intent === "ROLL_ACTION" ? current.actionId : undefined,
        current.intent === "ABILITY_EXECUTE_ALL",
      )) &&
      draftScopeRef.current === currentScope
    )
      setPrepared((value) => (value?.id === current.id ? null : value));
  }

  return (
    <article className="character-action-card">
      <div className="character-action-card__summary">
        <div>
          <span className="eyebrow">
            {entry.kind === "SKILL" ? "Навык" : "Способность"}
          </span>
          <strong>{entry.name}</strong>
        </div>
        {uses && (
          <span className="character-action-card__uses">
            {uses.current}/{uses.max}
          </span>
        )}
      </div>
      {entry.kind === "ABILITY" && (
        <div className="character-action-card__action character-action-card__action--primary">
          <span>
            <b>{actions.length ? "Выполнить способность" : "Активировать"}</b>
            <code>
              {actions.length
                ? `${actions.length} ${actions.length === 1 ? "бросок" : actions.length < 5 ? "броска" : "бросков"} · одно выполнение`
                : (entry.data.activation?.consumeUse ?? Boolean(uses))
                  ? "1 использование · без броска"
                  : "Без броска"}
              {!actions.length && entry.data.activation?.cost
                ? ` · ${entry.data.activation.cost.amount} ${entry.data.activation.cost.type === "physical" ? "физической силы" : "магической силы"}`
                : ""}
            </code>
          </span>
          <button
            type="button"
            disabled={
              disabled ||
              pending !== null ||
              (actions.length
                ? actions.some((candidate) => candidate.consumeUse) && exhausted
                : (entry.data.activation?.consumeUse ?? Boolean(uses)) &&
                  exhausted)
            }
            onClick={() =>
              void submit("EXECUTE", undefined, actions.length > 0)
            }
          >
            <CatalogActionIcon kind="CUSTOM" semanticText={entry.name} />
            {pending === "EXECUTE"
              ? "Выполняем…"
              : actions.length
                ? "Выполнить способность"
                : "Активировать"}
          </button>
          <button
            type="button"
            disabled={disabled || pending !== null}
            onClick={() =>
              prepare(
                actions.length ? "ABILITY_EXECUTE_ALL" : "ABILITY_ACTIVATION",
                undefined,
                entry.name,
              )
            }
          >
            Подготовить
          </button>
        </div>
      )}
      {entry.kind === "SKILL" &&
        typeof entry.data.skillValue === "number" &&
        Number.isFinite(entry.data.skillValue) && (
          <div className="character-action-card__action">
            <span>
              <b>Проверка навыка</b>
              <code>
                1d20 {entry.data.skillValue < 0 ? "-" : "+"}{" "}
                {Math.abs(entry.data.skillValue)}
              </code>
            </span>
            <button
              type="button"
              disabled={disabled || pending !== null}
              onClick={() => void submit("EXECUTE")}
            >
              <AppIcon icon={DiceTrayIcon} />
              Бросить
            </button>
            <button
              type="button"
              disabled={disabled || pending !== null}
              onClick={() =>
                prepare("SIMPLE_SKILL", undefined, `Проверка: ${entry.name}`)
              }
            >
              Подготовить
            </button>
          </div>
        )}
      {actions.map((action) => (
        <div className="character-action-card__action" key={action.id}>
          <span>
            <b>{action.label}</b>
            <code>
              {humanizeFormula(
                previewRollActionFormula(action, entry.data.values, {
                  characterStats,
                  statLabels,
                  skillModifiers,
                }),
                statLabels,
              )}
            </code>
          </span>
          {entry.kind !== "ABILITY" && (
            <>
              <button
                type="button"
                disabled={
                  disabled ||
                  pending !== null ||
                  (action.consumeUse && exhausted)
                }
                onClick={() => void submit("EXECUTE", action.id)}
              >
                <AppIcon icon={DiceTrayIcon} />
                {pending === "EXECUTE"
                  ? "Выполняем…"
                  : action.consumeUse
                    ? "Выполнить · 1 использование"
                    : "Выполнить"}
              </button>
              <button
                type="button"
                disabled={disabled || pending !== null}
                onClick={() =>
                  prepare(
                    "ROLL_ACTION",
                    action.id,
                    `${entry.name} · ${action.label}`,
                  )
                }
              >
                Подготовить
              </button>
            </>
          )}
        </div>
      ))}
      {entry.kind === "SKILL" &&
        actions.length === 0 &&
        !(
          typeof entry.data.skillValue === "number" &&
          Number.isFinite(entry.data.skillValue)
        ) && <p className="muted">Нет выполняемых действий.</p>}
      <div className="character-action-card__controls">
        {prepared && (
          <div className="character-action-card__prepared" role="status">
            <strong>Подготовлено для хода: {prepared.label}</strong>
            {!isPreparedCurrent && (
              <span className="muted">
                Действие изменилось или удалено. Выберите его заново или
                очистите.
              </span>
            )}
            <button
              type="button"
              disabled={disabled || pending !== null || !isPreparedCurrent}
              onClick={() => void executePrepared()}
            >
              {pending === "EXECUTE" ? "Выполняем…" : "Выполнить сейчас"}
            </button>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => setPrepared(null)}
            >
              Очистить
            </button>
            <span className="muted">
              Выполняйте вручную, когда наступит ваш ход.
            </span>
          </div>
        )}
        <button
          type="button"
          disabled={disabled || pending !== null}
          onClick={() => void submit("SHARE")}
        >
          {pending === "SHARE" ? "Отправляем…" : "Показать без выполнения"}
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export function SkillChatCard({
  card,
  sourceRemoved = false,
  critical = null,
  outcomeFrame = null,
  renderRollFrame,
}: {
  card: SkillCard;
  sourceRemoved?: boolean;
  critical?: DiceCritical | null;
  outcomeFrame?: ReactNode;
  renderRollFrame?: (result: DiceResult) => ReactNode;
}) {
  const statLabels = useCampaignStatLabels();
  const actionFormula = card.action?.formula ?? "";
  const hasInternalModifier = /\bmodifier_\d+\b/.test(actionFormula);
  const visibleFormula = humanizeFormula(
    hasInternalModifier
      ? card.result?.breakdown &&
        !/\bmodifier_\d+\b/.test(card.result.breakdown)
        ? card.result.breakdown
        : actionFormula.replace(/\bmodifier_\d+\b/g, "модификатор")
      : actionFormula,
    statLabels,
  );
  const normalized = (value: string) =>
    value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const breakdownRepeatsFormula = Boolean(
    card.result?.breakdown &&
    normalized(humanizeFormula(card.result.breakdown, statLabels)) ===
      normalized(visibleFormula),
  );
  return (
    <section
      className={`skill-chat-card${critical ? ` roll-result--critical-${critical.kind}` : ""}`}
      aria-label={`${card.entry.kind === "SKILL" ? "Навык" : "Способность"}: ${card.entry.name}`}
    >
      <div className="skill-chat-card__heading">
        <span className="eyebrow">
          {card.mode === "SHARE"
            ? "Показано без выполнения"
            : card.entry.kind === "SKILL"
              ? "Навык"
              : null}
        </span>
        <strong>{card.entry.name}</strong>
      </div>
      {card.mode === "SHARE" ? (
        <p className="muted">Без броска и расходования ресурсов.</p>
      ) : card.rolls?.length ? (
        <div className="skill-chat-card__rolls">
          {card.rolls.map((roll) => {
            const hasInternalModifier = /\bmodifier_\d+\b/.test(roll.formula);
            const formula = humanizeFormula(
              hasInternalModifier ? roll.result.resolvedFormula : roll.formula,
              statLabels,
            );
            const rollCritical = getDiceCritical(roll.result);
            return (
              <div
                className={`skill-chat-card__roll${rollCritical ? ` roll-result--critical-${rollCritical.kind}` : ""}`}
                key={roll.action.id}
              >
                <div className="skill-chat-card__result">
                  <div className="roll-total-wrap">
                    <AppIcon icon={DiceTrayIcon} />
                    {renderRollFrame?.(roll.result)}
                    <strong
                      className="roll-total__value"
                      aria-label={`Итог броска: ${roll.action.label}`}
                    >
                      {roll.result.total}
                    </strong>
                  </div>
                  <span>
                    <b>{roll.action.label}</b>
                    <code>{formula}</code>
                    {rollCritical && (
                      <span className="roll-critical-label">
                        {rollCritical.label}
                      </span>
                    )}
                  </span>
                </div>
                <DicePoolFaces dice={roll.result} />
              </div>
            );
          })}
        </div>
      ) : card.action ? (
        <div className="skill-chat-card__result">
          {card.result && (
            <div className="roll-total-wrap">
              <AppIcon icon={DiceTrayIcon} />
              {outcomeFrame}
              <strong className="roll-total__value" aria-label="Итог броска">
                {card.result.total}
              </strong>
            </div>
          )}
          <span>
            <b>
              {card.result && <AppIcon icon={DiceTrayIcon} />}
              {card.action.label}
            </b>
            <code>{visibleFormula}</code>
            {critical && (
              <span className="roll-critical-label">{critical.label}</span>
            )}
          </span>
        </div>
      ) : (
        <p className="muted">Активировано без броска.</p>
      )}
      {card.uses && (
        <p className="skill-chat-card__uses">
          Использования: {card.uses.before} → {card.uses.after}/{card.uses.max}
          {card.uses.recharge ? ` · ${card.uses.recharge}` : ""}
        </p>
      )}
      {card.result && <DicePoolFaces dice={card.result} />}
      {card.activationCost && (
        <p className="skill-chat-card__uses">
          Стоимость: {card.activationCost.before} → {card.activationCost.after}{" "}
          ·{" "}
          {card.activationCost.type === "physical"
            ? "физическая сила"
            : "магическая сила"}
        </p>
      )}
      <div className="skill-chat-card__details">
        {card.entry.description && <p>{card.entry.description}</p>}
        {card.action?.modifiers.length ? (
          <p>Модификаторы: {card.action.modifiers.join(", ")}</p>
        ) : null}
        {card.result?.breakdown && !breakdownRepeatsFormula && (
          <p>{card.result.breakdown}</p>
        )}
        {(card.entry.sourceRemoved || sourceRemoved) && (
          <p className="muted">
            Исходная запись удалена; показан сохранённый снимок.
          </p>
        )}
      </div>
    </section>
  );
}
