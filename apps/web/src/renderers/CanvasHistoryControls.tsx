import { useCallback, useEffect, useRef, useState } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { api } from "../api";
import { isEditableEventTarget } from "../input-diagnostics";
import {
  historyControlLabel,
  nextHistoryEntry,
  type CanvasHistoryEntry,
} from "../canvas-history-label";

export interface CanvasHistoryControlsProps {
  sceneId?: string;
  disabled: boolean;
  version: string;
  /** Источник имён объектов — и единственный: он уже отфильтрован по роли. */
  snapshot: GameSnapshot;
}

export function CanvasHistoryControls({
  sceneId,
  disabled,
  version,
  snapshot,
}: CanvasHistoryControlsProps) {
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const requestKey = JSON.stringify([
    sceneId ?? null,
    disabled,
    version,
    refreshEpoch,
  ]);
  const [historyState, setHistoryState] = useState<{
    requestKey: string;
    entries: CanvasHistoryEntry[];
  }>({ requestKey: "", entries: [] });
  const historyRequestGeneration = useRef(0);
  const history =
    historyState.requestKey === requestKey ? historyState.entries : [];

  useEffect(() => {
    const generation = ++historyRequestGeneration.current;
    let cancelled = false;
    if (!sceneId || disabled) {
      setHistoryState({ requestKey, entries: [] });
      return () => {
        cancelled = true;
      };
    }
    void api<CanvasHistoryEntry[]>(`/api/canvas/history?sceneId=${sceneId}`)
      .then((entries) => {
        if (cancelled || generation !== historyRequestGeneration.current)
          return;
        setHistoryState({ requestKey, entries });
      })
      .catch(() => {
        if (cancelled || generation !== historyRequestGeneration.current)
          return;
        setHistoryState({ requestKey, entries: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [sceneId, disabled, requestKey]);

  const nextUndo = nextHistoryEntry("undo", history);
  const nextRedo = nextHistoryEntry("redo", history);
  const canUndo = nextUndo !== undefined;
  const canRedo = nextRedo !== undefined;

  const act = useCallback(
    async (direction: "undo" | "redo") => {
      if (!sceneId) return;
      await api(`/api/canvas/${direction}`, {
        method: "POST",
        body: JSON.stringify({ actionId: crypto.randomUUID(), sceneId }),
      });
      setRefreshEpoch((epoch) => epoch + 1);
    },
    [sceneId],
  );

  useEffect(() => {
    if (!sceneId || disabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing || isEditableEventTarget(event.target)) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z")
        return;
      event.preventDefault();
      const direction = event.shiftKey ? "redo" : "undo";
      if (direction === "undo" ? canUndo : canRedo)
        void act(direction).catch(() => undefined);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sceneId, disabled, canUndo, canRedo, act]);

  // Подпись и всплывающая подсказка — один и тот же текст: подсказка недоступна
  // ни клавиатуре, ни программе чтения с экрана, и расходиться им незачем.
  const undoLabel = historyControlLabel("undo", nextUndo, snapshot);
  const redoLabel = historyControlLabel("redo", nextRedo, snapshot);

  return (
    <>
      <button
        className="map-tool"
        data-tool="UNDO"
        aria-label={undoLabel}
        title={undoLabel}
        disabled={disabled || !canUndo}
        onClick={() => void act("undo")}
      >
        <span aria-hidden="true">&#x21b6;</span>
      </button>
      <button
        className="map-tool"
        data-tool="REDO"
        aria-label={redoLabel}
        title={redoLabel}
        disabled={disabled || !canRedo}
        onClick={() => void act("redo")}
      >
        <span aria-hidden="true">&#x21b7;</span>
      </button>
    </>
  );
}
