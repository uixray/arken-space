import { useState } from "react";
import type { MessageVisibility } from "@arken/contracts";
import { RollModeControl, type RollMode } from "../RollModeControl";
import {
  ROLL_MODIFIER_HINT,
  rollModeFromEvent,
} from "../roll-modifier-keys";
import { TextPromptDialog } from "../ui/TextPromptDialog";

/**
 * Sidebar-resident physical dice tray (UIX-387). Corrects UIX-363, which
 * made the character-stat quick-roll panel draggable instead of relocating
 * this tray -- the d2/d4/.../d20/fx dice buttons, roll-mode control and
 * GM-only visibility toggle -- out of its canvas-bottom floating overlay
 * (`CanvasRollOverlay`, now removed). It renders as a normal document-flow
 * sidebar section.
 *
 * UIX-455: вертикальная ручка отсюда убрана. Кнопок здесь ровно семь костей,
 * режим броска и два переключателя — высота не меняется от содержимого, и
 * тянуть было нечего. Ручка переехала на панель быстрых бросков, где список
 * растёт вместе с раскладкой кампании.
 */
export function DiceTrayPanel({
  characterId,
  visibility,
  onVisibilityChange,
  onRoll,
}: {
  characterId: string | null;
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

  return (
    <section className="dice-tray-panel" aria-label="Физические кости">
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
                title={`Бросить d${sides} · ${ROLL_MODIFIER_HINT}`}
                onClick={(event) =>
                  void onRoll(
                    `1d${sides}`,
                    `d${sides}`,
                    visibility,
                    characterId,
                    // UIX-456: зажатая клавиша перекрывает переключатель на
                    // один бросок и не трогает выставленный режим.
                    rollModeFromEvent(event.nativeEvent, rollMode),
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
