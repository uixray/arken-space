import { useRef, useState } from "react";
import type { MessageVisibility } from "@arken/contracts";
import { RollModeControl, type RollMode } from "../RollModeControl";
import { ROLL_MODIFIER_HINT, rollModeFromEvent } from "../roll-modifier-keys";
import { AppIcon } from "../ui/AppIcon";
import { SecretRollIcon } from "../ui/icons";
import { useRepeatRoll } from "./use-repeat-roll";

const pureRollNames: Record<number, string> = {
  2: "чеканной монеты",
  4: "калтропа",
  6: "куба",
  8: "бриллианта",
  10: "десятки",
  12: "дюжины",
  20: "двадцатки",
  100: "стогранника",
};

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
  const rollModeRef = useRef<RollMode>("NORMAL");
  const selectRollMode = (next: RollMode) => {
    rollModeRef.current = next;
    setRollMode(next);
  };
  const [pendingRolls, setPendingRolls] = useState(0);
  const [rollError, setRollError] = useState("");
  const { onRollClick, popover } = useRepeatRoll();
  const sendRolls = async (
    count: number,
    ...args: Parameters<typeof onRoll>
  ) => {
    setPendingRolls((count) => count + 1);
    setRollError("");
    try {
      for (let index = 0; index < count; index += 1) await onRoll(...args);
    } catch (error) {
      setRollError(
        error instanceof Error ? error.message : "Не удалось отправить бросок",
      );
    } finally {
      setPendingRolls((count) => count - 1);
    }
  };

  return (
    <section
      className="dice-tray-panel"
      aria-label="Физические кости"
      aria-busy={pendingRolls > 0}
    >
      <div className="dice-tray-panel__body">
        <div
          className="dice-tray-panel__toolbar"
          aria-label="Кости и режим броска"
        >
          {[2, 4, 6, 8, 10, 12, 20, 100].map((sides) => (
            <button
              key={sides}
              type="button"
              title={`Бросить d${sides} · ${ROLL_MODIFIER_HINT}`}
              onClick={(event) => {
                const mode = rollModeFromEvent(
                  event.nativeEvent,
                  rollModeRef.current,
                );
                onRollClick(event, (count) => {
                  // The mode is a one-shot modifier. Consume it only when
                  // the delayed single or chosen batch actually dispatches.
                  selectRollMode("NORMAL");
                  void sendRolls(
                    count,
                    `1d${sides}`,
                    `Чистый бросок ${pureRollNames[sides]}`,
                    visibility,
                    characterId,
                    mode,
                  );
                });
              }}
            >
              d{sides}
            </button>
          ))}

          <RollModeControl
            value={rollMode}
            onChange={selectRollMode}
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
            <AppIcon icon={SecretRollIcon} />
          </button>
        </div>
      </div>

      {rollError && <p role="alert">{rollError}</p>}
      {popover}
    </section>
  );
}
