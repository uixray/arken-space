# UIX-417 — сетевые ошибки и причины отказа музыки

## Граница пула

- Linear UIX-417 проверена: In Progress, широкий AC — нет английских слов,
  кроме имён собственных. Уже принятые подписи валют/типов/редактора не
  перерабатываются. Новый Backlog и другие задачи не входят в этот срез.
- База `f05192e`, ветка `codex/uix-417-error-copy`. Подготовлены только два
  существующих unit-файла, новый browser spec и этот checkpoint. Production
  source не меняется до сохранённого intended baseline FAIL.
- Предыдущий аудит в `uix-417-russian-ui.md` отделяет собственные UI подписи
  от авторского контента и явно оставляет runtime сетевых/медиа-ошибок открытым.

## Два реальных пути

1. Native fetch отказ `/api/bootstrap` → настоящий `api()` → App.load →
   ErrorState. Browser `route.abort` не подменяет Error/message в приложении.
   Oracle требует «Не удалось связаться с сервером. Проверьте подключение и
   повторите попытку.», затем существующий «Повторить» восстанавливает App
   через тот же API без перезагрузки страницы. Unit проверяет три браузерные
   формулировки TypeError и неизменность AbortError cancellation identity.
2. Настоящий App → MusicBar SELECT → socket.io client → изолированный
   Engine.IO/Socket.IO ACK → штатный Gravity toast. Browser требует русскую
   формулировку REVISION_CONFLICT, но сохраняет исходные status/reason,
   revision/actionId/assetId в wire receipt. Никаких product hooks или прямого
   вызова notify вместо пользовательского действия.

## Известные audio reason

Серверный `audio:set` реально выдаёт семь reason. В контракте reason — optional
string, не enum; меняется только представление, а не протокол или ACL.

| reason                           | Русское представление                           |
| -------------------------------- | ----------------------------------------------- |
| GM_REQUIRED                      | Управлять музыкой может только ведущий.         |
| INVALID_COMMAND                  | Некорректная команда управления музыкой.        |
| ASSET_NOT_FOUND                  | Аудиофайл не найден. Выберите другой трек.      |
| REVISION_CONFLICT                | Состояние музыки изменилось. Повторите команду. |
| AUDIO_NOT_SELECTED               | Трек не выбран или его длительность недоступна. |
| AUDIO_END_NOT_APPLICABLE         | Сейчас нельзя завершить воспроизведение трека.  |
| AUDIO_UPDATE_FAILED              | Не удалось обновить музыку. Повторите команду.  |
| Неизвестный/отсутствующий reason | Сервер отклонил команду                         |

Все строки проходят реальный MusicBar command/ACK handler в unit; notify там
spy. Browser доказывает видимый toast на REVISION_CONFLICT, а не все серверные
причины отказов. Latin-имя авторского файла Waterdeep.ogg сохраняется.

## Проверяемые и непроверяемые границы

- Browser matrix: 1280/390 × Chrome/Firefox, два сценария = восемь cases.
  Compact штатно скрывает музыкальные controls: audio case 390 отправляет
  SELECT через видимый desktop UI, удерживает ACK, сужает viewport и лишь затем
  доставляет отказ. Это pending-action переход, не проверка отсутствующих
  compact controls; hidden controls не принуждаются к взаимодействию.
  Русские тексты проверяются точно, есть viewport/text fit, pageerror и
  vite-error-overlay проверки; существующий React console guard не ослаблен.
  PNG сохраняются по outputPath и JSON receipt остаётся даже при baseline FAIL.
- HTTP и обе socket transport границы изолированы. Все API writes блокируются;
  известный автоматический POST /api/chat/read учитывается отдельно, остальные
  неожиданные writes/reads/socket events роняют тест. Ни БД, ни production
  campaign не используются. Аудиофайл не выбран, playback/декодирование не нужны.
- Unit API сохраняет действующие HTTP/correlation/telemetry тесты. Copy fix не
  должен менять server codes, статусы, запросы, idempotency или cancellation.
- Этот срез не доказывает backend ACL, реальные условия семи отказов,
  медиа-декодирование, Safari/device, весь error audit или весь AC UIX-417.

## Checkpoint

- Решение: сначала две цепочки на production source без исправления, затем
  минимальный display-copy fix только после root-подтверждения actual FAIL.
