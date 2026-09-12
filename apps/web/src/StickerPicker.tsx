import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { StickerPackDto } from "@arken/contracts";
import { Button, Popup } from "@gravity-ui/uikit";
import { api } from "./api";
import { filterStickerPacks } from "./sticker-picker-state";
import { useOverlayPopupClassName } from "./ui/overlay-owner";
import { AppIcon } from "./ui/AppIcon";
import { StickerPickerIcon } from "./ui/icons";

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
  iconOnly = false,
}: {
  onSelect: (stickerId: string) => Promise<void>;
  disabled?: boolean;
  /** A compact trigger for use inside a chat composer. */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [packs, setPacks] = useState<StickerPackDto[] | null>(null);
  const [category, setCategory] = useState<Category>("COMMON");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const popupClassName = useOverlayPopupClassName("sticker-picker-popup");
  const openRef = useRef(false);
  const sessionRef = useRef(0);
  const mountedRef = useRef(true);
  const sendingRef = useRef(false);

  const changeOpen = useCallback((next: boolean) => {
    if (openRef.current === next) return;
    openRef.current = next;
    sessionRef.current += 1;
    setOpen(next);
    if (next) setError("");
  }, []);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    if (disabled) changeOpen(false);
  }, [disabled, changeOpen]);

  useEffect(() => {
    if (!open || !anchor) return;
    // A portal must not survive a cached owner's hidden/inert transition.
    // Keyboard/viewport positioning belongs to Popup, not resize-to-dismiss.
    const closeHiddenOwner = () => {
      if (anchor.closest("[hidden], [inert]")) changeOpen(false);
    };
    const observer = new MutationObserver(closeHiddenOwner);
    for (
      let owner: HTMLElement | null = anchor;
      owner;
      owner = owner.parentElement
    ) {
      observer.observe(owner, {
        attributes: true,
        attributeFilter: ["hidden", "inert"],
      });
    }
    closeHiddenOwner();
    return () => observer.disconnect();
  }, [anchor, open, changeOpen]);

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

  const visible = useMemo(
    () => filterStickerPacks(packs ?? [], category, query),
    [category, packs, query],
  );

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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
    <div className={`sticker-picker${iconOnly ? " sticker-picker--icon" : ""}`}>
      <Button
        ref={setAnchor}
        className={iconOnly ? "composer-icon" : undefined}
        type="button"
        view="flat"
        disabled={disabled}
        aria-label={iconOnly ? "Стикеры" : undefined}
        title={iconOnly ? "Стикеры" : undefined}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => changeOpen(!openRef.current)}
      >
        {iconOnly ? <AppIcon icon={StickerPickerIcon} /> : "Стикеры"}
      </Button>
      <Popup
        open={open && !disabled}
        anchorElement={anchor}
        className={popupClassName}
        placement={["top-end", "bottom-end"]}
        strategy="fixed"
        initialFocus={searchRef}
        onOpenChange={changeOpen}
        disableTransition
      >
        <div
          id={panelId}
          className="sticker-picker-panel"
          role="dialog"
          aria-label="Выбор стикера"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              changeOpen(false);
            }
          }}
        >
          <input
            ref={searchRef}
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
                  if (sendingRef.current) return;
                  sendingRef.current = true;
                  const session = sessionRef.current;
                  setSending(true);
                  setError("");
                  try {
                    await onSelect(sticker.id);
                    if (mountedRef.current && sessionRef.current === session) {
                      changeOpen(false);
                    }
                  } catch {
                    if (mountedRef.current && sessionRef.current === session) {
                      setError("Не удалось отправить стикер.");
                    }
                  } finally {
                    sendingRef.current = false;
                    if (mountedRef.current) setSending(false);
                  }
                }}
              >
                <img src={sticker.url} alt="" loading="lazy" />
                <span>{sticker.name}</span>
              </button>
            ))}
          </div>
        </div>
      </Popup>
    </div>
  );
}
