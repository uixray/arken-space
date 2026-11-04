import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  economyPurchaseCommandSchema,
  economyQuoteCommandSchema,
  saveEconomyConfigSchema,
  saveMerchantSchema,
  saveShopOfferSchema,
} from "@arken/contracts";
import { requireAuth } from "./auth.js";
import {
  saveEconomyConfig,
  saveMerchant,
  saveShopOffer,
} from "./economy-admin.js";
import { purchaseEconomy, quoteEconomy } from "./economy-purchase.js";
import {
  readEconomyHistory,
  readEconomyManager,
  readShopCatalog,
} from "./economy-read.js";
import type { Database } from "./economy-state.js";
import { postgresErrorCode } from "./database-errors.js";

const messages: Record<string, string> = {
  ECONOMY_DISABLED: "Магазины этой кампании пока выключены.",
  ECONOMY_FORBIDDEN: "Нет доступа к этому действию или персонажу.",
  ECONOMY_UNAVAILABLE: "Запись недоступна. Обновите раздел.",
  ECONOMY_INVALID_REGION:
    "Выберите существующую локацию в настройках регионов.",
  ECONOMY_STOCK_UNAVAILABLE:
    "Товар недоступен или количества уже не хватает. Обновите магазин.",
  ECONOMY_STOCK_BOUND:
    "Сначала отсоедините экземпляр от сцены, токена или контейнера.",
  ECONOMY_INSTANCE_ALREADY_LISTED:
    "Этот экземпляр уже добавлен в магазин. Измените существующее предложение или выберите другой экземпляр.",
  ECONOMY_UNPRICED_ITEM: "Мастер ещё не назначил базовую цену предмета.",
  ECONOMY_RULE_MISSING:
    "Для региона или значения харизмы нет правила цены. Обратитесь к мастеру.",
  ECONOMY_PRICE_LIMIT:
    "Итоговая цена превышает допустимый размер. Мастеру нужно уточнить правила.",
  ECONOMY_INVALID_WALLET:
    "Монеты персонажа имеют недопустимое значение. Исправьте кошелёк.",
  ECONOMY_INSUFFICIENT_FUNDS: "Не хватает монет. Покупка не выполнена.",
  ECONOMY_QUOTE_UNAVAILABLE: "Котировка недоступна. Получите новую цену.",
  ECONOMY_QUOTE_USED: "Эта котировка уже оплачена. Проверьте историю покупок.",
  ECONOMY_QUOTE_EXPIRED:
    "Срок цены истёк. Получите новую котировку и подтвердите её.",
  ECONOMY_QUOTE_STALE:
    "Изменились товары, кошелёк, дата или правила. Получите новую цену.",
  ECONOMY_CONFLICT:
    "Настройки уже изменены. Загрузите актуальную версию перед сохранением.",
  ECONOMY_ACTION_CONFLICT:
    "Код действия уже занят другим запросом. Проверьте историю.",
  ECONOMY_CATALOG_LIMIT:
    "Каталог превышает лимит этого этапа (100 магазинов, 500 предложений, 1000 кандидатов).",
};
export function registerEconomyRoutes(
  app: FastifyInstance,
  db: Database,
  broadcast: (campaignId: string) => Promise<void>,
) {
  const operations = [
    {
      method: "GET" as const,
      url: "/api/economy",
      mutate: false,
      run: (
        auth: Parameters<typeof readShopCatalog>[1],
        _body: unknown,
        _query: unknown,
      ) => readShopCatalog(db, auth),
    },
    {
      method: "GET" as const,
      url: "/api/economy/manager",
      mutate: false,
      run: (
        auth: Parameters<typeof readShopCatalog>[1],
        _body: unknown,
        _query: unknown,
      ) => readEconomyManager(db, auth),
    },
    {
      method: "GET" as const,
      url: "/api/economy/history",
      mutate: false,
      run: (
        auth: Parameters<typeof readShopCatalog>[1],
        _body: unknown,
        query: unknown,
      ) =>
        readEconomyHistory(
          db,
          auth,
          z.object({ cursor: z.string().uuid().optional() }).parse(query)
            .cursor,
        ),
    },
    {
      method: "PUT" as const,
      url: "/api/economy/config",
      mutate: true,
      run: (
        auth: Parameters<typeof readShopCatalog>[1],
        body: unknown,
        _query: unknown,
      ) => saveEconomyConfig(db, auth, saveEconomyConfigSchema.parse(body)),
    },
    {
      method: "PUT" as const,
      url: "/api/economy/merchants",
      mutate: true,
      run: (
        auth: Parameters<typeof readShopCatalog>[1],
        body: unknown,
        _query: unknown,
      ) => saveMerchant(db, auth, saveMerchantSchema.parse(body)),
    },
    {
      method: "PUT" as const,
      url: "/api/economy/offers",
      mutate: true,
      run: (
        auth: Parameters<typeof readShopCatalog>[1],
        body: unknown,
        _query: unknown,
      ) => saveShopOffer(db, auth, saveShopOfferSchema.parse(body)),
    },
    {
      method: "POST" as const,
      url: "/api/economy/quotes",
      mutate: false,
      run: (
        auth: Parameters<typeof readShopCatalog>[1],
        body: unknown,
        _query: unknown,
      ) => quoteEconomy(db, auth, economyQuoteCommandSchema.parse(body)),
    },
    {
      method: "POST" as const,
      url: "/api/economy/purchases",
      mutate: true,
      run: (
        auth: Parameters<typeof readShopCatalog>[1],
        body: unknown,
        _query: unknown,
      ) => purchaseEconomy(db, auth, economyPurchaseCommandSchema.parse(body)),
    },
  ];
  for (const operation of operations)
    app.route({
      method: operation.method,
      url: operation.url,
      handler: async (request, reply) => {
        const auth = await requireAuth(request, reply, db);
        if (!auth) return;
        reply.header("Cache-Control", "no-store");
        // Cookies are shared across tabs. A stale UI may not submit/replay under
        // another membership, or mistake that actor's rejection for its receipt.
        // These headers only constrain the authenticated actor; they grant no rights.
        if (
          request.headers["x-economy-campaign"] !== auth.campaignId ||
          request.headers["x-economy-membership"] !== auth.membershipId
        )
          return reply
            .code(409)
            .send({
              error: "ECONOMY_CONTEXT_CHANGED",
              message:
                "Сменился аккаунт или кампания. Вернитесь в исходную кампанию, чтобы проверить сохранённый запрос.",
            });
        let result: unknown;
        try {
          result = await operation.run(auth, request.body, request.query);
        } catch (reason) {
          if (reason instanceof z.ZodError)
            return reply
              .code(400)
              .send({
                error: "ECONOMY_INVALID_INPUT",
                message:
                  "Проверьте поля: границы, сезоны и диапазоны не должны конфликтовать.",
                notApplied: true,
              });
          const code = reason instanceof Error ? reason.message : "";
          if (messages[code])
            return reply
              .code(code === "ECONOMY_FORBIDDEN" ? 403 : 409)
              .send({
                error: code,
                message: messages[code],
                notApplied: ![
                  "ECONOMY_FORBIDDEN",
                  "ECONOMY_ACTION_CONFLICT",
                ].includes(code),
              });
          if (
            ["40001", "40P01", "23505"].includes(
              postgresErrorCode(reason) ?? "",
            )
          )
            return reply
              .code(409)
              .send({
                error: "ECONOMY_RETRY_SAME_ACTION",
                message:
                  "Параллельное изменение. Повторите тот же запрос, не создавая новую покупку.",
              });
          request.log.error({
            event: "economy.request_failed",
            route: operation.url,
          });
          return reply
            .code(500)
            .send({
              error: "ECONOMY_RESULT_UNKNOWN",
              message:
                "Ответ не подтверждён. Проверьте историю и повторите тот же запрос.",
            });
        }
        if (operation.mutate)
          try {
            await broadcast(auth.campaignId);
          } catch {
            request.log.warn({ event: "economy.broadcast_failed" });
          }
        return reply.send(result);
      },
    });
}
