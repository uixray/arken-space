import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { creationReadQuerySchema, evaluateCreationSchema, reviewCreationSchema, saveCreationRulesSchema,
  saveCreationTemplateSchema, setCreationRulesEnabledSchema, saveCreationRecipeSchema,
  setCreationRecipeEnabledSchema, creationOperationQuoteSchema, commitCreationOperationSchema,
  transferCreationObjectSchema, saveCreationStorePolicySchema, saveCreationListingSchema, setCreationListingEnabledSchema,
  creationStoreQuoteSchema, commitCreationPurchaseSchema, forkCreationTemplateSchema } from "@arken/contracts";
import { requireAuth, type AuthContext } from "./auth.js";
import { postgresErrorCode } from "./database-errors.js";
import { previewCreation, reviewCreation, saveCreationRules, saveCreationTemplate, setCreationRulesEnabled, forkCreationTemplate } from "./creation-authoring.js";
import { readCreationAction, readCreationHistory, readCreationLibrary, readCreationReviews,
  readCreationRuleHistory, readCreationRules } from "./creation-read.js";
import type { CreationDatabase } from "./creation-state.js";
import { cancelCreationAction } from "./creation-state.js";
import { readCreationRecipeHistory, readCreationRecipes, saveCreationRecipe, setCreationRecipeEnabled } from "./creation-recipes.js";
import { commitCreationOperation, quoteCreationOperation } from "./creation-operations.js";
import { readCreationObjects, readCreationOperations } from "./creation-object-read.js";
import { readCreationMaterials, readCreationMaterialCatalog, readCreationLineage } from "./creation-library-read.js";

const objectId = z.object({ id: z.string().uuid() }).strict();
const historyQuery = z.object({ before: z.coerce.number().int().min(0).max(2_000_000_000).optional() }).strict();
const objectsQuery = z.object({ characterId: z.string().uuid(), after: z.string().uuid().optional() }).strict();
const operationsQuery = objectsQuery.partial({ characterId: true });
const recipesQuery = z.object({ characterId: z.string().uuid().optional() }).strict();
const materialCatalogQuery = z.object({ after: z.string().uuid().optional(), ids: z.string().max(5000)
  .transform(v => v.split(",")).pipe(z.array(z.string().uuid()).min(1).max(128)).optional() }).strict();
