import { useState, type KeyboardEvent } from "react";
import type { StoryLinkTargetDto } from "@arken/contracts";
import { STORY_LINK_KIND_LABELS } from "./story-channel-helpers";

const MAX_STORY_LINKS = 20;

const targetKey = (target: Pick<StoryLinkTargetDto, "kind" | "entityId">) =>
  `${target.kind}:${target.entityId}`;

function targetLabel(target: StoryLinkTargetDto) {
  return target.label ?? "Удалённая цель";
}

export function StoryLinkChips({
  targets,
  isGm,
}: {
  targets: readonly StoryLinkTargetDto[];
  isGm: boolean;
}) {
  if (!targets.length) return null;
  return (
    <ul className="story-links" aria-label="Связи записи">
      {targets.map((target) => (
        <li
          key={targetKey(target)}
          className="story-links__chip"
          data-story-link-kind={target.kind}
        >
          <span className="story-links__kind">
            {STORY_LINK_KIND_LABELS[target.kind]}
          </span>
          <span>{targetLabel(target)}</span>
          {isGm && !target.playerVisible && (
            <span className="story-links__hidden">скрыто от игроков</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** GM-only: выбранные связи и поиск новых целей без нативного select. */
export function StoryLinkPicker({
  value,
  onChange,
  onSearch,
  disabled = false,
}: {
  value: readonly StoryLinkTargetDto[];
  onChange: (next: StoryLinkTargetDto[]) => void;
  onSearch: (q: string) => Promise<StoryLinkTargetDto[]>;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StoryLinkTargetDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const selected = new Set(value.map(targetKey));
  const full = value.length >= MAX_STORY_LINKS;

  async function search() {
    if (searching || disabled) return;
    setSearching(true);
    setError("");
    try {
      setResults(await onSearch(query.trim()));
    } catch {
      setError("Не удалось найти цели для связи.");
    } finally {
      setSearching(false);
    }
  }

  function onQueryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    // Enter ищет цель, а не отправляет форму записи.
    event.preventDefault();
    void search();
  }

  return (
    <fieldset className="story-links-picker" disabled={disabled}>
      <legend>Связи</legend>
      {value.length > 0 && (
        <ul className="story-links" aria-label="Выбранные связи">
          {value.map((target) => (
            <li key={targetKey(target)} className="story-links__chip">
              <span className="story-links__kind">
                {STORY_LINK_KIND_LABELS[target.kind]}
              </span>
              <span>{targetLabel(target)}</span>
              {!target.playerVisible && (
                <span className="story-links__hidden">скрыто от игроков</span>
              )}
              <button
                type="button"
                className="story-links__remove"
                aria-label={`Убрать связь «${targetLabel(target)}»`}
                onClick={() =>
                  onChange(
                    value.filter(
                      (item) => targetKey(item) !== targetKey(target),
                    ),
                  )
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="story-links-picker__search">
        <input
          aria-label="Найти цель для связи"
          placeholder="Сущность, место, карта, сцена или запись"
          value={query}
          maxLength={80}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onQueryKeyDown}
        />
        <button
          type="button"
          disabled={searching}
          onClick={() => void search()}
        >
          {searching ? "Ищем…" : "Найти"}
        </button>
      </div>
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
      {results &&
        (results.length ? (
          <ul
            className="story-links-picker__results"
            aria-label="Найденные цели"
          >
            {results.map((target) => {
              const linked = selected.has(targetKey(target));
              return (
                <li key={targetKey(target)}>
                  <button
                    type="button"
                    disabled={linked || full}
                    onClick={() => onChange([...value, target])}
                  >
                    {`Связать: ${STORY_LINK_KIND_LABELS[target.kind]} · ${targetLabel(target)}`}
                  </button>
                  {!target.playerVisible && (
                    <span className="story-links__hidden">
                      скрыто от игроков
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="story-links-picker__empty">Ничего не найдено.</p>
        ))}
    </fieldset>
  );
}