- Ревизия: `f05192e`, baseline preparation, без commit.
- Файлы: `api.test.ts`, `MusicBar.test.ts`,
  `tests/e2e/russian-error-copy.spec.ts`, этот plan.
- Проверка: tests/build/type/lint/browser не запускались. В worktree нет
  установленных зависимостей; install и runtime принадлежат root.
  Форматирование четырёх owned файлов и `git diff --check` PASS. Read-only
  review нашёл риск исчезновения toast во время screenshot: текст фиксируется
  сразу после видимости, до снимка; baseline mismatch остаётся содержательным.
- Блокер: baseline FAIL должен быть именно на raw English network message и
  raw ACK reason, не на fixture/import/навигации.
- Next action: root последовательно запускает unit baseline и два browser
  сценария. После intended FAIL разрешает минимальный source fix и restored
  связанный gate; до этого никаких claims о готовности/публикации.

```sh
pnpm exec vitest run apps/web/src/api.test.ts apps/web/src/MusicBar.test.ts --maxWorkers=1 --reporter=verbose
pnpm exec playwright test tests/e2e/russian-error-copy.spec.ts --workers=1 --retries=0
```

## Checkpoint — production display-copy после actual unit FAIL

- Root baseline на integration `f6d4699` (test-source `3e715dc`): два unit-файла,
  40 tests, 11 intended FAIL / 29 PASS. Падают три native network TypeError
  формулировки и семь известных + один неизвестный ACK reason. Cancellation,
  missing reason и прежние HTTP/correlation/control tests проходят.
- Разрешённый source fix подготовлен в `codex/uix-417-error-copy` на базе
  `3e715dc`: только `api.ts`, `MusicBar.tsx` и этот checkpoint. Tests/oracles
  не меняются. Root browser baseline на старом integration source завершён:
  восемь intended FAIL — четыре native fetch сообщения (Chrome/Firefox) и
  четыре реальных toast с REVISION_CONFLICT. Fixture-only FAIL не заявлен.
- Network boundary: catch охватывает только вызов fetch. Отменённый signal или
  AbortError пробрасывается тем же объектом; HTTP parsing/ApiError остаются вне
  catch с исходными status/code/message/correlation. Новый plain Error имеет
  русское сообщение и cause со ссылкой на оригинал, не изменяет его message и
  не придумывает HTTP status либо wire code. URL/тело запроса в UI не добавлены.
- Audio: локальный readonly Map сопоставляет только семь известных protocol
  reason с русским display text. Неизвестное/отсутствующее значение получает
  прежний нейтральный fallback; prototype-key lookup исключён. Command/ACK
  объекты, server logic/ACL, действия, имена файлов и data enums не меняются.
- Source подготовлен без запуска tests/install/server/type/lint; форматирование
  трёх файлов и `git diff --check` PASS, тестовые файлы не изменены. Следующий
  gate принадлежит root: интегрировать source, выполнить restored unit/browser
  и общий quality.
  Этот небольшой срез не закрывает автоматически весь широкий AC UIX-417.

## Checkpoint — диагностика geometry harness после общего browser gate

- Первый общий пул: 34 PASS / 2 Chrome audio geometry FAIL (1280 и 390).
  Firefox audio проходит; русские строки уже отображаются. В обоих Chrome
  traces измерение выполнено при `g-toast-animation-desktop_enter_active`.
  Gravity entrance длится 600 мс и меняет height/padding от нуля, сохраняя
  opacity 0 в первой половине. `toBeVisible` не доказывает завершённую геометрию.
- Range всего toast дополнительно включает декоративные вложенные SVG. Старый
  receipt хранил только booleans, поэтому конкретный «плохой SVG rect» из него
  не установлен; steady-state overflow этим прогоном тоже не доказан.
- Test-only исправление: текст фиксируется сразу; ожидание ограничено только
  named entrance animation самого наблюдаемого toast, без ожидания progress
  или auto-dismiss. Title/content измеряются отдельно по непустым Text nodes.
  Сохраняются проверки собственного box, внешнего toast clipping-box и viewport,
  точные русские/native-baseline строки и исходный wire contract.
- Полные координаты text rects, контейнеров, viewport и entrance timing
  сохраняются в JSON receipt; PNG делается до assertions. Production CSS,
  source, timers, timeouts/retries не меняются. Изменены только новый spec
  и этот checkpoint; повторный общий 36-case gate принадлежит root.
