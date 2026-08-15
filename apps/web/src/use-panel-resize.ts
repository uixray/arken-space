import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampPanelHeight,
  readPanelHeight,
  writePanelHeight,
} from "./panel-height-preference";

/**
 * UIX-455 — перетаскивание нижней кромки панели.
 *
 * Вытащено из `DiceTrayPanel`, откуда ручка уехала, вместо того чтобы быть
 * переписанным на новом месте: логика захвата указателя и записи высоты
 * одинакова для любой панели, и вторая её копия разошлась бы с первой на первом
 * же исправлении.
 *
 * Высота пишется в хранилище на отпускании, а не на каждом движении: запись на
 * `pointermove` — это десятки обращений к localStorage за один жест.
 */
export function usePanelResize({
  panel,
  blockClassName,
  campaignId,
  membershipId,
}: {
  /** Имя панели в ключе хранения — своё у каждой. */
  panel: string;
  /** Класс блока, чью высоту тянут: от его верха считается новая высота. */
  blockClassName: string;
  campaignId: string;
  membershipId: string;
}) {
  const [height, setHeight] = useState<number | null>(null);
  const heightRef = useRef<number | null>(null);
  useEffect(() => {
    heightRef.current = height;
  }, [height]);
  useEffect(() => {
    setHeight(
      readPanelHeight(window.localStorage, panel, campaignId, membershipId),
    );
  }, [panel, campaignId, membershipId]);

  const dragRef = useRef<{ pointerId: number; anchorTop: number } | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      const rect = event.currentTarget
        .closest<HTMLElement>(`.${blockClassName}`)
        ?.getBoundingClientRect();
      if (!rect) return;
      dragRef.current = { pointerId: event.pointerId, anchorTop: rect.top };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [blockClassName],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      setHeight(clampPanelHeight(event.clientY - drag.anchorTop));
      event.preventDefault();
    },
    [],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      if (heightRef.current != null)
        writePanelHeight(
          window.localStorage,
          panel,
          campaignId,
          membershipId,
          heightRef.current,
        );
    },
    [panel, campaignId, membershipId],
  );

  return {
    height,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
