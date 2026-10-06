import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  clampSidebarWidth,
  readSidebarWidth,
  writeSidebarWidth,
} from "./sidebar-width-preference";

export function useSidebarResize(campaignId?: string, membershipId?: string) {
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const sidebarWidthRef = useRef<number | null>(null);
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);
  const sidebarResizeDragRef = useRef<{
    pointerId: number;
    anchorRight: number;
  } | null>(null);

  useEffect(() => {
    if (!campaignId || !membershipId) return;
    setSidebarWidth(
      readSidebarWidth(window.localStorage, campaignId, membershipId),
    );
  }, [campaignId, membershipId]);

  const handleSidebarResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      const aside = event.currentTarget.closest<HTMLElement>(".sidebar");
      const rect = aside?.getBoundingClientRect();
      if (!rect) return;
      sidebarResizeDragRef.current = {
        pointerId: event.pointerId,
        anchorRight: rect.right,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [],
  );
  const handleSidebarResizeMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = sidebarResizeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      setSidebarWidth(clampSidebarWidth(drag.anchorRight - event.clientX));
      event.preventDefault();
    },
    [],
  );
  const handleSidebarResizeEnd = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = sidebarResizeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      sidebarResizeDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (campaignId && membershipId && sidebarWidthRef.current != null) {
        writeSidebarWidth(
          window.localStorage,
          campaignId,
          membershipId,
          sidebarWidthRef.current,
        );
      }
    },
    [campaignId, membershipId],
  );

  return {
    sidebarWidth,
    handleSidebarResizeStart,
    handleSidebarResizeMove,
    handleSidebarResizeEnd,
  };
}
