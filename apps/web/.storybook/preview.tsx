import type { Preview } from "@storybook/react-vite";

/*
 * Стенд обязан показывать компоненты ровно так, как их видит игрок, иначе он
 * врёт. Поэтому подключается тот же набор стилей и в том же порядке, что и в
 * `apps/web/src/main.tsx`: сначала Gravity, затем наш foundation, затем
 * `styles.css`. Порядок важен — каскад решает, чьи значения победят.
 */
import "@gravity-ui/uikit/styles/fonts.css";
import "@gravity-ui/uikit/styles/styles.css";
import "../src/design-system/tokens.generated.css";
import "../src/ui/gravity-foundation.css";
import "../src/styles.css";

const preview: Preview = {
  parameters: {
    // Интерфейс тёмный. На светлом фоне Storybook половина границ и теней
    // просто не видна, и стенд перестаёт быть похожим на продукт.
    backgrounds: {
      default: "canvas",
      values: [
        { name: "canvas", value: "#181816" },
        { name: "surface", value: "#20201d" },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: "todo",
    },
  },
};

export default preview;
