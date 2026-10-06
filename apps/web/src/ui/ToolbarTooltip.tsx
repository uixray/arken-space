import { Tooltip } from "@base-ui/react/tooltip";
import {
  cloneElement,
  useId,
  type ComponentProps,
  type ReactElement,
} from "react";

/** No extra trigger wrapper: buttons and native details/summary retain their semantics. */
function ToolbarTooltip({
  content,
  trigger,
}: {
  content: string;
  trigger: ReactElement;
}) {
  const id = useId();
  const describedTrigger = cloneElement(
    trigger as ReactElement<{ "aria-describedby"?: string }>,
    { "aria-describedby": id },
  );
  return (
    <Tooltip.Root>
      <Tooltip.Trigger delay={250} render={describedTrigger} />
      <Tooltip.Portal>
        <Tooltip.Positioner
          side="right"
          align="center"
          sideOffset={8}
          collisionPadding={8}
          className="map-toolbar-tooltip-positioner"
        >
          <Tooltip.Popup
            id={id}
            role="tooltip"
            className="map-toolbar-tooltip"
            style={{
              maxWidth: "min(280px, calc(100vw - 16px))",
              whiteSpace: "normal",
              overflowWrap: "anywhere",
            }}
          >
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function ToolbarButton({ title, ...props }: ComponentProps<"button">) {
  const trigger = <button type="button" {...props} />;
  return title ? <ToolbarTooltip content={title} trigger={trigger} /> : trigger;
}

export function ToolbarSummary({ title, ...props }: ComponentProps<"summary">) {
  const trigger = <summary {...props} />;
  return title ? <ToolbarTooltip content={title} trigger={trigger} /> : trigger;
}