const messages: Record<string, string> = {
  CREATION_SCOPE_LIMIT: "В этом этапе доступно только изготовление новых объектов.",
  CREATION_FORBIDDEN: "Нет права на это действие или черновик.",
  CREATION_ANCESTRY_FORBIDDEN: "История происхождения недоступна: часть связанных объектов принадлежит другим персонажам. Обратитесь к мастеру.",
  CREATION_UNAVAILABLE: "Запись недоступна в этой кампании.",
  CREATION_DATA_UNAVAILABLE: "Сохранённая запись не соответствует контракту. Обратитесь к мастеру.",
  CREATION_CONFLICT: "Версия уже изменилась. Сначала загрузите актуальную запись.",
  CREATION_KIND_CONFLICT: "Тип конструктора существующего набора или шаблона менять нельзя.",
  CREATION_ACTION_CONFLICT: "Этот код действия занят другим запросом. Не создавайте новый запрос вслепую.",
  CREATION_RULES_DISABLED: "Набор правил не опубликован или выключен мастером.",
  CREATION_RULES_STALE: "Для нового черновика выберите текущую опубликованную версию правил.",
  CREATION_UNPRICED_RULES: "Перед публикацией GM должен задать расчёт каждого компонента.",
  CREATION_ITEM_UNAVAILABLE: "Основа или материал должны ссылаться на существующий неархивный ITEM.",
  CREATION_INVALID_DESIGN: "Версия содержит ошибки расчёта и пока не может быть одобрена.",
  CREATION_EVALUATOR_CHANGED: "Расчёт изменился. Создайте и проверьте новую версию, не переписывая прежнюю.",
  CREATION_CATALOG_LIMIT: "Достигнут предел этого каталога. Продолжите работу с существующими записями.",
  CREATION_VERSION_LIMIT: "Достигнут предел истории версий. История сохранена; обратитесь к мастеру.",
  CREATION_APPROVAL_REQUIRED: "Нужен действующий допуск мастера для каждой точной версии рецепта.",
  CREATION_RECIPE_KIND: "Навыки и артефакты нельзя незаметно заменить друг другом в рецепте.",
  CREATION_RECIPE_MATERIALS: "Рецепт должен учитывать материалы компонентов и реальную ITEM-основу артефакта.",
  CREATION_RECIPE_SP: "Стоимость SP должна покрывать расчёт выхода за вычетом SP-состава полностью расходуемых входов.",
  CREATION_RECIPE_CYCLE: "Включение создаёт цикл развития среди действующих рецептов. Проверьте весь путь переходов.",
  CREATION_RECIPE_DISABLED: "Рецепт ещё не опубликован или выключен мастером.",
  CREATION_RECIPE_STALE: "Опубликована новая версия рецепта. Запросите новую котировку.",
  CREATION_QUOTE_UNAVAILABLE: "Котировка недоступна этому участнику.",
  CREATION_QUOTE_USED: "Эта котировка уже подтверждена. Найдите квитанцию прежнего действия.",
  CREATION_QUOTE_EXPIRED: "Время котировки истекло. Запросите новую и проверьте её перед подтверждением.",
  CREATION_QUOTE_STALE: "Ресурсы, допуск или входы изменились. Запросите новую котировку.",
  CREATION_INPUTS_MISMATCH: "Нужны отдельные активные объекты указанных версий, уровней и этапов.",
  CREATION_OBJECT_UNAVAILABLE: "Созданный объект уже израсходован, передан или недоступен.",
  CREATION_MATERIAL_UNAVAILABLE: "Материал отсутствует в доступном инвентаре персонажа или его недостаточно.",
  CREATION_MATERIALS_MISMATCH: "Выберите ровно указанные в рецепте количества материалов.",
  CREATION_MATERIAL_BOUND: "Нельзя расходовать созданный объект как обычный материал, товар магазина или связанную с картой вещь.",
  CREATION_REQUIREMENTS: "Характеристики персонажа не соответствуют требованиям версии.",
  CREATION_WALLET_INVALID: "Кошелёк содержит недопустимые числа или итог выходит за безопасный диапазон.",
  CREATION_INSUFFICIENT_FUNDS: "Не хватает монет или SP. Возврат от разбора не оплачивает его стоимость заранее.",
  CREATION_BASIS_LIMIT: "Историческая оплаченная база превышает допустимый размер операции.",
  CREATION_TRANSFER_TARGET: "Для передачи выберите другого персонажа этой кампании.",
  CREATION_STORE_DISABLED: "Мастер ещё не настроил или выключил витрину кампании.",
  CREATION_STORE_POLICY: "Тип или цена лота не соответствуют действующим правилам витрины.",
  CREATION_LISTING_UNAVAILABLE: "Лот выключен или недоступен в этой кампании.",
  CREATION_LISTING_MODERATED: "Лот скрыт мастером. Только мастер может вернуть его на витрину.",
  CREATION_LISTING_SOLD_OUT: "Лимит покупок этого лота исчерпан.",
  CREATION_LISTING_EXPIRED: "Срок предложения закончился.",
  CREATION_STORE_PAYOUT: "Для выплаты нужен активный персонаж автора. Системный sink доступен только мастеру.",
  CREATION_STORE_RECIPE: "Для копии нужен действующий рецепт изготовления ровно этой версии.",
  CREATION_STORE_HIDDEN_MATERIAL: "Лот нельзя опубликовать, пока его основы и материалы скрыты от игроков кампании.",
  CREATION_LISTING_IDENTITY: "Для другого шаблона или вида продажи создайте отдельный лот. История этого сохраняется.",
  CREATION_STORE_SELF_PURCHASE: "Нельзя купить собственный лот или заплатить в тот же кошелёк.",
  CREATION_STORE_OWNER_REQUIRED: "Для покупки шаблона назначьте персонажу владельца. Лицензия принадлежит владельцу, не контролёру.",
  CREATION_LICENCE_OWNED: "У владельца персонажа уже есть лицензия на эту версию; повторная покупка не требуется.",
};
export function registerCreationRoutes(app: FastifyInstance, db: CreationDatabase,
  broadcast: (campaignId: string) => Promise<void>) {
  type Run = (auth: AuthContext, body: unknown, query: unknown, params: unknown) => Promise<unknown>;
  const operations: Array<{ method: "GET" | "POST" | "PUT"; url: string; mutate?: boolean; run: Run }> = [
    { method: "POST", url: "/api/creation/actions/cancel", run: (auth, body) => {
      const path = (body as { path?: unknown })?.path;
      if (typeof path !== "string" || /^(?:store\/|objects\/transfer|templates\/fork)/.test(path)) throw new Error("CREATION_UNAVAILABLE");
      return cancelCreationAction(db, auth, body);
    } },
    { method: "GET", url: "/api/creation/rules", run: auth => readCreationRules(db, auth) },
    { method: "GET", url: "/api/creation/rules/:id/versions", run: (auth, _body, query, params) =>
      readCreationRuleHistory(db, auth, objectId.parse(params).id, historyQuery.parse(query).before) },
    { method: "POST", url: "/api/creation/rules/versions", run: (auth, body) => saveCreationRules(db, auth, saveCreationRulesSchema.parse(body)) },
    { method: "PUT", url: "/api/creation/rules/enabled", run: (auth, body) => setCreationRulesEnabled(db, auth, setCreationRulesEnabledSchema.parse(body)) },
    { method: "POST", url: "/api/creation/evaluate", run: (auth, body) => previewCreation(db, auth, evaluateCreationSchema.parse(body)) },
    { method: "POST", url: "/api/creation/templates/versions", run: (auth, body) => saveCreationTemplate(db, auth, saveCreationTemplateSchema.parse(body)) },
    { method: "GET", url: "/api/creation/templates", run: (auth, _body, query) => readCreationLibrary(db, auth, creationReadQuerySchema.parse(query).after) },
    { method: "GET", url: "/api/creation/templates/:id/versions", run: (auth, _body, query, params) =>
      readCreationHistory(db, auth, objectId.parse(params).id, historyQuery.parse(query).before) },
    { method: "POST", url: "/api/creation/reviews", run: (auth, body) => reviewCreation(db, auth, reviewCreationSchema.parse(body)) },
    { method: "GET", url: "/api/creation/versions/:id/reviews", run: (auth, _body, query, params) =>
      readCreationReviews(db, auth, objectId.parse(params).id, historyQuery.parse(query).before) },
    { method: "GET", url: "/api/creation/actions/:id", run: (auth, _body, _query, params) => readCreationAction(db, auth, objectId.parse(params).id) },
    { method: "GET", url: "/api/creation/recipes", run: (auth, _body, query) => readCreationRecipes(db, auth, recipesQuery.parse(query).characterId) },
    { method: "GET", url: "/api/creation/recipes/:id/versions", run: (auth, _body, query, params) =>
      readCreationRecipeHistory(db, auth, objectId.parse(params).id, historyQuery.parse(query).before) },
    { method: "POST", url: "/api/creation/recipes/versions", run: (auth, body) => { const input = saveCreationRecipeSchema.parse(body); if (input.source.operation !== "CRAFT") throw new Error("CREATION_SCOPE_LIMIT"); return saveCreationRecipe(db, auth, input); } },
    { method: "PUT", url: "/api/creation/recipes/enabled", run: (auth, body) => setCreationRecipeEnabled(db, auth, setCreationRecipeEnabledSchema.parse(body)) },
    { method: "POST", url: "/api/creation/operations/quote", run: (auth, body) => { const input = creationOperationQuoteSchema.parse(body); if (input.inputObjectIds.length) throw new Error("CREATION_SCOPE_LIMIT"); return quoteCreationOperation(db, auth, input); } },
    { method: "POST", url: "/api/creation/operations/commit", mutate: true,
      run: (auth, body) => commitCreationOperation(db, auth, commitCreationOperationSchema.parse(body)) },
    { method: "GET", url: "/api/creation/objects", run: (auth, _body, query) => {
      const input = objectsQuery.parse(query); return readCreationObjects(db, auth, input.characterId, input.after);
    } },
    { method: "GET", url: "/api/creation/operations", run: (auth, _body, query) => {
      const input = operationsQuery.parse(query); return readCreationOperations(db, auth, input.characterId, input.after);
    } },
    { method: "GET", url: "/api/creation/material-catalog", run: (auth, _body, query) => {
      const input = materialCatalogQuery.parse(query); return readCreationMaterialCatalog(db, auth, input.after, input.ids);
    } },
    { method: "GET", url: "/api/creation/materials", run: (auth, _body, query) => {
      const input = objectsQuery.parse(query); return readCreationMaterials(db, auth, input.characterId, input.after);
    } },
    { method: "GET", url: "/api/creation/objects/:id/lineage", run: (auth, _body, query, params) =>
      readCreationLineage(db, auth, objectId.parse(params).id, creationReadQuerySchema.parse(query).after) },
  ];
  for (const operation of operations) app.route({ method: operation.method, url: operation.url, bodyLimit: 512 * 1024,
    handler: async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      reply.header("Cache-Control", "no-store");
      if (request.headers["x-creation-campaign"] !== auth.campaignId || request.headers["x-creation-membership"] !== auth.membershipId)
        return reply.code(409).send({ error: "CREATION_CONTEXT_CHANGED", message: "Сменилась кампания или участник. Восстановите исходный контекст перед повтором." });
      let result: unknown;
      try { result = await operation.run(auth, request.body, request.query, request.params); }
      catch (reason) {
        if (reason instanceof z.ZodError) return reply.code(400).send({ error: "CREATION_INVALID_INPUT",
          message: "Проверьте состав, параметры и границы правил." });
        const code = reason instanceof Error ? reason.message : "";
        if (messages[code]) return reply.code(code === "CREATION_FORBIDDEN" || code === "CREATION_ANCESTRY_FORBIDDEN" ? 403 : code === "CREATION_UNAVAILABLE" ? 404 : 409)
          .send({ error: code, message: messages[code] });
        if (["40001", "40P01", "23505"].includes(postgresErrorCode(reason) ?? ""))
          return reply.code(409).send({ error: "CREATION_RETRY_SAME_ACTION", message: "Параллельное изменение. Сохраните прежний actionId и перечитайте результат." });
        request.log.error({ event: "creation.request_failed", route: operation.url });
        return reply.code(500).send({ error: "CREATION_RESULT_UNKNOWN", message: "Результат не подтверждён. Проверьте сохранённое действие перед повтором." });
      }
      // The receipt is already durable. Refresh failure cannot turn a committed
      // action into notApplied or justify submitting a fresh actionId.
      if (operation.mutate) try { await broadcast(auth.campaignId); }
      catch { request.log.warn({ event: "creation.broadcast_failed" }); }
      return reply.send(result);
    },
  });
}
