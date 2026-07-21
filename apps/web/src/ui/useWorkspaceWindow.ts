import {
  useCallback,
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

export const WORKSPACE_WINDOW_DESKTOP_BREAKPOINT = 768;
export const WORKSPACE_WINDOW_VIEWPORT_GUTTER = 16;

const WORKSPACE_WINDOW_BASE_Z_INDEX = 1200;
// Gravity dialogs use 2000, so a workspace window can never cover a nested
// blocking editor even after it has been focused repeatedly.
const WORKSPACE_WINDOW_MAX_Z_INDEX = 1999;

let nextWorkspaceZIndex = WORKSPACE_WINDOW_BASE_Z_INDEX;

export type WorkspaceWindowPosition = {
  left: number;
  top: number;
};

export type WorkspaceWindowBounds = {
  width: number;
  height: number;
};

export type WorkspaceViewport = {
  width: number;
  height: number;
};

/**
 * Keeps a positioned workspace window reachable inside the browser viewport.
 * The `Math.max` also handles a transiently small visual viewport safely.
 */
export function clampWorkspaceWindowPosition(
  position: WorkspaceWindowPosition,
  bounds: WorkspaceWindowBounds,
  viewport: WorkspaceViewport,
  gutter = WORKSPACE_WINDOW_VIEWPORT_GUTTER,
): WorkspaceWindowPosition {
  const maxLeft = Math.max(gutter, viewport.width - bounds.width - gutter);
  const maxTop = Math.max(gutter, viewport.height - bounds.height - gutter);

  return {
    left: Math.min(Math.max(position.left, gutter), maxLeft),
    top: Math.min(Math.max(position.top, gutter), maxTop),
  };
}

function isDesktopWorkspaceViewport() {
  return window.innerWidth >= WORKSPACE_WINDOW_DESKTOP_BREAKPOINT;
}

function allocateWorkspaceZIndex() {
  nextWorkspaceZIndex = Math.min(
    nextWorkspaceZIndex + 1,
    WORKSPACE_WINDOW_MAX_Z_INDEX,
  );
  return nextWorkspaceZIndex;
}

type WorkspaceWindowDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  width: number;
  height: number;
};

function readDragState(element: HTMLElement): WorkspaceWindowDrag | null {
  const encoded = element.dataset.workspaceWindowDrag;
  if (!encoded) return null;
  try {
    return JSON.parse(encoded) as WorkspaceWindowDrag;
  } catch {
    return null;
  }
}

export function useWorkspaceWindow(enabled: boolean) {
  const [windowElement, setWindowElement] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<WorkspaceWindowPosition | null>(
    null,
  );
  const [zIndex, setZIndex] = useState(WORKSPACE_WINDOW_BASE_Z_INDEX);

  const bringToFront = useCallback(() => {
    if (enabled) setZIndex(allocateWorkspaceZIndex());
  }, [enabled]);

  const clampPositionToViewport = useCallback(() => {
    const element = windowElement;
    if (!element || !isDesktopWorkspaceViewport()) return;
    const bounds = element.getBoundingClientRect();
    setPosition((current) =>
      current
        ? clampWorkspaceWindowPosition(current, bounds, {
            width: window.innerWidth,
            height: window.innerHeight,
          })
        : current,
    );
  }, [windowElement]);

  useEffect(() => {
    if (!enabled) return;
    const onViewportResize = () => clampPositionToViewport();
    window.addEventListener("resize", onViewportResize);
    return () => window.removeEventListener("resize", onViewportResize);
  }, [clampPositionToViewport, enabled]);

  const onDragStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || !isDesktopWorkspaceViewport() || event.button !== 0)
        return;

      const bounds = windowElement?.getBoundingClientRect();
      if (!bounds) return;

      bringToFront();
      event.currentTarget.dataset.workspaceWindowDrag = JSON.stringify({
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: bounds.left,
        startTop: bounds.top,
        width: bounds.width,
        height: bounds.height,
      } satisfies WorkspaceWindowDrag);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [bringToFront, enabled, windowElement],
  );

  const onDragMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = readDragState(event.currentTarget);
    if (!drag || drag.pointerId !== event.pointerId) return;

    setPosition(
      clampWorkspaceWindowPosition(
        {
          left: drag.startLeft + event.clientX - drag.startX,
          top: drag.startTop + event.clientY - drag.startY,
        },
        { width: drag.width, height: drag.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    event.preventDefault();
  }, []);

  const stopDragging = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (readDragState(event.currentTarget)?.pointerId !== event.pointerId)
      return;
    delete event.currentTarget.dataset.workspaceWindowDrag;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const resetLayout = useCallback(() => setPosition(null), []);

  return {
    setWindowElement,
    position,
    zIndex,
    bringToFront,
    onDragStart,
    onDragMove,
    stopDragging,
    resetLayout,
  };
}
