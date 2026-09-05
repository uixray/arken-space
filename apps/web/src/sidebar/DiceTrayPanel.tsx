import { useState } from "react";
import type { MessageVisibility } from "@arken/contracts";
import { RollModeControl, type RollMode } from "../RollModeControl";
import { ROLL_MODIFIER_HINT, rollModeFromEvent } from "../roll-modifier-keys";

/**
 * UIX-504: компактная строка костей и режимов. Это более позднее решение,
 * чем две текстовые строки UIX-469: иконки сохраняют title и доступные имена.
 * Своя формула доступна через /roll в редакторе сообщений; второй диалог не нужен.
 * Высота списка характеристик регулируется отдельно в QuickRollPanel.
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
  const [pendingRolls, setPendingRolls] = useState(0);
  const [rollError, setRollError] = useState("");
  const sendRoll: typeof onRoll = async (...args) => {
    setPendingRolls((count) => count + 1);
    setRollError("");
    try {
      await onRoll(...args);
    } catch (error) {
      setRollError(
        error instanceof Error ? error.message : "Не удалось отправить бросок",
      );
    } finally {
      setPendingRolls((count) => count - 1);
    }
  };

  return (
    <section className="dice-tray-panel" aria-label="Физические кости">
      <div className="dice-tray-panel__body">
        <div
          className="dice-tray-panel__toolbar"
          aria-label="Кости и режим броска"
        >
          {[2, 4, 6, 8, 10, 12, 20].map((sides) => (
            <button
              key={sides}
              type="button"
              title={`Бросить d${sides} · ${ROLL_MODIFIER_HINT}`}
              onClick={(event) =>
                void sendRoll(
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

          <RollModeControl
            value={rollMode}
            onChange={setRollMode}
            label="Режим броска"
            iconOnly
          />
          <button
            type="button"
            className="dice-tray-panel__action canvas-roll-gm-toggle"
            title="Броски только мастеру (кости и характеристики)"
            aria-label="Только мастеру"
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
      {pendingRolls > 0 && <p role="status">Бросаем… {pendingRolls}</p>}
      {rollError && <p role="alert">{rollError}</p>}
    </section>
  );
}
