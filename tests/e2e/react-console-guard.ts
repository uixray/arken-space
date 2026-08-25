import { test as base } from "@playwright/test";

/**
 * UIX-521: консольные ошибки React роняют тест, а не живут незамеченными.
 *
 * Предупреждение «Cannot update a component (`WorkspaceNav`) while rendering a
 * different component (`Orthographic2DRenderer`)» месяцами было видно только
 * тому, кто читал лог dev-сервера. Ни один гейт его не замечал, и продержалось
 * оно ровно столько, сколько никто туда не смотрел.
 *
 * Список намеренно узкий. Ронять прогон на любой строке из консоли нельзя:
 * браузер печатает туда и то, к чему приложение отношения не имеет — 401 на
 * `/api/bootstrap` до входа, 404 на favicon, недоступный CDN шрифтов. Такая
 * проверка стала бы шумом, который отключат при первом же красном прогоне.
 * Здесь только сообщения, каждое из которых означает дефект:
 *
 * - `Cannot update a component` — setState во время рендера чужого
 *   компонента. Лишний синхронный проход, а порядок обновлений начинает
 *   зависеть от момента отрисовки, а не от данных;
 * - `Maximum update depth exceeded` — цикл обновлений; страница либо висит,
 *   либо перерисовывается вхолостую.
 *
 * Проверяется только основная страница теста. Тест, открывающий второй
 * контекст или вкладку, за них не отвечает: подписаться на них отсюда нечем,
 * и молчаливое «проверено» было бы хуже явного пробела.
 */
const REACT_DEFECTS = [
  "Cannot update a component",
  "Maximum update depth exceeded",
] as const;

export const test = base.extend<{ reactConsoleGuard: void }>({
  /* Аргумент назван `provide`, а не `use`, как в документации Playwright:
     `react-hooks/rules-of-hooks` принимает вызов `use(...)` за React-хук вне
     компонента и роняет `pnpm lint`. Имя параметра Playwright безразлично. */
  reactConsoleGuard: [
    async ({ page }, provide) => {
      const defects: string[] = [];
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (REACT_DEFECTS.some((pattern) => text.includes(pattern)))
          defects.push(text);
      });

      await provide();

      if (defects.length > 0) {
        throw new Error(
          `React сообщил о дефекте в консоли (${defects.length}):\n` +
            defects.map((text) => `  ${text}`).join("\n") +
            "\n\nЭто не шум: setState во время чужого рендера или цикл " +
            "обновлений. Чинить надо вызов, а не проверку — стек указан в " +
            "самом сообщении. Список отслеживаемых сообщений и причина, по " +
            "которой он узкий, — в tests/e2e/react-console-guard.ts.",
        );
      }
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
