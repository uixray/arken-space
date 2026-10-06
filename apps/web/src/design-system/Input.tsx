import {
  forwardRef,
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { Input as BaseInput } from "@base-ui/react/input";
import { CloseIcon as X } from "../ui/icons";
import "./Input.css";

export type InputSize = "s" | "m" | "l";
export type InputView = "normal" | "clear";
export type InputPin =
  "round-round" | "brick-brick" | "round-brick" | "brick-round" | "clear-clear";

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size"
> {
  size?: InputSize | number;
  view?: InputView;
  pin?: InputPin;
  label?: ReactNode;
  onUpdate?: (value: string) => void;
  startSlot?: ReactNode;
  endSlot?: ReactNode;
  controlRef?: Ref<HTMLInputElement>;
  controlProps?: InputHTMLAttributes<HTMLInputElement>;
  validationState?: "invalid";
  errorMessage?: ReactNode;
  hasClear?: boolean;
  onClear?: () => void;
  qa?: string;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (instance: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") {
        ref(instance);
      } else if (typeof ref === "object" && "current" in ref) {
        (ref as React.MutableRefObject<T | null>).current = instance;
      }
    }
  };
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    size = "m",
    view = "normal",
    pin = "round-round",
    label,
    onUpdate,
    startSlot,
    endSlot,
    controlRef,
    controlProps,
    validationState,
    errorMessage: _errorMessage,
    hasClear,
    onClear,
    qa,
    className,
    style,
    disabled,
    value,
    defaultValue,
    onChange,
    type = "text",
    "aria-invalid": ariaInvalidProp,
    ...restProps
  },
  ref,
) {
  const combinedRef = mergeRefs(ref, controlRef);
  const labelId = useId();

  const isInvalid =
    validationState === "invalid" ||
    (ariaInvalidProp !== undefined &&
      ariaInvalidProp !== false &&
      ariaInvalidProp !== "false");

  const sizeClass =
    typeof size === "string"
      ? `g-text-input_size_${size} arken-text-input--${size}`
      : "g-text-input_size_m arken-text-input--m";

  const wrapperClassName = cx(
    "arken-text-input",
    "g-text-input",
    `g-text-input_view_${view}`,
    `g-text-input_pin_${pin}`,
    sizeClass,
    disabled && "g-text-input_disabled arken-text-input--disabled",
    isInvalid && "g-text-input_invalid",
    className,
  );

  const mergedControlProps = {
    ...restProps,
    ...controlProps,
  };

  const showClear =
    Boolean(hasClear && onClear && !disabled) &&
    Boolean(value !== undefined ? value : defaultValue);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange?.(event);
    onUpdate?.(event.target.value);
  };

  return (
    <span
      className={wrapperClassName}
      style={style}
      data-qa={qa}
      data-invalid={isInvalid ? "true" : undefined}
    >
      <span className="arken-text-input__content g-text-input__content">
        {label && (
          <span
            id={labelId}
            className="arken-text-input__label g-text-input__label"
          >
            {label}
          </span>
        )}
        {startSlot && (
          <span className="arken-text-input__slot arken-text-input__slot--start">
            {startSlot}
          </span>
        )}
        <BaseInput
          {...mergedControlProps}
          ref={combinedRef}
          type={type}
          disabled={disabled}
          value={value}
          defaultValue={defaultValue}
          onChange={handleChange}
          className={cx(
            "arken-text-input__control",
            "g-text-input__control",
            mergedControlProps.className,
          )}
          aria-labelledby={
            mergedControlProps["aria-labelledby"] ??
            (label && !mergedControlProps["aria-label"] ? labelId : undefined)
          }
          aria-invalid={isInvalid ? "true" : undefined}
        />
        {showClear && (
          <button
            type="button"
            className="arken-text-input__clear"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClear?.();
            }}
            tabIndex={-1}
            aria-label="Очистить"
          >
            <X size={14} />
          </button>
        )}
        {endSlot && (
          <span className="arken-text-input__slot arken-text-input__slot--end">
            {endSlot}
          </span>
        )}
      </span>
    </span>
  );
});
