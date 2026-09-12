# UIX-475 — автопрокрутка после реальной правки ресурсов

## Основание и границы

- Linear UIX-475 — источник симптома и приёмки. Постановка и комментарий
  29.08.2026 прочитаны; прежние GM/PLAYER замеры resize/сворачивания/−1 не
  воспроизвели проблему и не считаются новым доказательством причины.
- Ветка `codex/uix-475-resource-follow-scroll`, отдельный worktree, база
  свежий `origin/main` — `f1a66c8`. Код текущего release-tail в неё не слит.
  PR #58–#65 имеют зелёный обязательный CI; их merge остаётся решением владельца.
- `useFollowScroll` уже имеет ResizeObserver и follow threshold; этот hook
  и существующий `follow-scroll.spec.ts` одинаковы в `f1a66c8` и `5bd5431`.
  ChatPanels в подготовленном пуле отличается, поэтому замеры разных баз
  нельзя без проверки выдавать за одну интегрированную ревизию.
- Production, production-данные, `measure-broadcast.ts`, assets/stickers не
  используются. Сломанный battle UI не возвращается.

## Диагностический пул

Четыре независимые синтетические кампании: GM/PLAYER × 1920×1080/1280×720.

1. Настоящий вход, переполнение журнала, reload и доказанное положение у дна.
2. Реальный pointer click −1 и числовое поле ресурсов: ввод → Enter,
   затем ввод → Tab/blur. Ожидается успешный counters PATCH, не только
   optimistic изменение цифры.
3. После правки — настоящий новый бросок; измеряется сохранность follow.
4. Свёрнутые быстрые броски, reload с сохранённым состоянием и повторная
   правка; на низком viewport — сворачивание/возврат sidebar после уже
   подтверждённой правки и ещё один edit→roll. Проверка не смешивается с
   мобильной задачей UIX-316 и не меняет debounce/unmount-контракт.
5. К шагам прилагаются геометрия списка и события scroll/focus:
   `scrollTop`, `scrollHeight`, `clientHeight`, расстояние до дна,
   активный элемент и индикатор новых событий.

Исходная причина не объявляется по чтению кода. Первый прогон выполняется
без production-правок. Если нового FAIL нет — остаётся только точная
resource E2E-регрессия; `useFollowScroll`/ChatPanels не меняются.

## Чекпоинт начала

- Решение: проверить реальный resource trigger, а не ещё один synthetic resize.
- Ревизия: `f1a66c8`, до правок.
- Файлы в scope: `tests/e2e/follow-scroll.spec.ts`, этот документ. Изменения
  production-кода допускаются только после измеренного FAIL и отдельного
  уточнения scope.
- Проверки: установка по lockfile и build выполняются; browser baseline
  пока не запускался. БД одноразовая локальная, не копия production.
- Диверсия: после baseline, должна уронить именно новую resource-проверку.
- Блокеры: исходные роль/разрешение/reload пользователя пока неизвестны;
  вопрос отправлен асинхронно, локальную матрицу это не останавливает.
- Следующее действие: завершить test fixture, запустить реальный baseline,
  сохранить измерения, затем решить, нужен ли production fix.

## Замер без production-правок

Первый Chromium-пул: **4/4 PASS**, настоящий exit 0, 2,2 минуты.
Ни route mocks, ни имитации scroll/style вместо ResourceCounters нет.
Роль PLAYER проверяется на основной странице под React console guard;
отдельный GM-контекст только выпускает приглашение.

| Случай           | Высота ленты до/после collapse быстрых бросков | Расстояние до дна |
| ---------------- | ---------------------------------------------- | ----------------- |
| GM 1920×1080     | 310 → 526 px                                   | 0 px              |
| GM 1280×720      | 160 → 166 px                                   | 0 px              |
| PLAYER 1920×1080 | 339 → 555 px                                   | 0 px              |
| PLAYER 1280×720  | 160 → 195 px                                   | 0 px              |

- `scrollHeight` растёт от 1473 до 1877–1897 px; переполнение проверяется
  явно, поэтому тест не проходит на пустой или несворачиваемой ленте.
- Во всех фазах после counter PATCH и нового server-authoritative roll,
  а также после collapse/reload, расстояние до дна 0 px. Min/max расстояния
  в записанных scroll/focus/resize событиях — 0/0, индикатор новых событий
  отсутствует.
- Новый roll вызывается реальным `/api/dice`, без клика по ленте или кнопке
  броска: тест не должен случайно исправить фокус самостоятельным действием.
