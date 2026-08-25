import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.E2E_PORT ?? "5173";
const e2eBaseUrl = process.env.E2E_BASE_URL ?? `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 1,
  /**
   * UIX-475 / UIX-518: e2e идут по одному, но уже не ради корректности.
   *
   * Исходная причина была в общем состоянии: все тесты работали с одной
   * кампанией в одной базе, и `activity-feed-layout`, начиная и заканчивая
   * бой, менял высоту колонки у соседа посреди замера. UIX-518 это убрал —
   * каждый тест, ходящий в живой backend, создаёт собственную кампанию
   * (`tests/e2e/campaign-fixture.ts`), а остальные полностью мокают API и
   * базы не касаются вовсе. Порядок файлов больше ни на что не влияет.
   *
   * Единственный оставшийся довод — измерения. Половина этих тестов сверяет
   * реальную геометрию: ширину строки разделов, перекрытие полосы журнала,
   * число помещающихся кнопок. Такие проверки чувствительны не к чужому
   * состоянию, а к чужой нагрузке на процессор, и параллельный прогон делает
   * их шумными на слабой машине. Поднимать `workers` можно — это вопрос
   * машины, а не правильности.
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
