import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./Checkbox";

const meta: Meta<typeof Checkbox> = {
  title: "Design System/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["s", "m", "l"],
    },
    disabled: {
      control: "boolean",
    },
    indeterminate: {
      control: "boolean",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {
  args: {
    children: "Отображать сетку карты",
    defaultChecked: true,
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Checkbox size="s" defaultChecked>
        Компактный размер (s - 14px box, 11px font)
      </Checkbox>
      <Checkbox size="m" defaultChecked>
        Стандартный размер стола (m - 16px box, 12px font)
      </Checkbox>
      <Checkbox size="l" defaultChecked>
        Крупный размер (l - 20px box, 14px font)
      </Checkbox>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Checkbox defaultChecked={false}>Не выбран</Checkbox>
      <Checkbox defaultChecked={true}>Выбран (Terracotta Clay)</Checkbox>
      <Checkbox indeterminate>Частичный выбор (Indeterminate)</Checkbox>
      <Checkbox disabled defaultChecked={false}>
        Заблокирован (Unchecked)
      </Checkbox>
      <Checkbox disabled defaultChecked={true}>
        Заблокирован (Checked)
      </Checkbox>
      <Checkbox validationState="invalid">Ошибка валидации</Checkbox>
    </div>
  ),
};
