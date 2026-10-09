import { useEffect, useState } from "react";
import { api } from "../api";
import "./TerrainStampControls.css";

export type TerrainStampKey = "forest" | "mountains" | "clouds";
export type TerrainStampSettings = {
  assetKey: TerrainStampKey;
  size: number;
  rotation: number;
  layer: "PUBLIC" | "GM";
};

const titles: Record<TerrainStampKey, string> = {
  forest: "Лес",
  mountains: "Горы",
  clouds: "Облака",
};

export function TerrainStampControls({
  value,
  onChange,
}: {
  value: TerrainStampSettings;
  onChange: (value: TerrainStampSettings) => void;
}) {
  const [catalog, setCatalog] = useState<TerrainStampKey[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void api<{ stamps: Array<{ assetKey: TerrainStampKey }> }>(
      "/api/terrain-stamps/catalog",
    )
      .then((result) => {
        if (active) setCatalog(result.stamps.map((stamp) => stamp.assetKey));
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="terrain-stamp-controls" aria-label="Штампы рельефа">
      <div role="group" aria-label="Выбрать штамп">
        {catalog.map((assetKey) => (
          <button
            key={assetKey}
            type="button"
            aria-pressed={value.assetKey === assetKey}
            aria-label={titles[assetKey]}
            onClick={() => onChange({ ...value, assetKey })}
          >
            <img alt="" src={`/api/terrain-stamps/assets/${assetKey}`} />
            {titles[assetKey]}
          </button>
        ))}
      </div>
      {error && <span role="status">Не удалось загрузить каталог штампов</span>}
      <label>
        Размер{" "}
        <input
          aria-label="Размер штампа"
          type="range"
          min={16}
          max={1024}
          step={16}
          value={value.size}
          onChange={(e) => onChange({ ...value, size: Number(e.target.value) })}
        />
      </label>
      <label>
        Поворот{" "}
        <input
          aria-label="Поворот штампа"
          type="range"
          min={-180}
          max={180}
          step={15}
          value={value.rotation}
          onChange={(e) =>
            onChange({ ...value, rotation: Number(e.target.value) })
          }
        />
      </label>
      <label>
        Слой{" "}
        <select
          aria-label="Слой штампа"
          value={value.layer}
          onChange={(e) =>
            onChange({
              ...value,
              layer: e.target.value as TerrainStampSettings["layer"],
            })
          }
        >
          <option value="PUBLIC">Игрокам</option>
          <option value="GM">Только мастеру</option>
        </select>
      </label>
    </section>
  );
}