- Вывод: исходный симптом не воспроизведён; основания менять
  `useFollowScroll`/ChatPanels не появились. Scope остаётся test-only.
- Диагностика первого прогона:
  `%TEMP%/arken475-baseline-db1354a107ab452bb9d100db72fb98c1`.
- Связанный итоговый пул дополнен low-viewport sidebar collapse/reopen;
  он и диверсия выполняются. Более широкий диапазон sidebar widths,
  исходная пользовательская конфигурация и интегрированный release-tail
  не объявляются проверенными этим замером.

## Чекпоинт передачи на review

- Решение: исходный симптом **не воспроизведён**. Добавлена регрессия реального
  ResourceCounters → подтверждённый PATCH → новый roll. Production-код,
  `useFollowScroll`, ResourceCounters и ChatPanels не изменены; это не заявление
  об исправлении пользовательского бага.
- Ревизия: база `f1a66c8`; итоговая ревизия тестового пакета фиксируется в Git,
  PR и Linear после коммита.
- Изменённые файлы: `tests/e2e/follow-scroll.spec.ts`, этот документ.
- Финальная ресурсная матрица: **8/8 PASS**, Chromium + Firefox, без ретраев,
  exit 0, 4 минуты. Проверены обе роли и оба viewport, pointer decrement,
  Enter и Tab/blur, quick-roll collapse/reload, low-viewport sidebar reopen.
  После Enter input сохраняет фокус и после PATCH, и после нового roll.
- В предшествующем общем follow-scroll пуле — 15 PASS и аварийное завершение
  native Firefox worker (`code=3221226505`, тест 0 ms), не assertion failure.
  Все восемь новых сценариев после этого повторно прошли чисто. Это два
  отдельных прогона, а не заявление о едином 16/16 PASS.
- Диверсия ожидания: сразу после первого реального PATCH временно потребовали
  расстояние до дна `>48`. Именно новая GM 1920×1080 Chromium проверка упала
  на pointer-decrement: `Expected: >48`, `Received: 0`, exit 1. Исходник
  восстановлен побайтно; проверка не выдаётся за поломку production-hook.
- Локальная подготовка: установка по frozen lockfile и build PASS; адресные
  Prettier, ESLint, E2E TypeScript и `git diff --check` проходят. Полный
  обязательный checks/E2E/multiplayer gate новой ветки ожидается в GitHub CI;
  зелёные результаты PR #63 не подменяют проверку этой базы.
- Артефакты: `%TEMP%/arken475-diversion.log`,
  `%TEMP%/arken475-follow-pool.log`,
  `%TEMP%/arken475-final-resource-matrix.log` и одноимённые output-каталоги
  с trace/диагностикой. Только одноразовая локальная БД.
- Блокеры для закрытия исходного бага: неизвестна конфигурация исходного
  пользовательского воспроизведения; общий release-tail ещё не интегрирован.
  Произвольные ширины sidebar и реальное пользовательское окружение не
  объявляются проверенными.
- Следующее действие: test-only PR в `main`, обязательный CI, затем review.
  Merge, Done и production остаются отдельным решением владельца.

## UIX-475 — checkpoint подготовки resize baseline, 08.09.2026

- Решение: проверить отдельный достижимый precursor — изменение viewport
  **1440×900 → 1280×720**, затем настоящий counters PATCH и новый roll.
  Ранние восемь resource-сценариев начинались при фиксированном viewport;
  их PASS не проверял такой переход после монтирования журнала.
- Ревизия: `d68f8ed`, ветка `codex/uix-475-resize-follow`. Production hook,
  ChatPanels, CSS, конфигурация и существующие тесты не изменены.
- Файлы: `tests/e2e/follow-scroll-resize-regression.spec.ts`, этот checkpoint.
- Основание от root: read-only замер опубликованной версии в Chrome дал
  высоту ленты 292 → 160 px и gap 132 px; scroll с новой геометрией пришёл
  перед ResizeObserver примерно на 7,6 ms. Gameplay mutations не выполнялись.
  Это измеренный geometry failure, **не доказательство исходной причины PATCH**.
- Source-механизм для проверки: `onScroll` записывает `followRef=false` при
  gap ≥48 без различения пользовательского и resize-scroll; последующий
  ResizeObserver уже не закрепляет ленту. Оба viewport остаются desktop;
  breakpoint 1023/1150/1279 не пересекается, max1500 действует на обоих.
  Высота перераспределяется через flex и минимум ленты 160 px.
