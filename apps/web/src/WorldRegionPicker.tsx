import { useEffect, useState } from "react";
import { api, formatApiError } from "./api";
import { FormInput, FormSelect } from "./ui/GravityFormControls";

type Option = { id: string; name: string };
type Page = { items: Option[]; hasMore: boolean };

/** Uses a bounded, role-filtered endpoint; never downloads the GM entity bodies. */
export function WorldRegionPicker({
  value,
  onChange,
  excludeId,
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void;
  excludeId?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<Page>({ items: [], hasMore: false });
  const [selected, setSelected] = useState<Option | null>(null);
  const [error, setError] = useState("");
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setPage({ items: [], hasMore: false });
    setSelected(null);
    setError("");
    const timer = window.setTimeout(() => {
      void Promise.all([
        api<Page>(
          `/api/world-content-regions?q=${encodeURIComponent(search.trim())}`,
          { signal: abort.signal },
        ),
        value
          ? api<Page>(
              `/api/world-content-regions?id=${encodeURIComponent(value)}`,
              { signal: abort.signal },
            )
          : Promise.resolve({ items: [], hasMore: false } as Page),
      ])
        .then(([result, chosen]) => {
          if (abort.signal.aborted) return;
          setPage(result);
          setSelected(chosen.items[0] ?? null);
        })
        .catch((reason) => {
          if (!abort.signal.aborted) setError(formatApiError(reason));
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [search, value, epoch]);
  const options = page.items.filter((item) => item.id !== excludeId);
  if (
    selected &&
    selected.id !== excludeId &&
    !options.some((item) => item.id === selected.id)
  )
    options.unshift(selected);
  return (
    <div>
      <label className="field">
        Поиск региона
        <FormInput
          value={search}
          disabled={disabled}
          maxLength={200}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Название локации"
        />
      </label>
      <label className="field">
        Регион
        <FormSelect
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Не указан / без фильтра</option>
          {value && !options.some((item) => item.id === value) && (
            <option value={value}>Текущий регион недоступен</option>
          )}
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </FormSelect>
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEpoch((current) => current + 1)}
      >
        Обновить регионы
      </button>
      {page.hasMore && (
        <p className="muted">Показаны первые 40 локаций. Уточните поиск.</p>
      )}
      {error && <p role="status">{error}</p>}
    </div>
  );
}
