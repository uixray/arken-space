import {
  forwardRef,
  useId,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FocusEventHandler,
  type InputHTMLAttributes,
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
} from "react";
import { SelectedOptionIcon as Check, DecreaseIcon as Minus } from "../ui/icons";
import "./Checkbox.css";

export type CheckboxSize = "s" | "m" | "l";

export interface CheckboxProps {
  id?: string;
  name?: string;
  value?: string | number | readonly string[];
  checked?: boolean;
  defaultChecked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  required?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  size?: CheckboxSize;
  className?: string;
  style?: CSSProperties;
  title?: string;
  tabIndex?: number;
  children?: ReactNode;
  content?: ReactNode;
  controlRef?: Ref<HTMLInputElement>;
  controlProps?: InputHTMLAttributes<HTMLInputElement>;
  validationState?: "invalid";
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  onUpdate?: (checked: boolean) => void;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
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

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    {
      id: idProp,
      name,
      value,
      checked: controlledChecked,
      defaultChecked = false,
      indeterminate = false,
      disabled = false,
      required = false,
      readOnly = false,
      autoFocus,
      size = "m",
      className,
      style,
      title,
      tabIndex,
      children,
      content,
      controlRef,
      controlProps,
      validationState,
      onChange,
      onUpdate,
      onFocus,
      onBlur,
      onKeyDown,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalidProp,
      qa,
    },
    ref,
  ) {
    const autoId = useId();
    const id = idProp ?? autoId;

    const isControlled = controlledChecked !== undefined;
    const [uncontrolledChecked, setUncontrolledChecked] =
      useState(defaultChecked);
    const isChecked = isControlled ? controlledChecked : uncontrolledChecked;

    const combinedRef = mergeRefs(ref, controlRef);

    const isInvalid =
      validationState === "invalid" ||
      (ariaInvalidProp !== undefined &&
        ariaInvalidProp !== false &&
        ariaInvalidProp !== "false") ||
      (controlProps?.["aria-invalid"] !== undefined &&
        controlProps["aria-invalid"] !== false &&
        controlProps["aria-invalid"] !== "false");

    const labelText = children ?? content;

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
      if (disabled || readOnly) return;
      if (!isControlled) {
        setUncontrolledChecked(e.target.checked);
      }
      onChange?.(e);
      controlProps?.onChange?.(e);
      onUpdate?.(e.target.checked);
    };

    const rootClassName = cx(
      "arken-checkbox",
      "g-checkbox",
      `arken-checkbox--${size}`,
      `g-checkbox_size_${size}`,
      isChecked && "arken-checkbox--checked g-checkbox_checked",
      indeterminate && "arken-checkbox--indeterminate g-checkbox_indeterminate",
      disabled && "arken-checkbox--disabled g-checkbox_disabled",
      isInvalid && "arken-checkbox--invalid g-checkbox_invalid",
      className,
    );

    return (
      <label
        className={rootClassName}
        style={style}
        title={title}
        data-qa={qa}
        htmlFor={id}
      >
        <input
          {...controlProps}
          ref={combinedRef}
          id={id}
          type="checkbox"
          name={name ?? controlProps?.name}
          value={value ?? controlProps?.value}
          checked={isChecked}
          disabled={disabled || Boolean(controlProps?.disabled)}
          required={required || Boolean(controlProps?.required)}
          readOnly={readOnly || Boolean(controlProps?.readOnly)}
          autoFocus={autoFocus ?? controlProps?.autoFocus}
          tabIndex={tabIndex ?? controlProps?.tabIndex}
          aria-label={ariaLabel ?? controlProps?.["aria-label"]}
          aria-labelledby={ariaLabelledBy ?? controlProps?.["aria-labelledby"]}
          aria-describedby={
            ariaDescribedBy ?? controlProps?.["aria-describedby"]
          }
          aria-invalid={isInvalid ? "true" : undefined}
          className="arken-checkbox__input g-checkbox__control"
          onChange={handleChange}
          onFocus={onFocus ?? controlProps?.onFocus}
          onBlur={onBlur ?? controlProps?.onBlur}
          onKeyDown={onKeyDown ?? controlProps?.onKeyDown}
        />
        <span
          className="arken-checkbox__box g-checkbox__box"
          aria-hidden="true"
        >
          {indeterminate ? (
            <Minus
              className="arken-checkbox__icon"
              strokeWidth={3}
              aria-hidden="true"
            />
          ) : isChecked ? (
            <Check
              className="arken-checkbox__icon"
              strokeWidth={3}
              aria-hidden="true"
            />
          ) : null}
        </span>
        {labelText ? (
          <span className="arken-checkbox__text g-checkbox__text">
            {labelText}
          </span>
        ) : null}
      </label>
    );
  },
);
