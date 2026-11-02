# UIX-265 — локальный пул магазинов

Статус на2026-11-02: согласованный связанный путь собран локально, завершающая
исходниковая сверка выполнена и найденные разрывы исправлены. Это source-only этап:
ни runtime, ни компилятор, ни миграция не запускались. Не Ready/Done.
База b7cf522d + сохранённый общий локальный пул.

## Решение владельца
Мастер задаёт календарь/сезоны/регионы и цены. Игрок получает серверную цену и
покупает количество; кошелёк, остаток, инвентарь и журнал должны меняться атомарно.
**Игрок также сохраняет право вручную менять монеты.** Происхождение денег не
контролируется магазином, SP не меняется. Новый режим не включается автоматически.

## Написанные исходники
- `packages/contracts/src/economy.ts`: строгие команды и проекции, явные пределы.
- `packages/db/src/schema.ts`, `drizzle/0080_economy_shops.sql`, journal/0080 snapshot:
  nullable canonical ITEM base price, campaign config, merchants/offers, quotes,
  immutable purchase receipts. Метаданные составлены как исходники, не сгенерированы
  Drizzle и не подтверждены базой. Операционная миграция не выполнена.
- `apps/server/src/economy-{math,state,admin,read,purchase,routes,stock-visibility}.ts`:
  серверный расчёт, GM CRUD, фильтрация, история, транзакционный путь и повтор.
  Подключено из routes.ts; base price расширяет существующий canonical editor API.
- `apps/web/src/Economy{Workspace,Manager}.tsx`, economy-client.ts/economy.css:
  отдельный раздел магазинов, авторские формы, котировка/подтверждение, история.
  Незавершённый платёж сохраняет actionId/quoteId в localStorage на campaign/member;
  Web Locks сериализует вкладки. Без Web Locks покупка блокируется, unsafe fallback нет.
  Запросы привязаны заголовками к текущим campaign/member; смена cookie в соседней
  вкладке не должна переносить запрос на другого участника. Заголовки сверяются с
  серверной сессией, не заменяют авторизацию. Для `/api/economy*` обязательны
  `x-economy-campaign` и `x-economy-membership`; canonical PATCH проверяет их,
  когда они переданы магазинной формой. Отказ контекста сохраняет неизвестный результат.
- Общие player instance/portrait projections исключают магазинный остаток; отдельный
  shop API возвращает только разрешённые предложения. Уже раскрытый canonical lore
  не становится секретным из-за скрытия предложения. GM rules/inputs — только GM history.

## Семантика
Календарь — повторяющийся год1–36 месяцев, 1–366 дней, один сезон на месяц;
без високосных исключений. Харизма читается из серверной характеристики, отсутствие
диапазона блокирует расчёт. Supply/demand — авторский процент, не автоматическая
экономическая симуляция. Нейтральный коэффициент100%, диапазон0–10000%.
База — медные за штуку, NULL означает «не назначена», 0 — явно бесплатно.
Факторы перемножаются BigInt, округление вверх один раз для всей покупки.
GM фиксированная цена заменяет расчёт факторов, требует причины; она записана в
приватные входы котировки. Сдача при покупке —100:10:1, SP сохраняется.

Котировка2 минуты, содержит ревизии всех входов, дату, характеристику, факторы,
stock/wallet snapshot и hash. Clock reset/смена правил/характеристики/кошелька/
предмета/остатка требуют новой явной котировки. Purchase принимает только quote/action.
В рамках одной DB transaction: coins debit + stock decrement + новый buyer instance
+ receipt + instance audit + GM-only chat + game event. Не копируются GM notes,
currentState, portrait, старый владелец/локация/контейнер. Даже покупка всей стопки
создаёт новый buyer instance; исходный остаток становится0.

Порядок lock: action → inventory graph → campaign SHARE → membership SHARE →
economy UPDATE → quote/offer/merchant → canonical → character/controller → instance.
Legacy CAS wallet writers не изменены. Повтор подтверждённой покупки возвращает
историческую actor-owned receipt, не пересчитывает цену и не списывает монеты снова.

