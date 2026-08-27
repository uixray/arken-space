import { test as base, type ConsoleMessage } from "@playwright/test";
import {
  formatReactConsoleMessage,
  isReactDefect,
} from "./react-console-format";

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
export const test = base.extend<{ reactConsoleGuard: void }>({
  /* Аргумент назван `provide`, а не `use`, как в документации Playwright:
     `react-hooks/rules-of-hooks` принимает вызов `use(...)` за React-хук вне
     компонента и роняет `pnpm lint`. Имя параметра Playwright безразлично. */
  reactConsoleGuard: [
    async ({ page }, provide) => {
      /* Сообщения копятся объектами, а текст собирается на разборе: аргументы
         консоли читаются асинхронно, а обработчик синхронный. Разбор успевает
         до закрытия страницы — фикстура зависит от `page`, значит гасится
         раньше него. */
      const suspects: ConsoleMessage[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && isReactDefect(message.text()))
          suspects.push(message);
      });

      await provide();

      const defects: string[] = [];
      for (const message of suspects) {
        const [format, ...args] = message.args();
        if (!format) {
          defects.push(message.text());
          continue;
        }
        try {
          defects.push(
            formatReactConsoleMessage(
              String(await format.jsonValue()),
              await Promise.all(
                args.map(async (arg) => String(await arg.jsonValue())),
              ),
            ),
          );
        } catch {
          // Страница уже закрыта или значение не сериализуется: сырой текст
          // менее удобен, но это лучше, чем потерять сообщение о дефекте.
          defects.push(message.text());
        }
      }

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