- Новый baseline использует `campaign-fixture`: отдельная синтетическая
  кампания в настоящем локальном Postgres, production HTTP/transport,
  40 записей через `/api/chat`. Route mocks, DOM/style growth, подмена
  ResizeObserver/hook state и копирование production-данных отсутствуют.
- Layout отличается от production намеренно: обычной кнопкой сворачиваются
  быстрые броски, чтобы более насыщенный seed оставил ленте место для
  уменьшения. Проверяется реальный delta clientHeight >48 px, начальный
  overflow >400 px и старт у дна. Без stress precondition тест не может PASS.
- После resize измеряется устойчивая геометрия, а не только первый кадр.
  Soft assertions сохраняют первый FAIL и позволяют записать настоящий
  Enter → успешный PATCH → подтверждение bootstrap → новый roll без
  действий по журналу, которые могли бы незаметно восстановить follow.
  Затем проверяются кнопка возврата, ручное чтение истории колесом как
  negative control и восстановление follow после явного возврата.
- Артефакты каждого браузера: screenshots ключевых фаз и JSON с viewport,
  scroll/client dimensions, sidebar/quick-roll geometry, focus, индикатором
  новых событий, scroll/resize/observer/wheel events и HTTP receipt status.
  Phase выставляется **до** действия, чтобы resize не получил чужую подпись.
- Проверки: новый тест только подготовлен; browser baseline, типизация,
  lint и общий gate ещё не выполнены. Root владеет запуском двух браузеров
  на отдельной локальной БД и дальнейшей интерпретацией результатов.
- Блокеры: сохранение gap после нового roll пока не проверено на этом
  isolated backend. Нельзя объявлять ни fix, ни Done по read-only замеру.
- Next action: root запускает неизменённый baseline в Chrome и Firefox,
  сохраняет первый результат и поздние фазы; только после воспроизведения
  отдельно согласуется минимальный production fix и связанный regression gate.

Команда после готовности локального backend:

```sh
pnpm exec playwright test tests/e2e/follow-scroll-resize-regression.spec.ts --grep "UIX-475 resize" --retries=0
```

## Сверка первого baseline и подготовка второго layout, 08.09.2026

- Первый baseline root: **2/2 PASS**, Chrome и Firefox, retries 0, около
  1,1 минуты, настоящий локальный Postgres/API/Vite. Ни hook fix, ни
  воспроизведение исходного PATCH-бага этим результатом не заявляются.
- Локальные JSON receipts первого прогона проверены: collapsed лента
  **472 → 292 px**, scrollHeight Chrome **1488 → 1488**, Firefox
  **1489 → 1489**. Chromium уже получил gap 0 при первом resize/scroll;
  Firefox сначала имел временный gap 180 на window resize, но ResizeObserver
  закрепил ленту до scroll. После PATCH и новых roll gap 0; ручное чтение
  сохраняло позицию, явный возврат восстанавливал follow.
- Production read-only JSON имеет **другую геометрию и порядок**: после
  collapse → restore expanded лента **292 → 160 px**, scrollHeight
  **4313 → 4221**, scrollTop **4021 → 3929**. Оба последних размера
  уменьшаются на 92 px: прежнее расстояние scrollHeight − scrollTop =292
  сохраняется, а уменьшение clientHeight оставляет gap132. Scroll с этим
  gap приходит раньше ResizeObserver. Причина изменения content height
  ещё не установлена; нельзя приписывать её данным или CSS без замера.
- Начальное предположение о необходимости collapsed seed для выхода из
  min-height160 не подтвердилось на текущей ревизии: первый тест фактически
  дал472px. Оно сохранено выше как история решения, не актуальный диагноз.
- Подготовлен второй layout `expanded-restored`: тот же production UI
  toggle → restore перед resize; первый collapsed baseline сохранён.
  Оба варианта обязаны реально уменьшить clientHeight >48px и проходят
  одинаковый PATCH/roll/recovery/manual-reader сценарий. В receipts добавлены
  число статей и размеры непосредственных дочерних элементов без их текста,
  чтобы отличать изменение содержимого от одного уменьшения viewport.
- Scope по-прежнему только новый test и этот checkpoint; `useFollowScroll`,
  CSS, transport и конфигурация не менялись. Второй layout **ещё не запускался**.
  Следующее действие root — только новый expanded-restored baseline; если он
  также PASS, сверить child geometry и не исправлять hook вслепую.

```sh
pnpm exec playwright test tests/e2e/follow-scroll-resize-regression.spec.ts --grep "UIX-475 resize expanded-restored" --retries=0
```

