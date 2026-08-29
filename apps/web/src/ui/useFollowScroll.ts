import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type UIEvent as ReactUIEvent,
} from "react";

/** Distance (px) from the true bottom that still counts as "at bottom". */
const FOLLOW_SCROLL_BOTTOM_THRESHOLD = 48;

export type FollowScrollListMetrics = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
};

/**
 * Pure predicate behind the auto-follow decision: is the list scrolled close
 * enough to its end that newly arriving items should keep it pinned there?
 */
export function isNearListBottom(
  metrics: FollowScrollListMetrics,
  threshold = FOLLOW_SCROLL_BOTTOM_THRESHOLD,
): boolean {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold
  );
}

/**
 * Auto-follow behavior for append-only message/event lists: stay pinned to
 * the bottom while the reader hasn't scrolled away, otherwise accumulate a
 * "new items" counter and surface it via a floating scroll-to-bottom action.
 *
 * `latestItemKey` identifies the newest rendered item (e.g. a message id) —
 * a change is what triggers the follow-or-count decision. `resetKey`
 * identifies the "view" the list belongs to (e.g. the active stream or
 * thread id); a change forces an immediate, unanimated jump to the bottom
 * and clears follow state, which also covers the initial mount.
 */
export function useFollowScroll(
  latestItemKey: string | number | null | undefined,
  resetKey?: unknown,
) {
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newItemCount, setNewItemCount] = useState(0);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior });
    followRef.current = true;
    setIsAtBottom(true);
    setNewItemCount(0);
  }, []);

  useEffect(() => {
    followRef.current = true;
    setIsAtBottom(true);
    setNewItemCount(0);
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) list.scrollTo({ top: list.scrollHeight });
    });
  }, [resetKey]);

  /**
   * UIX-493: закрепление у дна обязано переживать содержимое, которое
   * дорастает уже после закрепления.
   *
   * Прыжок вниз при монтировании происходит через один кадр
   * `requestAnimationFrame`, то есть до того, как разложатся аватары, стикеры
   * и вложения: `scrollHeight` на этот момент меньше настоящего, и «низ»
   * оказывается выше последних записей. Замер на живом стенде: содержимое,
   * выросшее на 512 px после закрепления, оставляло ленту ровно на эти 512 px
   * выше дна, и вернуть её могло только следующее сообщение — которого при
   * входе в игру никто не ждёт. Снаружи это и выглядит как «бегунок всегда в
   * начале».
   *
   * Поэтому размер, а не только приход записи: пока читающий у дна
   * (`followRef.current`), любое изменение высоты списка или его карточек
   * возвращает прокрутку к концу. Стоит человеку уйти вверх — наблюдатель
   * молчит, иначе подгрузившаяся картинка выдёргивала бы его из чтения.
   *
   * Карточки наблюдаются поимённо, а не через `subtree`: `ResizeObserver`
   * сообщает о размере только тех элементов, на которые подписан, а высоту
   * картинки внутри карточки видно по самой карточке. Состав списка меняется,
   * поэтому подписка обновляется по `MutationObserver`.
   *
   * `scrollTo` размеров не меняет, так что обратной связи здесь нет: подписка
   * не может разбудить сама себя.
   */
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const pinToBottom = () => {
      if (followRef.current) list.scrollTo({ top: list.scrollHeight });
    };
    const sizes = new ResizeObserver(pinToBottom);
    sizes.observe(list);
    const watched = new Set<Element>();
    const syncChildren = () => {
      for (const child of watched)
        if (child.parentNode !== list) {
          watched.delete(child);
          sizes.unobserve(child);
        }
      for (const child of list.children)
        if (!watched.has(child)) {
          watched.add(child);
          sizes.observe(child);
        }
    };
    syncChildren();
    const children = new MutationObserver(syncChildren);
    children.observe(list, { childList: true });
    return () => {
      sizes.disconnect();
      children.disconnect();
    };
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list || latestItemKey === null || latestItemKey === undefined) return;
    if (followRef.current) {
      list.scrollTo({ top: list.scrollHeight });
      setNewItemCount(0);
    } else {
      setNewItemCount((current) => current + 1);
    }
  }, [latestItemKey]);

  const onScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    const nextAtBottom = isNearListBottom(list);
    followRef.current = nextAtBottom;
    setIsAtBottom(nextAtBottom);
    if (nextAtBottom) setNewItemCount(0);
  }, []);

  return { listRef, isAtBottom, newItemCount, scrollToBottom, onScroll };
}
