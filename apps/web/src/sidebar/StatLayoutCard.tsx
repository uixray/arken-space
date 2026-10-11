import "./roll-controls.css";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../design-system/Button";
import { isSystemRegenStatKey, STAT_VALUE_RANGE } from "@arken/system";
import { ApiError, formatApiError } from "../api";
import { FormInput } from "../ui/GravityFormControls";
import { useRemoteFieldValue } from "../ui/remote-field-value";
import { rollModeFromEvent } from "../roll-modifier-keys";
import type { RollMode } from "../roll-mode";
import { TextPromptDialog } from "../ui/TextPromptDialog";
import { ArkenDialog } from "../ui/ArkenDialog";
import { AppIcon } from "../ui/AppIcon";
import {
  AddIcon,
  DecreaseIcon,
  DeleteIcon,
  MoveDownIcon,
  MoveUpIcon,
  RenameIcon,
} from "../ui/icons";

/** То, чем строка держится: сервер отвечает этим на попытку её удалить. */
export interface StatKeyReference {
  kind: string;
  name: string;
  owner?: string;
}

const REFERENCE_KIND_LABELS: Record<string, string> = {
  SKILL: "Навык",
  SPELL: "Заклинание",
  CATALOG_ENTRY: "Способность каталога",
  CHARACTER_ENTRY: "Способность персонажа",
};

/** Keep the inline native-details menu within every clipping viewport. */
function syncStatMenuPlacement(menu: HTMLDetailsElement) {
  const summary = menu.querySelector<HTMLElement>("summary");
  const popup = menu.querySelector<HTMLElement>(".stat-field__menu-items");
  if (!menu.open || !summary || !popup) {
    menu.removeAttribute("data-menu-side");
    menu.style.removeProperty("--stat-field-menu-max-height");
    return;
  }

  const visualViewport = window.visualViewport;
  let top = visualViewport?.offsetTop ?? 0;
  let bottom = top + (visualViewport?.height ?? window.innerHeight);
  for (
    let ancestor = menu.parentElement;
    ancestor && ancestor !== document.body;
    ancestor = ancestor.parentElement
  ) {
    const overflowY = window.getComputedStyle(ancestor).overflowY;
    if (!/(auto|scroll|hidden|clip)/.test(overflowY)) continue;
    const rect = ancestor.getBoundingClientRect();
    top = Math.max(top, rect.top + ancestor.clientTop);
    bottom = Math.min(bottom, rect.top + ancestor.clientTop + ancestor.clientHeight);
  }

  const summaryRect = summary.getBoundingClientRect();
  // Measure the un-clamped content so a previous short viewport cannot bias
  // the next resize/scroll placement decision.
  menu.style.removeProperty("--stat-field-menu-max-height");
  const popupHeight = Math.max(popup.scrollHeight, popup.getBoundingClientRect().height);
  const gap = 8;
  const above = Math.max(0, summaryRect.top - top - gap);
  const below = Math.max(0, bottom - summaryRect.bottom - gap);
  let side: "above" | "below";
  if (popupHeight <= below) side = "below";
  else if (popupHeight <= above) side = "above";
  else side = above > below ? "above" : "below";
  const available = side === "above" ? above : below;

  menu.dataset.menuSide = side;
  if (popupHeight > available)
    menu.style.setProperty("--stat-field-menu-max-height", `${available}px`);
}

/**
 * Разбирает отказ сервера. Список ссылок приходит только с
 * `STAT_ROW_REFERENCED`; всё остальное — обычная ошибка, и подавать её как
 * «строку кто-то держит» значило бы соврать о причине.
 */
function refusalOf(
  reason: unknown,
): { references: StatKeyReference[] } | { message: string } {
  if (reason instanceof ApiError && reason.code === "STAT_ROW_REFERENCED") {
    const references = reason.details?.references;
    if (Array.isArray(references))
      return { references: references as StatKeyReference[] };
  }
  return { message: formatApiError(reason, "Не удалось удалить строку") };
}

/**
 * UIX-532 — значение характеристики, переживающее чужую правку.
 *
 * Поле неуправляемое: правка уходит на `blur`, а пришедшее извне значение
 * доносится до живого элемента. Отдельным компонентом, потому что строк в
 * карточке десяток и они добавляются и удаляются — хук на каждую строку прямо
 * в цикле нарушил бы порядок вызовов при первом же удалении.
 */
