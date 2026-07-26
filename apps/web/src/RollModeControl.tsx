import { useId, useRef, type KeyboardEvent } from "react";
import { nextRollMode, rollModeOptions, type RollMode } from "./roll-mode";
export type { RollMode } from "./roll-mode";

export function RollModeControl({
  value,
  onChange,
  disabled = false,
  label = "Режим броска",
}: {
  value: RollMode | undefined;
  onChange: (value: RollMode) => void;
  disabled?: boolean;
  label?: string;
}) {
  const labelId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = rollModeOptions.findIndex(
    (option) => option.value === value,
  );
  const tabStopIndex = selectedIndex === -1 ? 1 : selectedIndex;
  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const next = nextRollMode(value, event.key);
    if (!next) return;
    event.preventDefault();
    const nextIndex = rollModeOptions.findIndex(
      (option) => option.value === next,
    );
    onChange(next);
    requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus());
  };

  return (
    <fieldset
      className="roll-mode-control"
      role="radiogroup"
      aria-labelledby={labelId}
      aria-disabled={disabled || undefined}
      disabled={disabled}
    >
      <legend id={labelId}>{label}</legend>
      <div className="roll-mode-segments">
        {rollModeOptions.map((option, index) => (
          <button
            key={option.value}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            tabIndex={index === tabStopIndex ? 0 : -1}
            className={value === option.value ? "is-active" : undefined}
            onClick={() => onChange(option.value)}
            onKeyDown={selectFromKeyboard}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
