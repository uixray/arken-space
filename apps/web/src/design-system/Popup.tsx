import { Popover } from "@base-ui/react/popover";
import type { ReactNode, RefObject } from "react";
import "./Popup.css";

export interface PopupProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  anchorElement?: HTMLElement | null;
  className?: string;
  placement?: string | string[];
  strategy?: "fixed" | "absolute";
  initialFocus?: number | RefObject<HTMLElement | null>;
  children?: ReactNode;
  disableTransition?: boolean;
}

export function Popup({
  open,
  onOpenChange,
  anchorElement,
  className,
  placement = "bottom-start",
  children,
}: PopupProps) {
  const preferredPlacement = Array.isArray(placement)
    ? (placement[0] ?? "bottom-start")
    : placement;
  const [sideStr, alignStr] = preferredPlacement.split("-");
  const side =
    sideStr === "top" ||
    sideStr === "bottom" ||
    sideStr === "left" ||
    sideStr === "right"
      ? sideStr
      : "bottom";
  const align =
    alignStr === "start" || alignStr === "end" || alignStr === "center"
      ? alignStr
      : "start";

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchorElement}
          side={side}
          align={align}
          sideOffset={4}
          className={["arken-popup__positioner", className]
            .filter(Boolean)
            .join(" ")}
        >
          <Popover.Popup className="arken-popup__content">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
