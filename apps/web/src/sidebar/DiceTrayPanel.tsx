import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { MessageVisibility } from "@arken/contracts";
import {
  clampDiceTrayHeight,
  readDiceTrayHeight,
  writeDiceTrayHeight,
} from "../dice-tray-height-preference";
import { RollModeControl, type RollMode } from "../RollModeControl";
import { TextPromptDialog } from "../ui/TextPromptDialog";

/**
 * Sidebar-resident physical dice tray (UIX-387). Corrects UIX-363, which
 * made the character-stat quick-roll panel draggable instead of relocating
 * this tray -- the d2/d4/.../d20/fx dice buttons, roll-mode control and
 * GM-only visibility toggle -- out of its canvas-bottom floating overlay
 * (`CanvasRollOverlay`, now removed). It renders as a normal document-flow
 * sidebar section with a vertical resize handle, mirroring the sidebar's
 * own horizontal resize (`sidebar-width-preference.ts` +
 * `App.tsx#handleSidebarResize*`).
 */
export function DiceTrayPanel({
  characterId,
  campaignId,
  membershipId,
  visibility,
  onVisibilityChange,
  onRoll,
}: {
  characterId: string | null;
  campaignId: string;
  membershipId: string;
  /**
   * UIX-388 follow-up: visibility is owned by `ActivityPanel` and shared with
   * the stat/skill quick-roll panel next door, so one toggle governs every
   * roll made from the sidebar. Removing the composer's «Только мастеру»
   * checkbox otherwise left stat and skill rolls permanently public, which
   * silently dropped secret checks (perception, deception) from the game.
   */
  visibility: MessageVisibility;
  onVisibilityChange: (visibility: MessageVisibility) => void;
  onRoll: (
    formula: string,
    label?: string,
    visibility?: MessageVisibility,
    characterId?: string | null,
    rollMode?: RollMode,
  ) => Promise<void>;
}) {
  const [rollMode, setRollMode] = useState<RollMode>("NORMAL");
  const [customRollOpen, setCustomRollOpen] = useState(false);

  const [height, setHeight] = useState<number | null>(null);
  const heightRef = useRef<number | null>(null);
  useEffect(() => {
    heightRef.current = height;
  }, [height]);
  useEffect(() => {
    setHeight(readDiceTrayHeight(window.localStorage, campaignId, membershipId));
  }, [campaignId, membershipId]);
  const resizeDragRef = useRef<{
    pointerId: number;
    anchorTop: number;
  } | null>(null);

  const onResizeHandleDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      const block = event.currentTarget.closest<HTMLElement>(
        ".dice-tray-panel",
      );
      const rect = block?.getBoundingClientRect();
      if (!rect) return;
      resizeDragRef.current = {
        pointerId: event.pointerId,
        anchorTop: rect.top,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [],
  );
  const onResizeHandleMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = resizeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      setHeight(clampDiceTrayHeight(event.clientY - drag.anchorTop));
      event.preventDefault();
    },
    [],
  );
  const onResizeHandleUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = resizeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      resizeDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (heightRef.current != null) {
        writeDiceTrayHeight(
          window.localStorage,
          campaignId,
          membershipId,
          heightRef.current,
        );
      }
    },
    [campaignId, membershipId],
  );

  return (
    <section
      className="dice-tray-panel"
      aria-label="Физические кости"
      style={height != null ? { height } : undefined}
    >
      <div className="dice-tray-panel__body">
        <div className="canvas-roll-row">
          <RollModeControl
            value={rollMode}
            onChange={setRollMode}
            label="Режим броска"
            iconOnly
          />
          <div className="canvas-roll-dice" aria-label="Кости">
            {[2, 4, 6, 8, 10, 12, 20].map((sides) => (
              <button
                key={sides}
                type="button"
                title={`Бросить d${sides}`}
                onClick={() =>
                  void onRoll(
                    `1d${sides}`,
                    `d${sides}`,
                    visibility,
                    characterId,
                    rollMode,
                  )
                }
              >
                d{sides}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="canvas-roll-custom"
            aria-label="Своя формула"
            title="Своя формула"
            onClick={() => setCustomRollOpen(true)}
          >
            <span aria-hidden="true">fx</span>
          </button>
          <button
            type="button"
            className="canvas-roll-gm-toggle"
            aria-label="Броски только мастеру"
            title="Броски только мастеру (кости и характеристики)"
            aria-pressed={visibility === "GM_ONLY"}
            onClick={() =>
              onVisibilityChange(
                visibility === "GM_ONLY" ? "PUBLIC" : "GM_ONLY",
              )
            }
          >
            <span aria-hidden="true">◆</span>
          </button>
        </div>
      </div>
      <button
        type="button"
        className="dice-tray-resize-handle"
        aria-label="Изменить высоту панели костей"
        title="Перетащите, чтобы изменить высоту панели костей"
        onPointerDown={onResizeHandleDown}
        onPointerMove={onResizeHandleMove}
        onPointerUp={onResizeHandleUp}
        onPointerCancel={onResizeHandleUp}
      />
      <TextPromptDialog
        open={customRollOpen}
        title="Быстрый бросок"
        label="Формула броска"
        initialValue="1d20"
        applyLabel="Бросить"
        onClose={() => setCustomRollOpen(false)}
        onApply={async (formula) => {
          await onRoll(
            formula,
            "Быстрый бросок",
            visibility,
            characterId,
            rollMode,
          );
          setCustomRollOpen(false);
        }}
      />
    </section>
  );
}
