import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "../ui/AppIcon";
import { CloseIcon } from "../ui/icons";

type RepeatAction = (count: number) => void;
type RepeatMenu = { x: number; y: number; action: RepeatAction };

/** One click rolls once; a double click rolls twice without firing the single. */
export function useRepeatRoll() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menu, setMenu] = useState<RepeatMenu | null>(null);
  const [customCount, setCustomCount] = useState("5");

  const clearPending = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => () => clearPending(), []);

  const onRollClick = (
    event: MouseEvent<HTMLElement>,
    action: RepeatAction,
  ) => {
    clearPending();
    if (event.shiftKey) {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX || rect.left + rect.width / 2;
      const y = event.clientY || rect.top + rect.height / 2;
      setMenu({
        x: Math.max(8, Math.min(x, window.innerWidth - 224)),
        y: Math.max(8, Math.min(y + 12, window.innerHeight - 132)),
        action,
      });
      return;
    }
    setMenu(null);
    if (event.detail >= 2) {
      action(2);
      return;
    }
    // Keyboard activation has detail=0 and cannot be part of a double click.
    if (event.detail === 0) {
      action(1);
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      action(1);
    }, 240);
  };

  const popover = menu
    ? createPortal(
        <div
          className="repeat-roll-popover"
          role="group"
          aria-label="Сколько раз бросить"
          style={{ left: menu.x, top: menu.y }}
        >
          <span>Бросить раз</span>
          <div className="repeat-roll-popover__choices">
            {[1, 2, 3, 4].map((count) => (
              <button
                type="button"
                key={count}
                onClick={() => {
                  menu.action(count);
                  setMenu(null);
                }}
              >
                {count}
              </button>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const count = Number(customCount);
              if (!Number.isInteger(count) || count < 1 || count > 100) return;
              menu.action(count);
              setMenu(null);
            }}
          >
            <input
              type="number"
              min="1"
              max="100"
              value={customCount}
              aria-label="Своё количество бросков"
              onChange={(event) => setCustomCount(event.target.value)}
            />
            <button type="submit">Бросить</button>
          </form>
          <button
            type="button"
            className="repeat-roll-popover__close"
            aria-label="Закрыть выбор количества"
            onClick={() => setMenu(null)}
          >
            <AppIcon icon={CloseIcon} />
          </button>
        </div>,
        document.body,
      )
    : null;

  return { onRollClick, popover };
}
