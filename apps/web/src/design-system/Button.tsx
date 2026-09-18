import { Button as BaseButton } from "@base-ui/react/button";
import {
  Children,
  forwardRef,
  isValidElement,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
} from "react";
import "./Button.css";

export type ButtonView =
  | "normal"
  | "action"
  | "outlined"
  | "outlined-info"
  | "outlined-success"
  | "outlined-warning"
  | "outlined-danger"
  | "outlined-utility"
  | "outlined-action"
  | "raised"
  | "flat"
  | "flat-secondary"
  | "flat-info"
  | "flat-success"
  | "flat-warning"
  | "flat-danger"
  | "flat-utility"
  | "flat-action"
  | "normal-contrast"
  | "outlined-contrast"
  | "flat-contrast";

export type ButtonSize = "xs" | "s" | "m" | "l" | "xl";
export type ButtonPin =
  | "round-round"
  | "brick-brick"
  | "clear-clear"
  | "circle-circle"
  | "round-brick"
  | "brick-round"
  | "round-clear"
  | "clear-round"
  | "brick-clear"
  | "clear-brick"
  | "circle-brick"
  | "brick-circle"
  | "circle-clear"
  | "clear-circle";
export type ButtonWidth = "auto" | "max";

interface ButtonCommonProps {
  view?: ButtonView;
  size?: ButtonSize;
  pin?: ButtonPin;
  selected?: boolean;
  disabled?: boolean;
  loading?: boolean;
  width?: ButtonWidth;
  qa?: string;
  className?: string;
  children?: ReactNode;
}

export interface ButtonButtonProps
  extends
    ButtonCommonProps,
    Omit<
      ButtonHTMLAttributes<HTMLButtonElement>,
      "disabled" | "style" | "className"
    > {
  href?: never;
  extraProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}

export interface ButtonLinkProps
  extends
    ButtonCommonProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "style" | "className"> {
  href: string;
  extraProps?: AnchorHTMLAttributes<HTMLAnchorElement>;
}

export type ButtonProps = ButtonButtonProps | ButtonLinkProps;

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function hasClass(element: ReactElement, className: string) {
  const value = (element.props as { className?: unknown }).className;
  return typeof value === "string" && value.split(/\s+/).includes(className);
}

function isSvg(element: ReactElement) {
  return element.type === "svg";
}

function icon(child: ReactElement, side?: "start" | "end") {
  return (
    <span
      className={cx("g-button__icon", side && `g-button__icon_side_${side}`)}
      aria-hidden="true"
    >
      <span className="g-button__icon-inner">{child}</span>
    </span>
  );
}

function loadingIndicator() {
  return (
    <span
      className="g-button__icon g-button__icon_side_start"
      aria-hidden="true"
    >
      <span className="g-button__icon-inner">
        <span className="arken-button__spinner" />
      </span>
    </span>
  );
}

/** Keep the legacy child hooks until all consumers own their layout styles. */
function prepareChildren(children: ReactNode) {
  const items = Children.toArray(children);
  if (items.length === 1) {
    const child = items[0];
    if (isValidElement(child) && hasClass(child, "g-button__icon"))
      return child;
    if (isValidElement(child) && isSvg(child)) return icon(child);
    return <span className="g-button__text">{child}</span>;
  }

  const content = [...items];
  const first = content[0];
  const last = content.at(-1);
  const start =
    isValidElement(first) && isSvg(first) ? icon(first, "start") : null;
  if (start) content.shift();
  const end = isValidElement(last) && isSvg(last) ? icon(last, "end") : null;
  if (end) content.pop();

  return (
    <>
      {start}
      {end}
      {content.length ? (
        <span className="g-button__text">{content}</span>
      ) : null}
    </>
  );
}

const ButtonRoot = forwardRef<HTMLElement, ButtonProps>(function Button(
  {
    view = "normal",
    size = "m",
    pin = "round-round",
    selected,
    disabled = false,
    loading = false,
    width,
    qa,
    className,
    children,
    extraProps,
    ...elementProps
  },
  ref,
) {
  const interactionDisabled = disabled || loading;
  const rootClassName = cx(
    "g-button",
    `g-button_view_${view}`,
    `g-button_size_${size}`,
    `g-button_pin_${pin}`,
    selected && "g-button_selected",
    interactionDisabled && "g-button_disabled",
    loading && "g-button_loading",
    width && `g-button_width_${width}`,
    className,
  );
  const content = prepareChildren(children);
  const renderedContent = loading ? (
    <>
      {loadingIndicator()}
      {content}
    </>
  ) : (
    content
  );

  if ("href" in elementProps && typeof elementProps.href === "string") {
    const props = {
      ...(elementProps as AnchorHTMLAttributes<HTMLAnchorElement>),
      ...(extraProps as AnchorHTMLAttributes<HTMLAnchorElement> | undefined),
    };
    const { onClick, ...anchorProps } = props;
    const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
      if (interactionDisabled) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    };
    const target = props.target;
    const rel =
      target === "_blank" && !props.rel ? "noopener noreferrer" : props.rel;

    return (
      <BaseButton
        ref={ref}
        render={
          <a
            {...anchorProps}
            href={interactionDisabled ? undefined : elementProps.href}
            target={target}
            rel={rel}
            role={props.role ?? "link"}
            onClick={handleClick}
          />
        }
        nativeButton={false}
        disabled={interactionDisabled}
        className={rootClassName}
        data-qa={qa}
        data-loading={loading ? "" : undefined}
        data-selected={selected ? "" : undefined}
        aria-busy={props["aria-busy"] ?? (loading || undefined)}
        aria-pressed={props["aria-pressed"] ?? selected}
      >
        {renderedContent}
      </BaseButton>
    );
  }

  const props = {
    ...(elementProps as ButtonHTMLAttributes<HTMLButtonElement>),
    ...(extraProps as ButtonHTMLAttributes<HTMLButtonElement> | undefined),
  };

  return (
    <BaseButton
      {...props}
      ref={ref}
      type={props.type ?? "button"}
      disabled={interactionDisabled}
      tabIndex={props.tabIndex ?? (interactionDisabled ? -1 : undefined)}
      className={rootClassName}
      data-qa={qa}
      data-loading={loading ? "" : undefined}
      data-selected={selected ? "" : undefined}
      aria-busy={props["aria-busy"] ?? (loading || undefined)}
      aria-pressed={props["aria-pressed"] ?? selected}
    >
      {renderedContent}
    </BaseButton>
  );
});

export const Button = ButtonRoot as {
  (props: ButtonButtonProps & RefAttributes<HTMLButtonElement>): ReactElement;
  (props: ButtonLinkProps & RefAttributes<HTMLAnchorElement>): ReactElement;
};
