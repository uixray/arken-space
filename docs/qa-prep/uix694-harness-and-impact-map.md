# UIX-694: переиспользуемый setup и проверяемая карта влияния

Сверка 19.11.2026 относительно опубликованного `b60dbb0f367c44c5025ee71b4f66cc4274b7065f`. Это реализация QA-инструментов, не новый обязательный CI gate и не полная карта транзитивных зависимостей.

## Актуальное состояние вместо исторических предположений

Обе исторические ссылки на независимый audit из Linear сейчас недоступны в локальном checkout; его точный текст не восстановлен и не выдаётся за прочитанный. Актуальный код проверен непосредственно:

- Общий [campaign-fixture](../../tests/e2e/campaign-fixture.ts) уже был, а не отсутствовал: новая кампания на тест, подключение на worker, канонический `createCampaignWithGmAccess`, worker-owned история.
- Общий [mocked chat transport](../../tests/e2e/mocked-chat-app.ts) уже обслуживает bootstrap и Socket.IO handshake; сценарные HTTP handlers остаются у consumers.
- Не хватало отдельно проверяемых ownership/lifecycle правил. Проверка loopback раньше выполнялась только при seed чата, уже после возможности создать кампанию в произвольной БД.
- Git-adapter карты влияния не был опубликован; сама карта оставалась частичной. Изменение общего fixture нельзя считать полностью проверенным только по нескольким unit-тестам.

## Что реализовано

1. [Owned campaign/history core](../../tests/e2e/owned-campaign-history.ts) валидирует PostgreSQL loopback URL **до открытия подключения**, резервирует токен до async создания, регистрирует только успешного владельца, отвергает чужие токены и счётчики вне 1–100 до записи. Registry не передаётся consumers по изменяемой ссылке.
2. Тот же core встроен в существующий Playwright fixture. Канонический seed, имена публичных fixtures и случайные E2E tokens сохранены. Соединение закрывается при успехе и ошибке; одновременно возникшие ошибки consumer и cleanup обе остаются в `AggregateError`. Кампании не удаляются: БД должна быть выделенной одноразовой.
3. [SQL helper](../../tests/e2e/chat-history-fixture.ts) сохраняет реальную проверку GM и принадлежности кампании в транзакции, точные тела сообщений, порядок и ограничение размера. Общая count-validation не заменяет SQL-ACL.
4. [Read-only report](../../scripts/qa/impact-report.mjs) получает diff и untracked относительно явно разрешённого commit, возвращает JSON advisory. Новые пути не скрываются, invalid map завершает report с ошибкой; никакой тест/CI он не запускает.
5. [Impact map](../../scripts/qa/impact-map.mjs) содержит source-backed правила для mocked transport, validators/report, account, realtime, cartographic presentation и общего campaign/history setup. Для shared setup и labels обязателен `manualReview: true`: даже все известные пути не превращаются в «полное покрытие». Это ручной выбор связанного пула агентом, не запрос нового owner approval на каждый тест.

## Условия безопасности и запуска

- Только выделенная локальная PostgreSQL БД (`localhost`, `127.0.0.1`, `::1`). Сам loopback **не доказывает**, что БД одноразовая: нельзя направлять fixture на SSH tunnel к production или на локальную рабочую кампанию. Адреса Docker service изнутри production Compose не являются допустимым QA endpoint; штатный e2e workflow использует localhost mapping.
- Допустим стандартный `sslmode`; query-переадресации host/socket/service и URL fragment отвергаются. Ошибка не печатает credentials.
- Реальный fixture не подменяет session provenance, серверную авторизацию, CSRF, роли или operator allowlist. Серверный auth mode выбирается существующим тестовым окружением, не helper-ом. Account-login acceptance выполняется отдельно от GM-link setup.
- Mocked transport предназначен только для полностью synthetic snapshots. Его capabilities не доказывают настоящий вход, Socket.IO ACL или приватность production.
- [API seed fallback](../../tests/e2e/chat-seed.ts) остаётся отдельным: bounded 429 retry с тем же actionId, не повторяет прочие ошибки. Bulk SQL preparation не считается тестом rate limit.

Пример advisory report (без запуска проверок):

```sh
node scripts/qa/impact-report.mjs --base b60dbb0f367c44c5025ee71b4f66cc4274b7065f
```

## Реальные сценарии и границы покрытия

| Набор                                     | Что проверяет                                                                                                  | Что НЕ доказывает                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `tests/owned-campaign-history.test.ts`    | URL guard до подключения, worker ownership, pending/failed create, коллизии, bounds, cleanup/error propagation | HTTP/session authentication, браузер         |
| `tests/chat-history-fixture.test.ts`      | Реальный SQL, GM/campaign ownership, порядок и 40 точных тел, foreign rejection                                | сетевой rate limit, UI overflow              |
| `tests/qa-impact-{map,report}.test.ts`    | Валидность/advisory-only, сохранение unknown, разрешённый SHA, conservative manual review                      | полноту dependency graph, product acceptance |
| `tests/e2e/uix289-bundled-motion.spec.ts` | 7 mocked browser сценариев истории/critical frame/motion/404                                                   | live API и live GM/PLAYER                    |
| `tests/e2e/chat-icon-states.spec.ts`      | 4 role/width случая, pending send и иконки                                                                     | настоящий вход и backend ACL                 |
| `tests/e2e/chat-history-owned.spec.ts`    | 1 существующий real-fixture сценарий unknown token/count + owned bulk history                                  | всю матрицу браузерных consumers             |

В перечисленных файлах нет `test.skip`/`test.fixme` на момент сверки. Не запущенные browser/backend-domain journeys — **NOT_RUN**, не SKIP и не PASS. Проверки валидатора не переносятся на предлагаемые им сценарии.

## Стоимость и critical path

Ownership/URL unit-проверки не открывают БД; SQL проверка использует один изолированный PGlite clone уже существующего per-worker template, без HTTP seed и повторного baseline. Для холодного SQL driver теста выделено 60 секунд, не добавлены retries и не изменены assertions. Фактический итоговый runtime фиксируется в checkpoint этого пула; прежние измерения SQL-vs-HTTP не повторяются и не объявляются новым сравнением.

Отбор не входит в push/PR workflow, ничего не отключает, не расширяет CI/browser matrix и не заменяет source review. Для общего campaign fixture нужно выбрать затронутых consumers по изменённому контракту; для CSS labels — проверить настоящий browser paint/hit targets. Общие routers, миграции, схема, массовые стили и неописанные домены остаются на ручной разбор. Следующее расширение карты делается по конкретному продуктовому изменению, а не ради процента покрытия.
