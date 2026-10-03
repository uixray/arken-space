import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";
import { ArkenDialog } from "../ui/ArkenDialog";

const meta: Meta<typeof Dialog> = {
  title: "Design System/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button view="action" onClick={() => setOpen(true)}>
          Открыть диалог
        </Button>
        <Dialog open={open} onClose={() => setOpen(false)}>
          <Dialog.Header caption="Параметры кампании" />
          <Dialog.Body>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <label
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <span
                  style={{ fontSize: 11, color: "var(--color-text-muted)" }}
                >
                  Название кампании
                </span>
                <Input defaultValue="Хроники Забытых Королевств" />
              </label>
              <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
                Настройки будут применены для всех участников стола.
              </p>
            </div>
          </Dialog.Body>
          <Dialog.Footer
            textButtonApply="Сохранить изменения"
            textButtonCancel="Отмена"
            onClickButtonApply={() => setOpen(false)}
            onClickButtonCancel={() => setOpen(false)}
          />
        </Dialog>
      </>
    );
  },
};

export const DangerPreset: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button view="flat-danger" onClick={() => setOpen(true)}>
          Удалить персонажа
        </Button>
        <Dialog open={open} onClose={() => setOpen(false)} danger>
          <Dialog.Header caption="Удаление персонажа" />
          <Dialog.Body>
            <p style={{ margin: 0 }}>
              Вы уверены, что хотите удалить персонажа{" "}
              <strong>Торин Дубощит</strong>? Это действие необратимо и удалит
              все связанные предметы и заметки.
            </p>
          </Dialog.Body>
          <Dialog.Footer
            preset="danger"
            textButtonApply="Удалить безвозвратно"
            textButtonCancel="Отмена"
            onClickButtonApply={() => setOpen(false)}
            onClickButtonCancel={() => setOpen(false)}
          />
        </Dialog>
      </>
    );
  },
};

export const ArkenWorkspaceWindow: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ minHeight: 320, padding: 24 }}>
        <Button view="action" onClick={() => setOpen(true)}>
          Открыть окно рабочего пространства (Менеджер)
        </Button>
        <ArkenDialog
          open={open}
          title="Сцены и локации"
          variant="workspace"
          applyLabel="Применить настройки"
          cancelLabel="Закрыть"
          onApply={() => setOpen(false)}
          onClose={() => setOpen(false)}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              padding: 16,
            }}
          >
            <p style={{ margin: 0, color: "var(--color-text)" }}>
              Окно рабочего пространства поддерживает свободное перетаскивание
              по экрану и не блокирует взаимодействие с холстом стола.
            </p>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                Активная сцена
              </span>
              <Input defaultValue="Таверна «Пьяный дракон»" />
            </label>
          </div>
        </ArkenDialog>
      </div>
    );
  },
};
