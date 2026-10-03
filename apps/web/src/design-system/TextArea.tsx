import {
  forwardRef,
  type ChangeEvent,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import "./TextArea.css";

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  onUpdate?: (value: string) => void;
  minRows?: number;
  maxRows?: number;
  controlRef?: Ref<HTMLTextAreaElement>;
  controlProps?: TextareaHTMLAttributes<HTMLTextAreaElement>;
  validationState?: "invalid";
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

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea(
    {
      controlRef,
      controlProps,
      validationState,
      qa,
      className,
      style,
      disabled,
      value,
      defaultValue,
      onChange,
      onUpdate,
      label,
      minRows,
      maxRows: _maxRows,
      rows = minRows ?? 3,
      "aria-invalid": ariaInvalidProp,
      ...restProps
    },
    ref,
  ) {
    const combinedRef = mergeRefs(ref, controlRef);

    const isInvalid =
      validationState === "invalid" ||
      (ariaInvalidProp !== undefined &&
        ariaInvalidProp !== false &&
        ariaInvalidProp !== "false");

    const wrapperClassName = cx(
      "arken-text-area",
      "g-text-area",
      disabled && "g-text-area_disabled arken-text-area--disabled",
      isInvalid && "g-text-area_invalid",
      className,
    );

    const mergedControlProps = {
      ...restProps,
      ...controlProps,
    };

    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
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
        <span className="arken-text-area__content g-text-area__content">
          {label && (
            <span className="arken-text-area__label g-text-area__label">
              {label}
            </span>
          )}
          <textarea
            {...mergedControlProps}
            ref={combinedRef}
            rows={rows}
            disabled={disabled}
            value={value}
            defaultValue={defaultValue}
            onChange={handleChange}
            className={cx(
              "arken-text-area__control",
              "g-text-area__control",
              mergedControlProps.className,
            )}
            aria-invalid={isInvalid ? "true" : undefined}
          />
        </span>
      </span>
    );
  },
);
