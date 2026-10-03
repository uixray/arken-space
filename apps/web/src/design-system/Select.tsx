import {
  Children,
  forwardRef,
  isValidElement,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { Select as BaseSelect } from "@base-ui/react";
import {
  SelectedOptionIcon as Check,
  ScenePickerIcon as ChevronDown,
} from "../ui/icons";
import "./Select.css";

export const FORM_SELECT_CREATE_VALUE = "__arken_create__";

export interface SelectOption {
  value: string | number;
  label?: ReactNode;
  content?: ReactNode;
  text?: string;
  disabled?: boolean;
}

export interface SelectGroup {
  label: ReactNode;
  items: SelectOption[];
}

export type SelectSize = "xs" | "s" | "m" | "l" | "xl";
export type SelectWidth = "auto" | "max";
export type SelectView = "normal" | "clear";

type OptionElementProps = {
  value?: string | number;
  children?: ReactNode;
  disabled?: boolean;
};

function optionText(children: ReactNode): string | undefined {
  const parts = Children.toArray(children);
  return parts.every(
    (part) => typeof part === "string" || typeof part === "number",
  )
    ? parts.join("")
    : undefined;
}

export interface SelectProps {
  id?: string;
  name?: string;
  value?: string | number | readonly (string | number)[];
  defaultValue?: string | number | readonly (string | number)[];
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  onUpdate?: (value: string[]) => void;
  onValueChange?: (value: string) => void;
  options?: readonly (SelectOption | SelectGroup)[];
  children?: ReactNode;
  label?: ReactNode;
  placeholder?: ReactNode;
  size?: SelectSize;
  width?: SelectWidth;
  view?: SelectView;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  validationState?: "invalid";
  errorMessage?: ReactNode;
  emptyMessage?: ReactNode;
  createAction?: { label: ReactNode; onSelect: () => void };
  renderPopup?: (props: {
    renderFilter: () => ReactNode;
    renderList: () => ReactNode;
  }) => ReactNode;
  popupClassName?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  tabIndex?: number;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-details"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  controlRef?: Ref<HTMLButtonElement>;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  function Select(
    {
      id,
      name,
      value,
      defaultValue,
      onChange,
      onUpdate,
      onValueChange,
      options,
      children,
      label,
      placeholder,
      size = "m",
      width = "auto",
      view = "normal",
      disabled = false,
      required = false,
      autoFocus = false,
      validationState,
      errorMessage: _errorMessage,
      emptyMessage,
      createAction,
      renderPopup,
      popupClassName,
      className,
      style,
      title,
      tabIndex,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      "aria-describedby": ariaDescribedBy,
      "aria-details": ariaDetails,
      "aria-invalid": ariaInvalidProp,
      controlRef,
      open: controlledOpen,
      defaultOpen = false,
      onOpenChange,
    },
    ref,
  ) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);
    useImperativeHandle(
      controlRef,
      () => triggerRef.current as HTMLButtonElement,
    );

    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const isOpen = controlledOpen ?? uncontrolledOpen;

    const isControlled = value !== undefined;
    const normalizedDefault = useMemo(() => {
      if (defaultValue === undefined) return "";
      if (Array.isArray(defaultValue)) {
        return defaultValue[0] !== undefined ? String(defaultValue[0]) : "";
      }
      return String(defaultValue);
    }, [defaultValue]);

    const [uncontrolledValue, setUncontrolledValue] = useState(normalizedDefault);

    const normalizedControlled = useMemo(() => {
      if (value === undefined) return undefined;
      if (Array.isArray(value)) {
        return value[0] !== undefined ? String(value[0]) : "";
      }
      return String(value);
    }, [value]);

    const activeValue = isControlled ? (normalizedControlled ?? "") : uncontrolledValue;

    // Parse options from either `options` prop or JSX `<option>` children
    const parsedOptions = useMemo<SelectOption[]>(() => {
      if (options && options.length > 0) {
        const flat: SelectOption[] = [];
        for (const item of options) {
          if ("items" in item && Array.isArray(item.items)) {
            flat.push(...item.items);
          } else {
            flat.push(item as SelectOption);
          }
        }
        return flat;
      }

      if (children) {
        return Children.toArray(children)
          .filter(
            (child): child is ReactElement<OptionElementProps> =>
              isValidElement<OptionElementProps>(child) &&
              child.type === "option",
          )
          .map((child) => ({
            value: String(child.props.value ?? ""),
            content: child.props.children,
            label: child.props.children,
            text: optionText(child.props.children),
            disabled: Boolean(child.props.disabled),
          }));
      }

      return [];
    }, [options, children]);

    // Combine with utility options (emptyMessage / createAction)
    const flatOptions = useMemo<SelectOption[]>(() => {
      const result = [...parsedOptions];

      if (result.length === 0 && emptyMessage) {
        result.push({
          value: "__arken_empty__",
          content: emptyMessage,
          label: emptyMessage,
          disabled: true,
        });
      }

      if (
        createAction &&
        !result.some((o) => o.value === FORM_SELECT_CREATE_VALUE)
      ) {
        result.push({
          value: FORM_SELECT_CREATE_VALUE,
          content: createAction.label,
          label: createAction.label,
          disabled: false,
        });
      }

      return result;
    }, [parsedOptions, emptyMessage, createAction]);

    // Items map for Base UI Select.Root
    const itemsDict = useMemo(() => {
      const dict: Record<string, ReactNode> = {};
      for (const opt of flatOptions) {
        dict[String(opt.value)] =
          opt.text ??
          (typeof opt.content === "string"
            ? opt.content
            : typeof opt.label === "string"
              ? opt.label
              : opt.content ?? opt.label ?? String(opt.value));
      }
      return dict;
    }, [flatOptions]);

    // Track popup width to match trigger width
    const [popupWidth, setPopupWidth] = useState<number>();
    const popupRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      if (!isOpen || !triggerRef.current) return;
      const control = triggerRef.current;
      let frame = 0;
      const measure = (isResize = false) => {
        const width = control.getBoundingClientRect().width;
        setPopupWidth(
          width > 0
            ? Math.max(1, Math.min(width, window.innerWidth - 20))
            : undefined,
        );
        if (isResize) {
          control.focus();
        }
      };
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => measure(true));
      };
      measure(false);
      const observer =
        typeof ResizeObserver === "undefined"
          ? undefined
          : new ResizeObserver(schedule);
      observer?.observe(control);
      window.addEventListener("resize", schedule);
      return () => {
        observer?.disconnect();
        window.removeEventListener("resize", schedule);
        cancelAnimationFrame(frame);
      };
    }, [isOpen]);

    const restoreFocusAfterSelection = (
      consumerElement: HTMLElement | null = null,
    ) => {
      requestAnimationFrame(() => {
        if (consumerElement) {
          consumerElement.focus();
          return;
        }

        const control = triggerRef.current;
        if (!control) return;
        const active = document.activeElement;
        if (
          !active ||
          active === document.body ||
          active === control ||
          listRef.current?.contains(active) ||
          popupRef.current?.contains(active)
        ) {
          control.focus();
        }
      });
    };

    const lastInvocationRef = useRef<{ value: string; time: number }>({
      value: "",
      time: 0,
    });

    const handleValueChange = (nextValue: any) => {
      const nextStr = String(nextValue ?? "");
      const now = Date.now();
      if (
        lastInvocationRef.current.value === nextStr &&
        now - lastInvocationRef.current.time < 50
      ) {
        return;
      }
      lastInvocationRef.current = { value: nextStr, time: now };

      if (nextStr === FORM_SELECT_CREATE_VALUE) {
        if (createAction) {
          createAction.onSelect();
        } else {
          onUpdate?.([nextStr]);
        }
        return;
      }

      if (!isControlled) {
        setUncontrolledValue(nextStr);
      }

      const activeBefore = document.activeElement;

      onValueChange?.(nextStr);
      onUpdate?.([nextStr]);

      if (onChange) {
        const syntheticEvent = {
          target: { value: nextStr, name: name ?? "" },
          currentTarget: { value: nextStr, name: name ?? "" },
        } as ChangeEvent<HTMLSelectElement>;
        onChange(syntheticEvent);
      }

      const activeAfter = document.activeElement;
      const consumerFocusedElement =
        activeAfter &&
        activeAfter !== activeBefore &&
        activeAfter !== document.body &&
        activeAfter !== triggerRef.current &&
        !popupRef.current?.contains(activeAfter) &&
        !listRef.current?.contains(activeAfter)
          ? (activeAfter as HTMLElement)
          : null;

      restoreFocusAfterSelection(consumerFocusedElement);
    };

    const handleOpenChange = (nextOpen: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    };

    const isInvalid =
      validationState === "invalid" ||
      ariaInvalidProp === true ||
      ariaInvalidProp === "true";

    const triggerClassName = [
      "arken-select",
      "g-select",
      `arken-select--${size}`,
      `g-select_size_${size}`,
      width === "max" ? "arken-select--width-max g-select_width_max" : "",
      `arken-select--${view}`,
      `g-select_view_${view}`,
      disabled ? "arken-select--disabled g-select_disabled" : "",
      isInvalid ? "arken-select--invalid g-select_invalid" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    const iconSize =
      size === "xs" || size === "s" ? 12 : size === "xl" ? 16 : 14;

    const renderOptionsList = () => {
      if (flatOptions.length === 0) {
        return (
          <div className="arken-select__empty" role="status">
            {emptyMessage ?? "Нет доступных вариантов"}
          </div>
        );
      }

      return (
        <BaseSelect.List className="arken-select__list">
          {flatOptions.map((opt) => (
            <BaseSelect.Item
              key={String(opt.value)}
              value={String(opt.value)}
              disabled={opt.disabled}
              onClick={() => {
                if (!opt.disabled) {
                  handleValueChange(opt.value);
                  handleOpenChange(false);
                }
              }}
              className={[
                "arken-select__item",
                "g-select__item",
                opt.disabled ? "arken-select__item--disabled" : "",
                opt.value === FORM_SELECT_CREATE_VALUE
                  ? "arken-select__item--create"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <BaseSelect.ItemText className="arken-select__item-text">
                {opt.content ?? opt.label ?? opt.value}
              </BaseSelect.ItemText>
              {opt.value !== FORM_SELECT_CREATE_VALUE && (
                <BaseSelect.ItemIndicator className="arken-select__item-indicator">
                  <Check size={14} />
                </BaseSelect.ItemIndicator>
              )}
            </BaseSelect.Item>
          ))}
        </BaseSelect.List>
      );
    };

    return (
      <BaseSelect.Root
        items={itemsDict}
        value={activeValue}
        onValueChange={handleValueChange}
        open={isOpen}
        onOpenChange={handleOpenChange}
        disabled={disabled}
        required={required}
        name={name}
      >
        <BaseSelect.Trigger
          ref={triggerRef}
          id={id}
          className={triggerClassName}
          style={style}
          title={title}
          tabIndex={tabIndex}
          autoFocus={autoFocus}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-details={ariaDetails}
          aria-invalid={isInvalid ? "true" : undefined}
          data-invalid={isInvalid ? "true" : undefined}
          onClick={() => {
            if (!isOpen) {
              handleOpenChange(true);
            }
          }}
        >
          {label && <span className="arken-select__label">{label}</span>}
          <BaseSelect.Value
            placeholder={placeholder}
            className="arken-select__value"
          >
            {(selectedVal) => {
              const valStr =
                selectedVal !== null && selectedVal !== undefined
                  ? String(selectedVal)
                  : "";
              if (valStr === "") {
                const emptyOpt = flatOptions.find(
                  (o) => String(o.value) === "",
                );
                if (emptyOpt) {
                  return (
                    emptyOpt.content ??
                    emptyOpt.label ??
                    emptyOpt.text ??
                    emptyOpt.value
                  );
                }
                return placeholder ?? null;
              }
              const matched = flatOptions.find(
                (o) => String(o.value) === valStr,
              );
              if (matched) {
                return (
                  matched.content ??
                  matched.label ??
                  matched.text ??
                  matched.value
                );
              }
              return valStr || (placeholder ?? null);
            }}
          </BaseSelect.Value>
          <BaseSelect.Icon className="arken-select__icon">
            <ChevronDown size={iconSize} />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>

        <BaseSelect.Portal>
          <BaseSelect.Positioner
            sideOffset={4}
            side="bottom"
            align="start"
            alignItemWithTrigger={false}
            className={[
              "arken-select__positioner",
              popupClassName,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <BaseSelect.Popup
              ref={popupRef}
              className="arken-select__popup"
            >
              {renderPopup ? (
                renderPopup({
                  renderFilter: () => null,
                  renderList: () => renderOptionsList(),
                })
              ) : (
                <div
                  ref={listRef}
                  key={isOpen ? "open" : "closed"}
                  className="arken-form-select-popup__content arken-select__popup-inner"
                  style={{ minWidth: popupWidth }}
                >
                  {renderOptionsList()}
                </div>
              )}
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    );
  },
);

Select.displayName = "Select";
