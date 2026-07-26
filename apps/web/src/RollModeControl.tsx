import { useId, useRef, type KeyboardEvent } from "react";
import { nextRollMode, rollModeOptions, type RollMode } from "./roll-mode";
export type { RollMode } from "./roll-mode";

export function RollModeControl({
  value,
  onChange,
  disabled = false,
  label = "Режим броска",
  iconOnly = false,
}: {
  value: RollMode | undefined;
  onChange: (value: RollMode) => void;
  disabled?: boolean;
  label?: string;
  iconOnly?: boolean;
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
      className={`roll-mode-control${iconOnly ? " roll-mode-control--icons" : ""}`}
      role="radiogroup"
      aria-labelledby={labelId}
      aria-disabled={disabled || undefined}
      disabled={disabled}
    >
      <legend id={labelId} className={iconOnly ? "sr-only" : undefined}>
        {label}
      </legend>
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
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.value)}
            onKeyDown={selectFromKeyboard}
          >
            {iconOnly
              ? option.value === "ADVANTAGE"
                ? "↑"
                : option.value === "DISADVANTAGE"
                  ? "↓"
                  : "●"
              : option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
