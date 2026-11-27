import type { Meta, StoryObj } from "@storybook/react-vite";
import { CartographicLabel } from "./CartographicLabel";

const meta: Meta<typeof CartographicLabel> = {
  title: "Design System/CartographicLabel",
  component: CartographicLabel,
  args: { text: "Восточный вход", presentation: "ribbon" },
};
export default meta;
type Story = StoryObj<typeof CartographicLabel>;
export const Plain: Story = { args: { presentation: "plain" } };
export const BackgroundsAndLongNames: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 20 }}>
      {["#fff", "#171715", "#aaa79b"].map((background) => (
        <div
          key={background}
          style={{ background, padding: 24, maxWidth: 320 }}
        >
          <CartographicLabel {...args} />
          <h3>
            <CartographicLabel
              presentation="ribbon"
              text="Длинное название локации на границе карты"
            />
          </h3>
        </div>
      ))}
    </div>
  ),
};
