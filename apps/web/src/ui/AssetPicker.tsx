import { useMemo, useState, type KeyboardEvent } from "react";
import type { AssetDto } from "@arken/contracts";
import {
  computeArrowNavIndex,
  filterAssetsByName,
  resolveAssetSelection,
} from "./asset-picker-logic";

export interface AssetPickerProps {
  /** Eligible assets, already filtered/authorized by the caller. */
  assets: AssetDto[];
  /** Currently selected asset id, or null/"" for "no selection". */
  value: string | null;
  onChange: (assetId: string | null) => void;
  /** Label for the dedicated "no selection" tile. Defaults to "Без изображения". */
  noneLabel?: string;
  /** Accessible label for the whole picker (e.g. "Портрет персонажа"). */
  "aria-label"?: string;
  /** Show a text filter above the grid. Defaults to true when there are many assets. */
  filterable?: boolean;
  /** Disable interaction (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** True while the asset list itself is still loading. */
  loading?: boolean;
  /** Optional call-to-action shown alongside the empty-list message (e.g. "upload one"). */
  emptyAction?: { label: string; onSelect: () => void };
}

/** Fallback tile content when an image fails to load or points at a deleted asset. */
function BrokenThumb({ label }: { label: string }) {
  return (
    <span className="asset-picker__broken" role="img" aria-label={label}>
      Изображение недоступно
    </span>
  );
}

function Thumb({ asset }: { asset: AssetDto }) {
  const [failed, setFailed] = useState(false);
  if (failed || !asset.url) return <BrokenThumb label={asset.name} />;
  return (
    <img src={asset.url} alt="" onError={() => setFailed(true)} />
  );
}

/**
 * Grid of thumbnail tiles for picking an image asset, replacing the plain
 * `<select>`-based FormSelect for image-first fields (UIX-390). Purely a
 * presentation component: callers must already have filtered `assets` to
 * whatever the current user is authorized to see.
 */
export function AssetPicker({
  assets,
  value,
  onChange,
  noneLabel = "Без изображения",
  filterable,
  disabled,
  loading,
  emptyAction,
  ...ariaProps
}: AssetPickerProps) {
  const [filter, setFilter] = useState("");
  const ariaLabel = ariaProps["aria-label"];
  const showFilter = filterable ?? assets.length > 12;

  const filtered = useMemo(
    () => filterAssetsByName(assets, filter),
    [assets, filter],
  );

  const { selectedMissing } = resolveAssetSelection(assets, value);

  const handleTileKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    total: number,
  ) => {
    const nextIndex = computeArrowNavIndex(event.key, index, total);
    if (nextIndex === null) return;
    event.preventDefault();
    const container = event.currentTarget.parentElement?.parentElement;
    const tiles = container?.querySelectorAll<HTMLButtonElement>(
      ".asset-picker__tile",
    );
    tiles?.[nextIndex]?.focus();
  };

  if (loading) {
    return (
      <div className="asset-picker asset-picker--loading" aria-label={ariaLabel}>
        Загрузка изображений…
      </div>
    );
  }

  return (
    <div className="asset-picker" role="group" aria-label={ariaLabel}>
      {selectedMissing && (
        <p className="asset-picker__warning" role="status">
          Выбранное изображение больше недоступно. Выберите другое или снимите
          выбор.
        </p>
      )}
      {showFilter && (
        <input
          type="text"
          className="asset-picker__filter"
          placeholder="Поиск по имени…"
          value={filter}
          disabled={disabled}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Поиск изображений по имени"
        />
      )}
      <ul className="asset-picker__grid">
        {(() => {
          let index = 0;
          const total = filtered.length + 1;
          const noneIndex = index++;
          return (
            <>
              <li className="asset-picker__item">
                <button
                  type="button"
                  className="asset-picker__tile asset-picker__tile--none"
                  aria-pressed={!value}
                  aria-label={noneLabel}
                  disabled={disabled}
                  tabIndex={0}
                  onClick={() => onChange(null)}
                  onKeyDown={(event) =>
                    handleTileKeyDown(event, noneIndex, total)
                  }
                >
                  <span aria-hidden="true">—</span>
                </button>
                <span className="asset-picker__caption">{noneLabel}</span>
              </li>
              {filtered.map((asset) => {
                const tileIndex = index++;
                const selected = asset.id === value;
                return (
                  <li className="asset-picker__item" key={asset.id}>
                    <button
                      type="button"
                      className="asset-picker__tile"
                      aria-pressed={selected}
                      aria-label={asset.name}
                      disabled={disabled}
                      tabIndex={0}
                      onClick={() => onChange(asset.id)}
                      onKeyDown={(event) =>
                        handleTileKeyDown(event, tileIndex, total)
                      }
                    >
                      <Thumb asset={asset} />
                    </button>
                    <span className="asset-picker__caption">{asset.name}</span>
                  </li>
                );
              })}
            </>
          );
        })()}
      </ul>
      {assets.length === 0 && (
        <p className="asset-picker__empty">
          Нет доступных изображений.
          {emptyAction && (
            <>
              {" "}
              <button
                type="button"
                className="asset-picker__empty-action"
                onClick={emptyAction.onSelect}
              >
                {emptyAction.label}
              </button>
            </>
          )}
        </p>
      )}
      {assets.length > 0 && filtered.length === 0 && (
        <p className="asset-picker__empty">Ничего не найдено по запросу «{filter}».</p>
      )}
    </div>
  );
}
