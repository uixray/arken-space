import { useEffect, useState } from "react";
import {
  fetchCanonicalLocationsForMap,
  type CanonicalLocationOption,
} from "./world-map-canonical-location-client";

export function WorldMapCanonicalLocationPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [options, setOptions] = useState<CanonicalLocationOption[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void fetchCanonicalLocationsForMap().then(
      (rows) => {
        if (current) setOptions(rows);
      },
      () => {
        if (current)
          setError("Не удалось загрузить список канонических локаций.");
      },
    );
    return () => {
      current = false;
    };
  }, []);
  const currentUnavailable =
    value !== null && !options.some((item) => item.id === value);
  return (
    <label>
      Каноническая локация (необязательно)
      <select
        aria-label="Каноническая локация"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Без связи</option>
        {currentUnavailable && (
          <option value={value}>Текущая связь сохранена (недоступно)</option>
        )}
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      {error && <span role="status">{error} Текущая связь не изменена.</span>}
    </label>
  );
}