function StatValueField({
  id,
  label,
  value,
  editable,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  editable: boolean;
  onCommit: (value: number) => void;
}) {
  const controlRef = useRemoteFieldValue<HTMLInputElement>(String(value));
  const step = (delta: number) => {
    const current = Number(controlRef.current?.value ?? value);
    const next = Math.min(
      STAT_VALUE_RANGE.max,
      Math.max(STAT_VALUE_RANGE.min, current + delta),
    );
    if (controlRef.current) controlRef.current.value = String(next);
    onCommit(next);
  };
  return (
    <div className="stat-field__value">
      <Button
        disabled={!editable}
        aria-label={`Уменьшить ${label}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => step(-1)}
      >
        <AppIcon icon={DecreaseIcon} />
      </Button>
      <FormInput
        id={id}
        aria-label={label}
        controlRef={controlRef}
        type="number"
        defaultValue={value}
        disabled={!editable}
        min={STAT_VALUE_RANGE.min}
        max={STAT_VALUE_RANGE.max}
        onBlur={(event) => onCommit(Number(event.target.value))}
      />
      <Button
        disabled={!editable}
        aria-label={`Увеличить ${label}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => step(1)}
      >
        <AppIcon icon={AddIcon} />
      </Button>
    </div>
  );
}

/**
 * UIX-424, шаг 5 — одна группа раскладки в карточке персонажа.
 *
 * Обе группы («Характеристики» и «Боевые характеристики») рисуются этим
 * компонентом. Раньше они отличались: у боевых были только кнопки броска, без
 * поля ввода, — то есть выставить инициативу или ближний бой было негде.
 * Отличались они не по замыслу, а потому что боевых строк с данными почти не
 * было; теперь есть, и разница исчезает.
 *
 * Правка раскладки — только мастеру: она общая на кампанию, и переименование
 * строки игроком поменяло бы подпись всем.
 */
