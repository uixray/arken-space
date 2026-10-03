import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "./Switch";

const meta: Meta<typeof Switch> = {
  title: "Design System/Switch",
  component: Switch,
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["s", "m", "l"],
    },
    disabled: {
      control: "boolean",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Default: Story = {
  args: {
    children: "Показывать курсоры остальных",
    defaultChecked: true,
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Switch size="s" defaultChecked>
        Компактный размер (s - 28x16mm, 11px font)
      </Switch>
      <Switch size="m" defaultChecked>
        Стандартный размер стола (m - 36x20mm, 12px font)
      </Switch>
      <Switch size="l" defaultChecked>
        Крупный размер (l - 44x24mm, 14px font)
      </Switch>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Switch defaultChecked={false}>Отключено</Switch>
      <Switch defaultChecked={true}>Включено (Terracotta Clay)</Switch>
      <Switch disabled defaultChecked={false}>
        Заблокировано (Off)
      </Switch>
      <Switch disabled defaultChecked={true}>
        Заблокировано (On)
      </Switch>
    </div>
  ),
};