## Итог связанной исходниковой сверки
- Прочитан путь contracts → GM authoring → quote → purchase → DB/журнал → UI,
  а также существующие instance graph/action locks, wallet CAS, inventory ACL,
  player instance/portrait projections и canonical price PATCH.
- Исправлена подмена ревизии несохранённого config/price-черновика при обновлении
  соседней формы: теперь draft и его revision сохраняются вместе. Явная перезагрузка
  блокирует ввод на время чтения; после начальной ошибки чтение можно повторить.
- Повторный выбор уже выставленного экземпляра исключён из списка и отвергается
  сервером как явный конфликт до unique violation. Пределы100/500 проверяются при
  создании под тем же graph lock, чтобы запись не делала каталог нечитаемым.
- Ожидание каждого HTTP-ответа ограничено30с. Таймаут не отменяет транзакцию и не
  снимает pending. Повтор использует прежние action/quote и x-action-id; смена
  аккаунта/кампании не трактуется как доказательство отсутствия прежней покупки.
  Web Lock освобождается после результата покупки, до чтения каталога/истории.
  Начало покупки после закрытия компонента блокируется; refresh убирает старую котировку.
- Прочитаны0080 SQL, определения Drizzle и соответствующие метаданные пяти таблиц,
  base_price, индексов/FK/check и цепочка0079→0080. Найденного расхождения в этом
  source-проходе нет; это НЕ применение миграции и не валидация Drizzle/SQL-компилятором.

## Матрица исходных критериев UIX-265
Все строки «код» означают наличие реализации по исходниковой сверке, не runtime PASS.

| Критерий | Источник реализации / оставшееся доказательство |
|---|---|
| Base price + currency/unit | Код: nullable ITEM.basePriceCopper, медные/штука в контракте/форме; world-content-routes + schema/0080 |
| Merchant region/stock/rules | Код: economy-admin, canonical LOCATION, existing instance quantity; строгие GM-команды |
| Серверная цена и все авторские факторы | Код: economy-state + economy-math; BigInt, одна операция ceil после количества |
| Ревизии, факторы, округление, итог каждой котировки | Код: private economy_quotes.inputs + inputHash/view; GM history для покупок |
| Expiry и stale stock/wallet/rules | Код:120с, повторный расчёт под locks, сравнение inputHash, повтор expiry после ожидания |
| Атомарные wallet/stock/inventory/history | Код: одна transaction в economy-purchase, receipt/instance audit/GM chat/game event внутри неё |
| Повтор actionId не дублирует покупку | Код: общий action lock, actor/requestHash, unique action/quote и историческая receipt |
| Нельзя подменить character/stat/region/season/price | Код: campaign/owner/controller ACL, строгая quote-команда, только server rows; session-context guard |
| GM override с причиной | Код: contracts + DB check, reason сохранена с private inputs |
| Скрытый stock и правила | Код: отдельные проекции, GM-only inputs, nonShopInstance в общих списках; уже раскрытый lore не отзывается |
| Проверочные сценарии из AC | НЕ выполнены: concurrent purchase, insufficient funds, stale/expiry, season/reset, charisma, rollback, ACL/replay |

## Остаток до приёмки и публикации
После отдельного разрешения нужны компиляция/сборка, миграция и реальные сценарии
из последней строки, включая два GM с несохранёнными формами, две вкладки и смену
сессии при неизвестном результате. UI/runtime и concurrency не проверены.
Весь UIX-461 остаётся отдельным незавершённым объёмом: генераторы/баланс, библиотека,
UGC approval, витрина и lifecycle не закрываются этим магазином.

Лимиты текущего списка:100 merchants,500 offers,1000 candidate instances/regions;
при превышении явная ошибка, не молчаливая усечённая выдача. Quotes пока сохраняются
без retention job; это надо учесть при будущей операционной подготовке.
Неизвестное сохранение GM-формы удерживает тот же запрос пока форма открыта;
после её закрытия требуется чтение сохранённых настроек, не автоматическая отправка
заново. Персистентное восстановление после reload предусмотрено именно для покупки.
