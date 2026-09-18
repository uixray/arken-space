import { useState } from "react";
import { Button } from "./design-system/Button";
import {
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUS_LABELS,
  type FeedbackListQuery,
} from "./operator-feedback";

export function OperatorFeedbackFilters({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (query: FeedbackListQuery) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [build, setBuild] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="operator-feedback__filters"
      aria-label="Фильтры обращений"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        const start = from ? new Date(from) : null;
        const end = to ? new Date(to) : null;
        if (
          (start && !Number.isFinite(start.getTime())) ||
          (end && !Number.isFinite(end.getTime())) ||
          (start && end && start > end)
        ) {
          setError("Укажите корректный период: начало не позже окончания.");
          return;
        }
        setError("");
        onApply({
          from: start?.toISOString(),
          to: end?.toISOString(),
          kind: (kind as FeedbackListQuery["kind"]) || undefined,
          status: (status as FeedbackListQuery["status"]) || undefined,
          build: build.trim() || undefined,
        });
      }}
    >
      <fieldset disabled={disabled}>
        <legend>Фильтры обращений</legend>
        <label>
          С даты
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          По дату
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <small>Дата и время в вашем часовом поясе.</small>
        <label>
          Тип обращения
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Все типы</option>
            {Object.entries(FEEDBACK_KIND_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Статус обращения
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Все статусы</option>
            {Object.entries(FEEDBACK_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Сборка
          <input
            value={build}
            maxLength={64}
            placeholder="Версия или ревизия"
            onChange={(e) => setBuild(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={disabled}>
          Применить фильтры
        </Button>
        <Button
          type="button"
          disabled={disabled}
          onClick={() => {
            setFrom("");
            setTo("");
            setKind("");
            setStatus("");
            setBuild("");
            setError("");
            onApply({});
          }}
        >
          Сбросить фильтры
        </Button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
