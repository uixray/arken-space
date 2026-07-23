/* eslint-disable react-refresh/only-export-components */
import { useId, useRef, useState } from "react";
import type { CharacterCatalogEntryDto } from "@arken/contracts";

type RollAction = NonNullable<
  CharacterCatalogEntryDto["data"]["rollActions"]
>[number];

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
  result: { total: number; breakdown: string } | null;
  uses: { before: number; after: number; max: number; recharge: string } | null;
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
  if (mode === "EXECUTE" && !action) return null;

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
  const rawResult = record(raw.result);
  const total =
    finite(rawResult?.total) ?? finite(root.total) ?? finite(raw.resultTotal);
  const actor = record(raw.actor);
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
    result:
      total === null
        ? null
        : {
            total,
            breakdown:
              pickText(rawResult ?? {}, "resolvedFormula") ??
              pickText(raw, "breakdown", "resolvedFormula", "formula") ??
              "",
          },
    uses,
  };
}

function actionFormula(action: RollAction) {
  return action.modifiers.length
    ? `${action.dice} + модификаторы`
    : action.dice;
}

export function CharacterActionCard({
  entry,
  disabled,
  onAction,
}: {
  entry: CharacterCatalogEntryDto;
  disabled: boolean;
  onAction: (input: {
    mode: "EXECUTE" | "SHARE";
    rollActionId?: string;
    entryRevision: number;
  }) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<"EXECUTE" | "SHARE" | null>(null);
  const [error, setError] = useState("");
  const detailsId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const actions = [...(entry.data.rollActions ?? [])].sort(
    (a, b) => a.order - b.order,
  );
  const uses = entry.data.uses;
  const exhausted = Boolean(uses && uses.current < 1);

  async function submit(mode: "EXECUTE" | "SHARE", rollActionId?: string) {
    setPending(mode);
    setError("");
    try {
      await onAction({ mode, rollActionId, entryRevision: entry.revision });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось отправить карточку способности.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <article
      className="character-action-card"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !expanded) return;
        event.preventDefault();
        setExpanded(false);
        requestAnimationFrame(() => toggleRef.current?.focus());
      }}
    >
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
      {actions.map((action) => (
        <div className="character-action-card__action" key={action.id}>
          <span>
            <b>{action.label}</b>
            <code>{actionFormula(action)}</code>
          </span>
          <button
            type="button"
            disabled={
              disabled || pending !== null || (action.consumeUse && exhausted)
            }
            onClick={() => void submit("EXECUTE", action.id)}
          >
            {pending === "EXECUTE"
              ? "Выполняем…"
              : action.consumeUse
                ? "Выполнить · 1 использование"
                : "Выполнить"}
          </button>
        </div>
      ))}
      {actions.length === 0 && (
        <p className="muted">Нет выполняемых действий.</p>
      )}
      <div className="character-action-card__controls">
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Свернуть" : "Подробнее"}
        </button>
        <button
          type="button"
          disabled={disabled || pending !== null}
          onClick={() => void submit("SHARE")}
        >
          {pending === "SHARE" ? "Отправляем…" : "Показать без выполнения"}
        </button>
      </div>
      <div
        id={detailsId}
        hidden={!expanded}
        className="character-action-card__details"
      >
        {entry.description && <p>{entry.description}</p>}
        {uses && (
          <p>
            Использования: {uses.current}/{uses.max}
            {uses.recharge ? ` · восстановление: ${uses.recharge}` : ""}
            {uses.progressText ? ` · ${uses.progressText}` : ""}
          </p>
        )}
        <p className="muted">
          «Показать без выполнения» не бросает кубики и не расходует
          использования.
        </p>
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
}: {
  card: SkillCard;
  sourceRemoved?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  return (
    <section
      className="skill-chat-card"
      aria-label={`${card.entry.kind === "SKILL" ? "Навык" : "Способность"}: ${card.entry.name}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !expanded) return;
        event.preventDefault();
        setExpanded(false);
        requestAnimationFrame(() => toggleRef.current?.focus());
      }}
    >
      <div className="skill-chat-card__heading">
        <span className="eyebrow">
          {card.mode === "SHARE"
            ? "Показано без выполнения"
            : card.entry.kind === "SKILL"
              ? "Навык"
              : "Способность"}
        </span>
        <strong>{card.entry.name}</strong>
      </div>
      {card.mode === "SHARE" ? (
        <p className="muted">Без броска и расходования ресурсов.</p>
      ) : (
        <div className="skill-chat-card__result">
          {card.result && (
            <strong aria-label="Итог броска">{card.result.total}</strong>
          )}
          <span>
            <b>{card.action?.label}</b>
            <code>{card.action?.formula}</code>
          </span>
        </div>
      )}
      {card.uses && (
        <p className="skill-chat-card__uses">
          Использования: {card.uses.before} → {card.uses.after}/{card.uses.max}
          {card.uses.recharge ? ` · ${card.uses.recharge}` : ""}
        </p>
      )}
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? "Свернуть детали" : "Детали"}
      </button>
      <div
        id={detailsId}
        hidden={!expanded}
        className="skill-chat-card__details"
      >
        {card.entry.description && <p>{card.entry.description}</p>}
        {card.action?.modifiers.length ? (
          <p>Модификаторы: {card.action.modifiers.join(", ")}</p>
        ) : null}
        {card.result?.breakdown && <p>{card.result.breakdown}</p>}
        {(card.entry.sourceRemoved || sourceRemoved) && (
          <p className="muted">
            Исходная запись удалена; показан сохранённый снимок.
          </p>
        )}
      </div>
    </section>
  );
}