## Третий baseline: viewport-зависимые сюжетные изображения

- Подтверждённое правило source: `.story-post__media img` в `styles.css`
  использует `max-height: min(420px, 52vh)`; StoryPost входит в ActivityPanel
  непосредственно внутри `.message-list`. При 900 →720px cap одного
  высокого изображения меняется420 →374,4px; два дают91,2px, что совпадает
  с округлённым production delta92. Из сохранённого production rect также
  подтверждено: ширина списка оставалась359px. Наличие именно двух таких
  изображений в приватном DOM ещё не утверждается.
- Подготовлен отдельный `story-media` baseline: два самостоятельно созданных
  flat-colour PNG512×1536, реальный attachment upload → story draft → publish,
  затем обычный reload и естественная прокрутка для lazy loading. Изображения
  декодируются из настоящего media route, private content не копируется;
  временные PNG создаются в памяти через уже установленный server sharp.
- До проверки follow третий baseline требует: две действительно decoded
  картинки с ожидаемым natural size, высота каждой420px до resize и374,4px
  после него (допуск1px), неизменная ширина списка и уменьшение его общего
  scrollHeight на91,2px (допуск2px). Нарушение этих условий — ошибка stress
  fixture, а не PASS регрессии. Затем идут прежние PATCH/roll/recovery и
  manual-reader проверки; soft follow assertions сохраняют последующие фазы.
- Первые два layout и их oracle сохранены. Hook, CSS и configuration не
  менялись. Третий baseline только подготовлен; root владеет runtime gate.

```sh
pnpm exec playwright test tests/e2e/follow-scroll-resize-regression.spec.ts --grep "UIX-475 resize story-media" --retries=0
```

## Четвёртый baseline: история после media, минимальный observer

- Второй и третий baseline root завершены: **4/4 PASS**, Chrome/Firefox,
  retries0. Третий действительно уменьшил scrollHeight2598 →2507 в Chrome
  и2599 →2507 в Firefox; media precondition прошёл. Это подтверждает
  viewport-зависимый размер изображений, но **не воспроизводит потерю follow**.
- Отличия сохранённых receipts: локальные изображения стояли в хвосте,
  ниже20 message articles. При resize scrollTop не уменьшился, а content
  −91/−92 почти компенсировал clientHeight256 →160; до RO остался gap5/4,
  меньше threshold48. RO закрепил ленту раньше scroll. Production40 articles
  и синхронное уменьшение scrollTop на92 совместимы с anchoring к истории
  после изображений, но их фактический порядок из старого JSON не доказан.
- Подготовлен отдельный `history-after-media`: сначала два synthetic story
  posts, затем20 TABLE сообщений и20 настоящих `/api/dice` в ROLLS.
  Bootstrap ограничен20 на thread, поэтому после reload строго проверяются
  40 articles, оба потока по20, порядок story перед всеми сообщениями и обе
  decoded картинки целиком выше видимого viewport журнала.
- Через существующий pointer resize handle высота quick-roll панели до
  baseline задаётся204px; после collapse/restore требуются204±1px панели,
  292±1px ленты, а после resize160±1px. Это synthetic calibration обычным UI,
  не копия приватной настройки и не CSS/localStorage injection.
- Только четвёртый вариант использует минимальный observer как production r2:
  passive list scroll + ResizeObserver, scalar metrics. Нет window resize,
  visualViewport или MutationObserver callbacks с descendant/style reads.
  Полные размеры снимаются в checkpoints, а не внутри native event callbacks.
- После resize оставлено1000ms без немедленного geometry read — тот же
  intentional event-order observation window, что в production script.
  Это не «исправление задержкой»: follow oracle по-прежнему требует gap≤4,
  а перед ним отдельно проверяется реальное уменьшение media/content.
  Первый FAIL сохраняется до поздних PATCH/roll/recovery/manual-reader фаз.
- Первые три режима и их oracle сохранены. Четвёртый только подготовлен,
  hook/CSS/configuration не менялись; root владеет runtime gate. Пока это
  проверка сильной гипотезы о порядке media/anchoring и observer effect,
  а не установленная причина production failure и не готовый fix.

```sh
pnpm exec playwright test tests/e2e/follow-scroll-resize-regression.spec.ts --grep "UIX-475 resize history-after-media" --retries=0
```

## Измеренный FAIL и минимальный hook fix