export function StatLayoutCard({
  title,
  modifier,
  rows,
  values,
  editable,
  rollPending,
  canEditLayout,
  onChangeValue,
  onRoll,
  onRenameRow,
  onAddRow,
  onDeleteRow,
  onMoveRow,
  onReorderRow,
  layoutOnly = false,
  showAddRow = true,
}: {
  layoutOnly?: boolean;
  showAddRow?: boolean;
  title: string;
  modifier: string;
  rows: readonly { key: string; label: string }[];
  values: Record<string, number>;
  editable: boolean;
  rollPending: boolean;
  canEditLayout: boolean;
  onChangeValue: (key: string, value: number) => void;
  onRoll: (formula: string, label: string, mode: RollMode) => void;
  onRenameRow: (key: string, label: string) => Promise<void>;
  onAddRow: (label: string) => Promise<void>;
  onDeleteRow: (key: string) => Promise<void>;
  /**
   * UIX-424, шаг 7. Стрелки, а не перетаскивание: в проекте так уже
   * переставляются галерея персонажа и содержимое энциклопедии, они работают с
   * клавиатуры без отдельной поддержки, и их поведение проверяется тестом.
   * Перетаскивание можно добавить сверху той же чистой функцией, если мышью
   * окажется нужнее.
   */
  onMoveRow: (key: string, direction: "up" | "down") => Promise<void>;
  onReorderRow?: (key: string, targetKey: string) => Promise<void>;
}) {
  const fieldIdPrefix = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  // `null` — окно закрыто; `{ key: undefined }` — добавление новой строки.
  const [editing, setEditing] = useState<{ key?: string } | null>(null);
  const renamed = editing?.key
    ? rows.find((row) => row.key === editing.key)
    : undefined;

  const [deleting, setDeleting] = useState<{
    key: string;
    label: string;
  } | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  /**
   * `null` — ещё не спрашивали. Список ссылок приходит только отказом сервера:
   * собирать его на клиенте значило бы завести вторую копию правила «что
   * считается ссылкой», и разошлись бы они там, где это дороже всего — клиент
   * сказал бы «можно», а сервер отказал.
   */
  const [refusal, setRefusal] = useState<ReturnType<typeof refusalOf> | null>(
    null,
  );

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const targetDialog =
        target instanceof Element ? target.closest('[role="dialog"], dialog') : null;
      for (const menu of cardRef.current?.querySelectorAll<HTMLDetailsElement>(
        "details.stat-field__menu[open]",
      ) ?? []) {
        // The card's rename/delete prompts are portalled outside this card's
        // DOM, but remain its child interaction. Other dialogs do not own it.
        if (editing || deleting) continue;
        const ownerDialog = menu.closest('[role="dialog"], dialog');
        if (targetDialog && targetDialog === ownerDialog && menu.contains(target))
          continue;
        if (!menu.contains(target)) menu.open = false;
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [deleting, editing]);

  useEffect(() => {
    let frame: number | null = null;
    const syncOpenMenus = () => {
      frame = null;
      for (const menu of cardRef.current?.querySelectorAll<HTMLDetailsElement>(
        "details.stat-field__menu[open]",
      ) ?? [])
        syncStatMenuPlacement(menu);
    };
    const scheduleSync = () => {
      if (
        !cardRef.current?.querySelector("details.stat-field__menu[open]")
      )
        return;
      if (frame === null) frame = window.requestAnimationFrame(syncOpenMenus);
    };
    const onToggle = (event: Event) => {
      const target = event.target;
      if (
        !(target instanceof HTMLDetailsElement) ||
        !target.matches("details.stat-field__menu") ||
        !cardRef.current?.contains(target)
      )
        return;
      if (target.open) scheduleSync();
      else syncStatMenuPlacement(target);
    };

    document.addEventListener("toggle", onToggle, true);
    document.addEventListener("scroll", scheduleSync, true);
    window.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("scroll", scheduleSync);
    return () => {
      document.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("scroll", scheduleSync, true);
      window.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("scroll", scheduleSync);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  const askToDelete = (row: { key: string; label: string }) => {
    setRefusal(null);
    setDeleting(row);
  };

  const remove = async () => {
    if (!deleting) return;
    setDeletePending(true);
    try {
      await onDeleteRow(deleting.key);
      setDeleting(null);
    } catch (reason) {
      setRefusal(refusalOf(reason));
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <div ref={cardRef} className={`character-card character-card--${modifier}`}>
      <h3 className="character-card__header">{title}</h3>
      <div className="character-card__body">
        {rows.map((row, index) => (
          <div
            key={row.key}
            className="stat-field"
            onDragOver={(event) => {
              if (canEditLayout && draggedKey && draggedKey !== row.key)
                event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (draggedKey && draggedKey !== row.key && onReorderRow)
                void onReorderRow(draggedKey, row.key);
              setDraggedKey(null);
            }}
          >
            {canEditLayout && (
              <button
                type="button"
                className="stat-field__drag-handle"
                draggable={Boolean(onReorderRow)}
                aria-label={`Переместить «${row.label}»`}
                title="Перетащите строку или используйте стрелки вверх и вниз"
                onDragStart={(event) => {
                  setDraggedKey(row.key);
                  event.dataTransfer.setData("text/plain", row.key);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDraggedKey(null)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    void onMoveRow(
                      row.key,
                      event.key === "ArrowUp" ? "up" : "down",
                    );
                  }
                }}
              >
                <svg
                  className="arken-icon"
                  width="16"
                  height="20"
                  viewBox="0 0 16 20"
                  aria-hidden="true"
                >
                  {[5, 10, 15].flatMap((cy) =>
                    [5, 11].map((cx) => (
                      <circle
                        key={`${cx}-${cy}`}
                        cx={cx}
                        cy={cy}
                        r="1.5"
                        fill="currentColor"
                      />
                    )),
                  )}
                </svg>
              </button>
            )}
            {layoutOnly || isSystemRegenStatKey(row.key) ? (
              <span className="stat-field__roll-name">{row.label}</span>
            ) : (
              <Button
                className="stat-field__roll-name"
                view="flat"
                disabled={!editable || rollPending}
                title={`Бросить ${row.label}`}
                onClick={(event) =>
                  onRoll(
                    `1d20 + ${row.key}`,
                    row.label,
                    rollModeFromEvent(event.nativeEvent),
                  )
                }
              >
                {row.label}
              </Button>
            )}
            {!layoutOnly && (
              <StatValueField
                id={`${fieldIdPrefix}-${encodeURIComponent(row.key)}`}
                label={row.label}
                value={values[row.key] ?? STAT_VALUE_RANGE.defaultValue}
                editable={editable}
                onCommit={(value: number) => onChangeValue(row.key, value)}
              />
            )}
            <div className="stat-field__actions">
              {canEditLayout && (
                <details
                  className="stat-field__menu"
                  onKeyDownCapture={(event) => {
                    const menu = event.currentTarget;
                    if (event.key !== "Escape" || !menu.open) return;
                    const target = event.target;
                    // React keyboard events from a portalled child still pass
                    // through this component. Do not intercept a nested dialog.
                    if (!(target instanceof Node) || !menu.contains(target))
                      return;
                    const targetDialog =
                      target instanceof Element
                        ? target.closest('[role="dialog"], dialog')
                        : null;
                    const ownerDialog = menu.closest('[role="dialog"], dialog');
                    if (targetDialog && targetDialog !== ownerDialog) return;
                    event.preventDefault();
                    event.stopPropagation();
                    menu.open = false;
                    menu.querySelector<HTMLElement>("summary")?.focus();
                  }}
                >
                  <summary aria-label={`Действия строки «${row.label}»`}>
                    …
                  </summary>
                  <div className="stat-field__menu-items">
                    <Button
                      view="flat"
                      className="stat-field__rename"
                      disabled={index === 0}
                      onClick={(event) => {
                        event.preventDefault();
                        void onMoveRow(row.key, "up");
                      }}
                      aria-label={`Переместить «${row.label}» выше`}
                      title="Переместить выше"
                    >
                      <AppIcon icon={MoveUpIcon} />
                      <span className="stat-field__menu-label">Выше</span>
                    </Button>
                    <Button
                      view="flat"
                      className="stat-field__rename"
                      disabled={index === rows.length - 1}
                      onClick={(event) => {
                        event.preventDefault();
                        void onMoveRow(row.key, "down");
                      }}
                      aria-label={`Переместить «${row.label}» ниже`}
                      title="Переместить ниже"
                    >
                      <AppIcon icon={MoveDownIcon} />
                      <span className="stat-field__menu-label">Ниже</span>
                    </Button>
                    <Button
                      view="flat"
                      className="stat-field__rename"
                      onClick={(event) => {
                        event.preventDefault();
                        setEditing({ key: row.key });
                      }}
                      aria-label={`Переименовать «${row.label}»`}
                      title="Переименовать строку"
                    >
                      <AppIcon icon={RenameIcon} />
                      <span className="stat-field__menu-label">Переименовать</span>
                    </Button>
                    <Button
                      view="flat"
                      className="stat-field__rename"
                      disabled={isSystemRegenStatKey(row.key)}
                      onClick={(event) => {
                        event.preventDefault();
                        askToDelete(row);
                      }}
                      aria-label={
                        isSystemRegenStatKey(row.key)
                          ? `Нельзя удалить «${row.label}»: установите значение 0, чтобы отключить восстановление`
                          : `Удалить «${row.label}»`
                      }
                      title={
                        isSystemRegenStatKey(row.key)
                          ? "Системную строку нельзя удалить. Чтобы отключить восстановление, установите значение 0."
                          : "Удалить строку"
                      }
                    >
                      <AppIcon icon={DeleteIcon} />
                      <span className="stat-field__menu-label">Удалить</span>
                    </Button>
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}
        {canEditLayout && showAddRow && (
          <Button
            view="flat"
            className="stat-field__add"
            onClick={() => setEditing({})}
          >
            <AppIcon icon={AddIcon} /> Добавить строку
          </Button>
        )}
      </div>
      <TextPromptDialog
        open={editing !== null}
        title={renamed ? "Переименовать строку" : `Новая строка — ${title}`}
        label="Название"
        initialValue={renamed?.label ?? ""}
        applyLabel="Сохранить"
        onClose={() => setEditing(null)}
        onApply={async (label) => {
          if (renamed) await onRenameRow(renamed.key, label);
          else await onAddRow(label);
          setEditing(null);
        }}
      />
      <ArkenDialog
        open={deleting !== null}
        title={`Удалить «${deleting?.label ?? ""}»?`}
        applyLabel="Удалить"
        danger
        loading={deletePending}
        onApply={() => void remove()}
        onClose={() => setDeleting(null)}
      >
        {refusal === null ? (
          <p>
            Значения этой строки останутся в данных персонажей, но показывать её
            карточка перестанет.
          </p>
        ) : "references" in refusal ? (
          /* Отказ, а не предупреждение: строку держат формулы, и удалить её
           * можно только починив их. Список — это то, что мастеру предстоит
           * открыть, поэтому здесь имена, а не количество. */
          <div role="alert">
            <p>
              Удалить нельзя: на строку ссылаются броски. Сначала поправьте их
              формулы, иначе бросок откажет посреди игры.
            </p>
            <ul>
              {refusal.references.map((reference, index) => (
                <li key={`${reference.kind}-${reference.name}-${index}`}>
                  {`${REFERENCE_KIND_LABELS[reference.kind] ?? reference.kind}: ${reference.name}${
                    reference.owner ? ` — ${reference.owner}` : ""
                  }`}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p role="alert">{refusal.message}</p>
        )}
      </ArkenDialog>
    </div>
  );
}
