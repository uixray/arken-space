/**
 * Сборка дизайн-токенов: DTCG JSON → CSS custom properties.
 *
 * Источник истины — `tokens/*.tokens.json` в формате DTCG Format Module
 * 2025.10. Из них генерируется `apps/web/src/design-system/tokens.generated.css`,
 * который подключается первым в `styles.css`.
 *
 * Сгенерированный файл коммитится намеренно. Проект собирается через Vite без
 * дополнительных шагов, и добавлять генерацию в каждую сборку значило бы
 * усложнить и `pnpm build`, и CI, и запуск Storybook ради значений, меняющихся
 * несколько раз в месяц. Вместо этого файл обновляется командой
 * `pnpm tokens:build`, а расхождение ловится проверкой `pnpm tokens:check`.
 *
 * Имена выводятся так, чтобы совпасть с уже существующими в `styles.css`:
 * `font.size.body` → `--font-size-body`. Это не косметика — иначе пришлось бы
 * править все 400+ мест использования одним диффом.
 */
export default {
  source: ["tokens/*.tokens.json"],
  platforms: {
    css: {
      transformGroup: "css",
      buildPath: "apps/web/src/design-system/",
      files: [
        {
          destination: "tokens.generated.css",
          format: "css/variables",
          options: {
            selector: ":root",
            outputReferences: true,
          },
        },
      ],
    },
  },
};