- Четвёртый baseline root: **2/2 FAIL** на ожидаемых follow assertions,
  не на timeout/preconditions. Chrome после resize: gap96, после настоящего
  PATCH154/новый счётчик1, после roll271/счётчик2. Firefox: gap132,2 →189,9
  →305,9 с теми же счётчиками. Recovery button и исходный manual-reader
  control прошли в обоих браузерах. Это отдельный результат; прежние шесть
  успешных browser cases не переписаны как FAIL или доказательство fix.
- В обоих receipts native scroll с новой геометрией предшествовал
  ResizeObserver. Измеренная цепочка: media выше видимой истории меняет
  размеры → browser anchoring двигает scrollTop → старый onScroll выключает
  follow → observer и последующий roll уже не возвращают к концу.
- Выбран не heuristic geometry guard: совпадение координат само по себе
  не различает anchoring и намеренный message jump в тот же layout turn.
  В `useFollowScroll` добавлен только `useLayoutEffect`, который временно
  задаёт `overflow-anchor: none` **пока isAtBottom=true**. Follow-позицией
  уже управляет существующий ResizeObserver; конкурирующий browser anchor
  ему тогда не нужен. При чтении/cleanup восстанавливаются точные исходные
  inline value и priority, включая `!important`; перед paint нет окна с
  неверным стилем. onScroll, thresholds, reset и hidden/reopen не изменены.
- DOM hook tests проверяют style ownership/cleanup через reader→reset→reader
  →follow→unmount, отсутствие исходного значения и `auto`/`none !important`.
  Отдельно сохраняется явный programmatic scroll при изменении размеров и
  subsequent reader resize. Это lifecycle/контрактные проверки jsdom, не
  доказательство native scroll anchoring.
- Все четыре исходных E2E режима/стресс-oracle сохранены. Только после
  исходного четвёртого flow добавлен реальный negative control: ручной уход
  далеко в историю → resize720→900 и рост двух старых картинок → сохранение
  видимой исторической статьи и browser anchoring → новый real roll не
  тащит вниз → явная кнопка возврата. Тест не инжектирует CSS.
- Scope fix: `apps/web/src/ui/useFollowScroll.ts`, существующий
  `apps/web/src/ui/useFollowScroll.dom.test.tsx`, наш E2E и этот checkpoint.
  Другие consumers, CSS, API, resource behavior не менялись. Исправление
  подготовлено, но **ещё не validated**: root запускает связный browser/hook
  pool, включая прежние fixed-viewport resource и hidden/reopen сценарии.

```sh
pnpm exec vitest run apps/web/src/ui/useFollowScroll.test.ts apps/web/src/ui/useFollowScroll.dom.test.tsx --maxWorkers=1
pnpm exec playwright test tests/e2e/follow-scroll-resize-regression.spec.ts tests/e2e/follow-scroll.spec.ts --retries=0
```

## Checkpoint — 2026-09-08: локальный Validate завершён

- **Решение / ревизия:** fix поверх `d68f8ed`; только hook-owned anchoring
  во время follow, без принудительного сброса при изменении ресурса.
- **Изменено:** `useFollowScroll.ts`, его DOM tests, новый
  `follow-scroll-resize-regression.spec.ts` и этот план.
- **Проверка:** hook pool **11/11 PASS**; связный browser pool **24/24 PASS**
  в Chrome/Firefox, retries=0 (8 новых и 16 прежних сценариев, включая GM/PLAYER).
  В воспроизведённом media/history сценарии gap после resize, настоящего
  resource PATCH и следующего броска равен **0** в обоих браузерах. Ручной
  reader остаётся в истории, при росте старых изображений сохраняет видимую
  статью; явная кнопка возвращает follow. Ошибок страницы нет.
- **Диверсия:** в production hook временно заменено только `none` на `auto`.
  Те же два browser cases дали **2 целевых FAIL**: gap96/132,2 после resize,
  затем154/189,9 после PATCH и271/305,9 после roll. Исходник восстановлен
  побайтно; SHA-256 теста не менялся. Restored повтор — **2/2 PASS**.
- **Quality:** build, format:check, lint и typecheck PASS; lint — 0 errors,
  5 ранее существовавших warnings. Это локальный реальный PostgreSQL/API gate,
  а не Docker multiplayer, Safari или physical-device acceptance.
- **Блокер / дальше:** исправление ещё не опубликовано. Интегрировать в общий
  release candidate, выполнить общий gate/CI и только затем разрешённый выпуск.
  Приватные production captures, журналы и данные кампаний в репозиторий
  не включаются. До выпуска UIX-475 нельзя считать исправленной на проде.
