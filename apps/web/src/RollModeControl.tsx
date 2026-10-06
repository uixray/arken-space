import { useId, useRef, type KeyboardEvent } from "react";
import { nextRollMode, rollModeOptions, type RollMode } from "./roll-mode";
import { AppIcon } from "./ui/AppIcon";
import { MoveDownIcon, MoveUpIcon } from "./ui/icons";
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
  const options = iconOnly
    ? rollModeOptions.filter((option) => option.value !== "NORMAL")
    : rollModeOptions;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStopIndex = selectedIndex === -1 ? 0 : selectedIndex;
  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const next = iconOnly
      ? event.key === "Home" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowDown"
        ? "DISADVANTAGE"
        : event.key === "End" ||
            event.key === "ArrowRight" ||
            event.key === "ArrowUp"
          ? "ADVANTAGE"
          : null
      : nextRollMode(value, event.key);
    if (!next) return;
    event.preventDefault();
    const nextIndex = options.findIndex((option) => option.value === next);
    onChange(next);
    // All options already exist. Keep selection and focus in this key event;
    // a deferred focus could steal a subsequent Tab from the next control.
    optionRefs.current[nextIndex]?.focus();
  };

  return (
    <fieldset
      className={`roll-mode-control${iconOnly ? " roll-mode-control--icons" : ""}`}
      role={iconOnly ? "group" : "radiogroup"}
      aria-labelledby={labelId}
      aria-disabled={disabled || undefined}
      disabled={disabled}
    >
      <legend id={labelId} className={iconOnly ? "sr-only" : undefined}>
        {label}
      </legend>
      <div className="roll-mode-segments">
        {options.map((option, index) => (
          <button
            key={option.value}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            type="button"
            role={iconOnly ? undefined : "radio"}
            aria-checked={iconOnly ? undefined : value === option.value}
            aria-pressed={iconOnly ? value === option.value : undefined}
            tabIndex={iconOnly || index === tabStopIndex ? 0 : -1}
            className={value === option.value ? "is-active" : undefined}
            aria-label={option.label}
            title={option.label}
            onClick={() =>
              onChange(
                iconOnly && value === option.value ? "NORMAL" : option.value,
              )
            }
            onKeyDown={selectFromKeyboard}
          >
            {iconOnly ? (
              <AppIcon
                icon={option.value === "ADVANTAGE" ? MoveUpIcon : MoveDownIcon}
              />
            ) : (
              option.label
            )}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
