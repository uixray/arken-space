import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.E2E_PORT ?? "5173";
const e2eBaseUrl = process.env.E2E_BASE_URL ?? `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 1,
  /**
   * UIX-475: e2e идут по одному.
   *
   * Все они работают с одной кампанией в одной базе — отдельного стенда на
   * файл здесь нет. Пока это были проверки, ничего не менявшие в общем
   * состоянии, параллельность сходила с рук. `activity-feed-layout` начинает и
   * заканчивает бой, и этого хватило: у соседнего теста посреди замера меняется
   * высота колонки, и он падает через раз — то есть на пустом месте.
   *
   * Дешевле замедлить прогон, чем разбирать нестабильность, которая
   * воспроизводится только в полном запуске и никогда — поодиночке.
   */
  workers: 1,
  webServer: {
    command: `corepack pnpm --filter @arken/web dev --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    baseURL: e2eBaseUrl,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
});
