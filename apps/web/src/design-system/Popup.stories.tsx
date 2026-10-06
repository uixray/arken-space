import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Popup } from "./Popup";
import { Button } from "./Button";

const meta: Meta<typeof Popup> = {
  title: "Design System/Popup",
  component: Popup,
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof Popup>;

function PopupDemo() {
  const [open, setOpen] = useState(false);
  const [anchorElement, setAnchorElement] = useState<HTMLButtonElement | null>(
    null,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3>Всплывающее меню / Тултип (Popup)</h3>
      <div>
        <Button
          onClick={(event) => {
            setAnchorElement(event.currentTarget);
            setOpen((prev) => !prev);
          }}
          view={open ? "action" : "normal"}
        >
          {open ? "Закрыть поповер" : "Открыть поповер"}
        </Button>
        <Popup
          open={open}
          onOpenChange={setOpen}
          anchorElement={anchorElement}
          placement="bottom-start"
        >
          <div
            style={{
              padding: 12,
              minWidth: 200,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <strong style={{ fontSize: "12px", color: "var(--text-primary)" }}>
              Параметры токена
            </strong>
            <p
              style={{
                margin: 0,
                fontSize: "11px",
                color: "var(--text-muted)",
              }}
            >
              Быстрые действия: скрыть токен, повернуть или назначить состояние.
            </p>
          </div>
        </Popup>
      </div>
    </div>
  );
}

export const Interactive: Story = {
  render: () => <PopupDemo />,
};
