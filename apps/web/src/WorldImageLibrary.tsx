import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { Button } from "./design-system/Button";

type ImageItem = { id: string; name: string; url: string };
type ImagePage = { items: ImageItem[]; nextCursor: string | null };

/** GM-only canonical images, not a campaign asset picker or player catalogue. */
export function WorldImageLibrary({ disabled, value, onSelect }: {
  disabled: boolean;
  value: string | null;
  onSelect: (id: string) => void;
}) {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const retryCursor = useRef<string | undefined>(undefined);
  useEffect(() => () => { generation.current += 1; }, []);
  const load = async (next?: string) => {
    if (disabled || inFlight.current) return;
    const scope = generation.current;
    inFlight.current = true;
    retryCursor.current = next;
    setBusy(true);
    setError(false);
    try {
      const page = await api<ImagePage>(`/api/world-content-images${next ? `?cursor=${encodeURIComponent(next)}` : ""}`);
      if (scope !== generation.current) return;
      setItems(current => next
        ? [...current, ...page.items.filter(row => !current.some(old => old.id === row.id))]
        : page.items);
      setCursor(page.nextCursor);
      setLoaded(true);
    } catch (reason) {
      if (scope === generation.current) {
        if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
          setItems([]);
          setCursor(null);
          setLoaded(false);
        }
        setError(true);
      }
    } finally {
      inFlight.current = false;
      if (scope === generation.current) setBusy(false);
    }
  };
  return (
    <details>
      <summary>Иллюстрации из библиотеки мира</summary>
      <p className="muted">Сохраняются отдельно от кампаний. Выберите изображение для текущего материала.</p>
      {(!loaded || error) && (
        <Button type="button" disabled={disabled || busy}
          onClick={() => void load(retryCursor.current)}>
          {error ? "Повторить загрузку" : "Открыть библиотеку"}
        </Button>
      )}
      {loaded && !error && <Button type="button" disabled={disabled || busy}
        onClick={() => void load()}>Обновить библиотеку</Button>}
      {busy && <p role="status">Загрузка иллюстраций…</p>}
      {error && <p role="alert">Не удалось загрузить библиотеку.</p>}
      {loaded && !items.length && <p>Пока нет иллюстраций. Добавьте обложку или изображение галереи из файлов кампании.</p>}
      <ul className="world-content-workspace__media-grid">
        {items.map(item => <li key={item.id}>
          <img src={item.url} alt="" loading="lazy" />
          <Button type="button" disabled={disabled || busy} selected={value === item.id}
            aria-pressed={value === item.id} onClick={() => onSelect(item.id)}>
            {item.name}
          </Button>
        </li>)}
      </ul>
      {loaded && cursor && !error && <Button type="button" disabled={disabled || busy}
        onClick={() => void load(cursor)}>Ещё иллюстрации</Button>}
    </details>
  );
}
