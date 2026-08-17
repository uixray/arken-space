import { useLayoutEffect, useRef, useState } from "react";
import { useDismissibleDetails } from "./ui/dismissible-details";
import {
  splitWorkspaceNav,
  type WorkspaceId,
  type WorkspaceNavItem,
} from "./workspace-nav";

/**
 * UIX-472 — разделы строкой, а не выпадающим списком.
 *
 * Раньше любой переход стоил двух действий: открыть «Рабочее пространство»,
 * потом выбрать. Разделов немного, и почти все помещаются в строку — прятать их
 * все ради одного-двух лишних было платой не по адресу.
 *
 * Сколько поместится, решает измерение, а не заданное число пунктов: подписи
 * разной длины, а панель делит ширину с именем кампании, выбором сцены и
 * музыкой. Пересчёт идёт на каждое изменение размеров окна и самой панели.
 */
export function WorkspaceNav({
  items,
  active,
  onSelect,
}: {
  items: readonly WorkspaceNavItem[];
  active: WorkspaceId | null;
  onSelect: (workspace: WorkspaceId) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const [available, setAvailable] = useState(0);
  const [widths, setWidths] = useState<ReadonlyMap<WorkspaceId, number>>(
    new Map(),
  );
  /** Ширина кнопки «Ещё» — измеряется, а не угадывается константой. */
  const [moreWidth, setMoreWidth] = useState(84);
  useDismissibleDetails(moreRef);

  /**
   * Ширины снимаются со скрытой копии строки, а не с видимой: видимая уже
   * урезана прошлым решением, и мерить по ней — значит считать по следствию
   * собственного расчёта, раскачивая раскладку от кадра к кадру.
   */
  useLayoutEffect(() => {
    const measured = new Map<WorkspaceId, number>();
    for (const node of measureRef.current?.children ?? []) {
      const id = (node as HTMLElement).dataset.workspace as
        WorkspaceId | undefined;
      if (id) measured.set(id, node.getBoundingClientRect().width);
    }
    setWidths(measured);
    const more = measureRef.current?.querySelector<HTMLElement>(
      "[data-measure='more']",
    );
    if (more) setMoreWidth(more.getBoundingClientRect().width);
  }, [items]);

  /**
   * Доступная ширина снимается тремя путями сразу, и это не перестраховка.
   *
   * `ResizeObserver` — основной, но он ловит не всё и есть не везде: во
   * встроенном браузере предпросмотра он существует, а колбэки не приходят
   * вовсе, и строка молча застывала на первом замере. `resize` окна закрывает
   * самый частый случай, а замер на каждом рендере — смену состава разделов и
   * всё, о чём не сообщил ни один из двух.
   *
   * Замер на рендере безопасен именно потому, что ширина строки не зависит от
   * её содержимого (см. `flex: 1 1 0` в стилях): убранная кнопка не меняет
   * ширину, значит новый замер не запускает следующий.
   */
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const width = row.getBoundingClientRect().width;
      setAvailable((previous) =>
        Math.abs(previous - width) > 0.5 ? width : previous,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(row);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  });

  const gap = 6;
  const { visible, overflow } = splitWorkspaceNav(
    items,
    widths,
    available,
    moreWidth,
    gap,
  );

  const button = (item: WorkspaceNavItem, inMenu: boolean) => (
    <button
      key={item.id}
      type="button"
      className={inMenu ? undefined : "workspace-nav__item"}
      data-workspace={item.id}
      aria-pressed={active === item.id}
      onClick={() => {
        onSelect(item.id);
        if (moreRef.current) moreRef.current.open = false;
      }}
    >
      {item.label}
    </button>
  );

  return (
    <div className="workspace-nav" ref={rowRef} aria-label="Разделы">
      {/* Копия строки для измерения: не видна, не читается программами чтения
          с экрана и не ловит указатель. */}
      <div className="workspace-nav__measure" ref={measureRef} aria-hidden>
        {items.map((item) => (
          <span key={item.id} data-workspace={item.id}>
            {item.label}
          </span>
        ))}
        <span data-measure="more">Ещё {items.length}</span>
      </div>
      {visible.map((item) => button(item, false))}
      {overflow.length > 0 && (
        <details className="workspace-nav__more" ref={moreRef}>
          <summary aria-label="Ещё разделы">
            Ещё
            <span className="workspace-nav__count" aria-hidden="true">
              {overflow.length}
            </span>
          </summary>
          <div className="workspace-nav__menu">
            {overflow.map((item) => button(item, true))}
          </div>
        </details>
      )}
    </div>
  );
}
