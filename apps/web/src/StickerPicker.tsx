import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { StickerPackDto } from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import { api } from "./api";
import { filterStickerPacks } from "./sticker-picker-state";

const categories = [
  ["COMMON", "Общие"],
  ["CHARACTER", "Мои персонажи"],
  ["PLAYER", "Игроки"],
  ["NPC", "NPC"],
  ["CREATURE", "Существа"],
] as const;

type Category = (typeof categories)[number][0];

export function StickerPicker({
  onSelect,
  disabled = false,
}: {
  onSelect: (stickerId: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [packs, setPacks] = useState<StickerPackDto[] | null>(null);
  const [category, setCategory] = useState<Category>("COMMON");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || packs) return;
    let active = true;
    void api<StickerPackDto[]>("/api/stickers")
      .then((result) => active && setPacks(result))
      .catch(() => active && setError("Не удалось загрузить стикеры."));
    return () => {
      active = false;
    };
  }, [open, packs]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>("input, button")?.focus(),
    );
  }, [open]);

  const visible = useMemo(
    () => filterStickerPacks(packs ?? [], category, query),
    [category, packs, query],
  );

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        ".sticker-option",
      ),
    );
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (current < 0 || !buttons.length) return;
    const columns = Math.max(
      1,
      Math.round(
        event.currentTarget.clientWidth /
          Math.max(72, buttons[0]?.getBoundingClientRect().width ?? 72),
      ),
    );
    const delta =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp"
            ? -columns
            : columns;
    const next = Math.max(0, Math.min(buttons.length - 1, current + delta));
    if (next !== current) {
      event.preventDefault();
      buttons[next]?.focus();
    }
  }

  return (
    <div className="sticker-picker">
      <Button
        type="button"
        view="flat"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        Стикеры
      </Button>
      {open && (
        <div
          className="sticker-picker-panel"
          role="dialog"
          aria-label="Выбор стикера"
          ref={panelRef}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          <input
            type="search"
            aria-label="Поиск стикеров"
            placeholder="Поиск по имени и описанию"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div
            className="sticker-categories"
            role="tablist"
            aria-label="Категории стикеров"
          >
            {categories.map(([value, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={category === value}
                key={value}
                onClick={() => setCategory(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {error && <p role="alert">{error}</p>}
          {!error && packs === null && <p className="chat-empty">Загрузка…</p>}
          {!error && packs !== null && visible.length === 0 && (
            <p className="chat-empty">
              В этой категории пока нет доступных стикеров.
            </p>
          )}
          <div
            className="sticker-grid"
            role="listbox"
            onKeyDown={onGridKeyDown}
          >
            {visible.map(({ sticker }) => (
              <button
                className="sticker-option"
                type="button"
                role="option"
                aria-label={sticker.altText}
                disabled={sending}
                key={sticker.id}
                onClick={async () => {
                  setSending(true);
                  setError("");
                  try {
                    await onSelect(sticker.id);
                    setOpen(false);
                  } catch {
                    setError("Не удалось отправить стикер.");
                  } finally {
                    setSending(false);
                  }
                }}
              >
                <img src={sticker.url} alt="" loading="lazy" />
                <span>{sticker.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
