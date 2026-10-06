import type { Meta, StoryObj } from "@storybook/react-vite";
import { Loader } from "./Loader";

const meta: Meta<typeof Loader> = {
  title: "Design System/Loader",
  component: Loader,
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof Loader>;

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3>Размеры индикатора загрузки (Sizes)</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader size="s" />
          <span>S (Компактный для кнопок)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader size="m" />
          <span>M (По умолчанию для панелей)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader size="l" />
          <span>L (Для экранов сцены)</span>
        </div>
      </div>
    </div>
  ),
};
