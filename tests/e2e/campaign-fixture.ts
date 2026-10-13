import { test as base } from "./react-console-guard";
import { randomUUID } from "node:crypto";
import { insertOwnedChatHistory } from "./chat-history-fixture";
import { createDatabase } from "../../packages/db/src/index.js";
import { createCampaignWithGmAccess } from "../../apps/server/src/seed.js";

/**
 * UIX-518: собственная кампания на каждый браузерный тест.
 *
 * Все e2e работали с одной кампанией в одной базе. `workers: 1` это не лечит:
 * тесты, меняющие состояние — `game-night` начинает и заканчивает бой,
 * `activity-feed-layout` пишет в журнал, — влияют на соседей через прогон, а
 * не через параллельность. Два полных прогона подряд на неизменном дереве
 * давали разные наборы падений, и все упавшие проходили поодиночке.
 *
 * Кампания создаётся прямо в базе, а не через API: создания кампании наружу
 * нет ни одним route, и заводить его ради тестов значило бы открыть в
 * production путь, нужный только здесь.
 *
 * Кампании не удаляются после теста. Часть внешних ключей объявлена
 * `restrict`, и удаление зависело бы от того, что тест успел создать, — то
 * есть падало бы через раз ровно по той причине, которую этот фикстур и
 * убирает. База e2e одноразовая: её пересоздают перед прогоном.
 */

const databaseUrl = process.env.DATABASE_URL;

type Fixtures = { gmToken: string };
type WorkerFixtures = {
  campaignFactory: (name: string) => Promise<string>;
  campaignHistory: {
    create: (name: string) => Promise<string>;
    seed: (token: string, count: number) => Promise<void>;
  };
  seedChatHistory: (token: string, count: number) => Promise<void>;
};

/* Два отступления от того, как фикстуры выглядят в документации Playwright, оба
   вынужденные и оба проверены запуском:

   - аргумент, отдающий фикстуру, назван `provide`, а не `use`:
     `react-hooks/rules-of-hooks` принимает вызов `use(...)` за React-хук вне
     компонента и роняет `pnpm lint`. Имя параметра Playwright безразлично;
   - первый аргумент обязан быть деструктуризацией, даже пустой: Playwright
     разбирает сигнатуру и на `async (_fixtures, …)` падает ещё до запуска
     тестов с «First argument must use the object destructuring pattern».
     Поэтому `{}` остаётся, а `no-empty-pattern` глушится точечно. */
export const test = base.extend<Fixtures, WorkerFixtures>({
  campaignHistory: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, provide) => {
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL обязателен для браузерных тестов: каждый тест " +
            "создаёт собственную кампанию. Экспортируйте переменные окружения " +
            "перед запуском: set -a; . ./.env; set +a",
        );
      }
      const { client, db } = createDatabase(databaseUrl);
      const owned = new Map<
        string,
        { campaignId: string; membershipId: string }
      >();
      const create = async (name: string) => {
        const token = `e2e-${randomUUID()}-${randomUUID()}`;
        const { campaign, gm } = await createCampaignWithGmAccess(
          db,
          name,
          token,
        );
        owned.set(token, { campaignId: campaign.id, membershipId: gm.id });
        return token;
      };
      try {
        await provide({
          create,
          seed: async (token, count) => {
            const owner = owned.get(token);
            if (!owner)
              throw new Error(
                "Cannot seed history outside this worker owned campaigns",
              );
            const host = new URL(databaseUrl).hostname;
            if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
              throw new Error(
                "Chat history fixture requires isolated loopback database",
              );
            await insertOwnedChatHistory(db, owner, count);
          },
        });
      } finally {
        await client.end();
      }
    },
    { scope: "worker" },
  ],

  campaignFactory: [
    async ({ campaignHistory }, provide) => {
      await provide(campaignHistory.create);
    },
    { scope: "worker" },
  ],
  seedChatHistory: [
    async ({ campaignHistory }, provide) => {
      await provide(campaignHistory.seed);
    },
    { scope: "worker" },
  ],
  gmToken: async ({ campaignFactory }, provide, testInfo) => {
    await provide(await campaignFactory(`e2e — ${testInfo.title}`));
  },
});

export { expect } from "@playwright/test";
