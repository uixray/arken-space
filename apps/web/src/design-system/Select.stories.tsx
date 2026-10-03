import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "./Select";

const meta: Meta<typeof Select> = {
  title: "Design System/Select",
  component: Select,
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["xs", "s", "m", "l", "xl"],
    },
    width: {
      control: "radio",
      options: ["auto", "max"],
    },
    disabled: {
      control: "boolean",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  args: {
    size: "m",
    "aria-label": "Слой карты",
    defaultValue: "players",
    options: [
      { value: "map", label: "Карта (фон)" },
      { value: "gm", label: "Слой мастера" },
      { value: "players", label: "Слой игроков" },
    ],
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Select
        size="xs"
        aria-label="Размер XS"
        defaultValue="xs"
        options={[{ value: "xs", label: "Размер XS (24px)" }]}
      />
      <Select
        size="s"
        aria-label="Размер S"
        defaultValue="s"
        options={[{ value: "s", label: "Размер S (28px)" }]}
      />
      <Select
        size="m"
        aria-label="Размер M"
        defaultValue="m"
        options={[{ value: "m", label: "Размер M (32px)" }]}
      />
      <Select
        size="l"
        aria-label="Размер L"
        defaultValue="l"
        options={[{ value: "l", label: "Размер L (36px)" }]}
      />
      <Select
        size="xl"
        aria-label="Размер XL"
        defaultValue="xl"
        options={[{ value: "xl", label: "Размер XL (44px)" }]}
      />
    </div>
  ),
};

export const WithLabel: Story = {
  args: {
    label: "Слой:",
    defaultValue: "players",
    options: [
      { value: "map", label: "Карта" },
      { value: "gm", label: "Мастер" },
      { value: "players", label: "Игроки" },
    ],
  },
};

export const WithCreateAction: Story = {
  args: {
    defaultValue: "town",
    createAction: {
      label: "+ Новая локация...",
      onSelect: () => alert("Открыть создание локации"),
    },
    options: [
      { value: "town", label: "Город" },
      { value: "dungeon", label: "Подземелье" },
      { value: "forest", label: "Дикий лес" },
    ],
  },
};
