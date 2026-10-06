import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextArea } from "./TextArea";

const meta: Meta<typeof TextArea> = {
  title: "Design System/TextArea",
  component: TextArea,
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof TextArea>;

export const Default: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 480,
      }}
    >
      <h3>Многострочный ввод (TextArea)</h3>
      <TextArea
        placeholder="Опишите предысторию персонажа, внешность или детали сцены..."
        rows={4}
      />
    </div>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 480,
      }}
    >
      <h3>С подписью (Label)</h3>
      <TextArea
        label="Заметки мастера"
        placeholder="Скрытые улики, имена NPC и секреты комнаты..."
        rows={4}
      />
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 480,
      }}
    >
      <h3>Состояния</h3>
      <div>
        <label
          style={{
            display: "block",
            marginBottom: 4,
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          Отключено (Disabled)
        </label>
        <TextArea
          disabled
          value="Текст предыстории заблокирован для редактирования игроком."
          rows={3}
        />
      </div>
      <div>
        <label
          style={{
            display: "block",
            marginBottom: 4,
            fontSize: "11px",
            color: "var(--danger)",
          }}
        >
          Ошибка валидации (Invalid)
        </label>
        <TextArea
          validationState="invalid"
          defaultValue="Превышен максимальный лимит символов для короткой заметки."
          rows={3}
        />
      </div>
    </div>
  ),
};
