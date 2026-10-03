import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";
import { Shield, Eye, Flame, Heart, AlertTriangle } from "lucide-react";

const meta: Meta<typeof Badge> = {
  title: "Design System/Badge",
  component: Badge,
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Themes: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3>Бейджи статусов и тем (Themes)</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Badge theme="normal">Обычный (Normal)</Badge>
        <Badge theme="info">Информация (Info)</Badge>
        <Badge theme="success">Успех (Success)</Badge>
        <Badge theme="warning">Внимание (Warning)</Badge>
        <Badge theme="danger">Опасность (Danger)</Badge>
      </div>
    </div>
  ),
};

export const TabletopRoles: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3>Роли доступа за игровым столом</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Badge theme="danger">
          <Shield size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
          Мастер (GM)
        </Badge>
        <Badge theme="info">
          <Heart size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
          Ваш персонаж
        </Badge>
        <Badge theme="normal">
          <Flame size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
          Контроллер
        </Badge>
        <Badge theme="warning">
          <Eye size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
          Только чтение
        </Badge>
      </div>
    </div>
  ),
};

export const StatusConditions: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3>Игровые состояния существ (Conditions)</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Badge theme="danger">Без сознания</Badge>
        <Badge theme="warning">Ослеплён</Badge>
        <Badge theme="warning">Отравлен</Badge>
        <Badge theme="info">Сбит с ног</Badge>
        <Badge theme="info">Невидимый</Badge>
        <Badge theme="success">Благословлён</Badge>
      </div>
    </div>
  ),
};
