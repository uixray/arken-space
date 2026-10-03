import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { Sparkles, Trash2, Check, ArrowRight, Search } from "lucide-react";

const meta: Meta<typeof Button> = {
  title: "Design System/Button",
  component: Button,
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Views: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3>Кнопки: Варианты внешнего вида (Views)</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Button view="action">Action (Accent)</Button>
        <Button view="normal">Normal (Surface)</Button>
        <Button view="outlined">Outlined</Button>
        <Button view="flat">Flat (Ghost)</Button>
        <Button view="raised">Raised</Button>
        <Button view="flat-danger">Flat Danger</Button>
        <Button view="outlined-danger">Outlined Danger</Button>
      </div>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3>Размеры кнопок (Sizes)</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Button size="xs" view="normal">XS (24px)</Button>
        <Button size="s" view="normal">S (28px)</Button>
        <Button size="m" view="normal">M (32px - Default)</Button>
        <Button size="l" view="normal">L (36px)</Button>
        <Button size="xl" view="normal">XL (44px - Touch)</Button>
      </div>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3>Состояния кнопок (States)</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Button view="action">Обычная</Button>
        <Button view="action" selected>Выбрана (Selected)</Button>
        <Button view="action" disabled>Отключена (Disabled)</Button>
        <Button view="action" loading>Загрузка (Loading)</Button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Button view="normal">Обычная</Button>
        <Button view="normal" selected>Выбрана (Selected)</Button>
        <Button view="normal" disabled>Отключена (Disabled)</Button>
        <Button view="normal" loading>Загрузка (Loading)</Button>
      </div>
    </div>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3>Кнопки с иконками (Lucide Icons)</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Button view="action">
          <Sparkles size={14} />
          Применить заклинание
        </Button>
        <Button view="normal">
          <Search size={14} />
          Поиск по каталогу
        </Button>
        <Button view="flat-danger">
          <Trash2 size={14} />
          Удалить токен
        </Button>
        <Button view="outlined">
          Подтвердить
          <Check size={14} />
        </Button>
        <Button view="flat" size="m" aria-label="Далее">
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  ),
};
