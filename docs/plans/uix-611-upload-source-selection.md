# UIX-611 — новый upload как выбранный исходник генератора

## Scope и baseline first

- Существующая UIX-611 остаётся Review; новые задачи/Backlog не создаются.
- Ветка `codex/uix-611-upload-source`, база `4826474`, отдельный worktree.
- Первый baseline подготовлен только в новом
  `apps/web/src/sidebar/TokenDefinitionEditor.upload-source.test.tsx` и этом
  checkpoint. После сохранённого root FAIL разрешён минимальный source fix
  в TokenPalette и TokenImageGenerator; shared UIX-589 docs и другие
  worktrees не меняются.
- Известный source-кандидат: parent сохраняет uploadedSource и передаёт
  mergeAssets с новым IMAGE в начале списка; effect TokenImageGenerator
  сохраняет прежний sourceAssetId, пока этот старый asset остаётся доступен.
  Изменение порядка списка само по себе не выражает upload-selection intent.

## Один связанный сценарий

1. Настоящие TokenDefinitionEditor + TokenImageGenerator; прежний landscape A
   выбирается реальным select. Изменяются zoom, crop стрелками и frame.
2. Реальный ImageUploadField получает File; useAssetActions отправляет IMAGE
   upload. Ответ HTTP контролируется deferred boundary, selection A остаётся
   прежним до подтверждения upload; create/place не вызываются.
3. После успешного ответа actual useAssetActions сначала выполняет bootstrap
   reload. Настоящий parent получает новую snapshot и uploadedSource B.
   B обязан присутствовать в options — это отдельная fixture precondition.
4. Первый ожидаемый FAIL на неизменённом source: select должен выбрать B,
   а не сохранить A. Далее oracle требует default crop/zoom/frame, сохранность
   имени формы и отсутствие IMAGE в готовых token tiles.
5. После fix та же проверка продолжится: actual generator отправляет
   `/api/assets/source-b/token` с default transform и именем B, выбирается
   ответ TOKEN, save передаёт только его id. Это не отдельный обход baseline.
6. После генерации пользователь намеренно возвращается к A и снова меняет
   crop, zoom и frame. Fixture-owned кнопка запускает тот же настоящий load;
   bootstrap возвращает переставленный список с посторонним новым IMAGE.
   Появление его option подтверждает применение snapshot. Выбор A и его
   transform обязаны сохраниться; выбранный готовый TOKEN тоже не меняется.

## Минимальное исправление

- Editor передаёт optional `uploadedSourceId` только из успешно завершившегося
  актуального upload. Существующая promise identity guard остаётся неизменной.
- Generator потребляет этот intent один раз, когда IMAGE доступен: выбирает
  uploaded id и сбрасывает весь transform, включая frame. Начало нового upload
  не сбрасывает текущий выбор/crop; очищение intent разрешает следующее событие.
- Ref отмечает потреблённый id. Последующие ручные переключения и обновления
  массива assets не должны повторно принуждать выбор uploaded IMAGE.
  Без intent прежнее правило сохраняется: доступный выбранный asset остаётся,
  fallback к первому нужен только при отсутствии прежнего источника.
- API, DTO, IMAGE/TOKEN фильтры и save payload не меняются. UIX-613 lifetime
  guard находится в отдельном worktree; root объединяет независимые изменения
  TokenPalette выборочно, а не заменяет файл версией этой ветки.

## Границы доказательства

- Generator, source select/state, preview transform, AssetPicker,
  ImageUploadField и useAssetActions не мокируются.
- Toolkit buttons/dialog shell и unrelated FormInput/FormSelect заменены
  native controls: overlay/layout/focus-trap здесь не проверяются.
- Fetch — строгий локальный boundary только для upload, bootstrap и generation;
  другие запросы отвергаются. Внешний HTTP, БД и production не используются.
- File bytes намеренно opaque: authoritative IMAGE dimensions приходят из
  controlled DTO. Это не PNG decode, server crop или настоящий render WebP;
  такие доказательства не приписываются jsdom. Blob preview URL контролируется.
- onCreate/onCreateAndPlace — spies; проверяется UI submission payload, не
  серверное создание definition/placement. Границы UIX-613 lifetime/rollback
  не дублируются и не изменяются при последующей интеграции.
- Валидная прежняя Sep7 production-diversion UIX-611 остаётся отдельным
  существующим доказательством и повторно не выполняется.

## Checkpoint

- Решение: consume-once upload intent, не постоянный controlled source и не
  автоматический выбор первого asset при каждом bootstrap.
- Ревизия: база `4826474`, согласованный working-tree fix без commit.
- Файлы: TokenPalette.tsx, TokenImageGenerator.tsx, новый targeted test и этот
  отдельный UIX-611 plan.
- Проверки root: offline frozen install и contracts/system/db build PASS;
  baseline — один intended FAIL на выборе `source-a` вместо `source-b`,
  до production fix. Исходный selection/reset oracle сохранён без ослабления.
  После fix: форматирование четырёх owned файлов и `git diff --check` PASS;
  независимый read-only review consume-once effect и reload oracle без замечаний.
  Restored test, type/lint и browser после fix ещё не выполнялись.
- Блокеры: требуется root restored gate; source freeze не означает acceptance
  всех UIX-611 AC. Другие worktrees и работающий gate UIX-613 не затронуты.
- Next action: root запускает команду ниже на исправленном source, затем
  связанный portrait/landscape,
  cancel, upload/generation failure+retry и ready TOKEN acceptance pool.
  Все перечисленные оставшиеся AC этим одним baseline не объявляются PASS.

```sh
pnpm exec vitest run apps/web/src/sidebar/TokenDefinitionEditor.upload-source.test.tsx --maxWorkers=1 --reporter=verbose
```

## Browser scope — подготовлено после restored unit gate

- Root сообщил 16 unit PASS на связанном UIX-611 пуле; две TS2532 в новом unit
  были исправлены root через request narrowing. Browser-подготовка не меняет
  этот unit, production source или других владельцев.
- Новый `tests/e2e/token-upload-source-selection.spec.ts`: один связанный
  сценарий настоящего App → Palette → Editor → ImageUploadField → Generator →
  actions, 1280×900 в Chrome/Firefox. Никаких component/callback mocks.
- Пустой список исходников → настоящий PNG upload A (60×40 landscape) →
  изменённые crop/zoom/бронза → удержанный upload B (40×60 portrait). До ответа
  остаётся A; успешный IMAGE DTO и actual bootstrap должны выбрать B и default
  transform. Oracle B-selected отдельно от B-present сохранён для baseline
  или production-diversion проверки.
- PNG создаются из стандартных chunks без новой зависимости; upload multipart
  содержит ровно те же bytes, которые отдаёт content endpoint. Browser обязан
  подтвердить naturalWidth/naturalHeight, а не принять фиктивный portrait DTO
  поверх 1×1 изображения. Generation boundary возвращает синтетический TOKEN
  PNG 64×64: это не доказательство реального server crop или WebP encoding.
- После генерации из B намеренный ручной выбор A и его transform переживают
  authentic `game:snapshot` по настоящему socket.io client. Список переставлен
  и содержит посторонний IMAGE; новый option и сохранённый mounted editor
  подтверждают применение refresh без reset. Это **live snapshot propagation**,
  а не повторный HTTP bootstrap: его отдельно доказывает unit.
- Save идёт через настоящий action в POST `/api/token-definitions`; только id
  готового TOKEN попадает в payload, после bootstrap видна новая карточка с его
  декодированным preview. Размещений `/api/tokens` нет. Wire action IDs,
  generation payload, два IMAGE uploads и ровно одно сохранение проверяются.
- Все HTTP/socket границы изолированы; посторонние события/запросы падают.
  Автоматические read marker/client logs отвечаются локально и перечисляются
  отдельно. PNG и компактный receipt остаются private test artifacts.
- Проверка этого browser-среза: только подготовка и форматирование; тесты,
  browser/server/install не запускались. Root владеет baseline/restored run.
  Safari/device, upload/generation failure+retry и cancel этим сценарием не
  объявляются закрытыми.

```sh
pnpm exec playwright test tests/e2e/token-upload-source-selection.spec.ts --workers=1 --retries=0 --project=chromium --project=firefox
```

## Root checkpoint — local source candidate, 2026-09-08

- Fixed candidate retains the original failing B-selection oracle; real-chain
  connected suite5files/16tests PASS. Explicit request narrowing fixed only
  TypeScript noUncheckedIndexedAccess in the new test; no assertion removed.
- Actual source diversion: omit the uploadedSourceId prop -> one intended FAIL,
  source A remains selected instead of uploaded B. Source bytes restored and
  test hash unchanged; connected16tests PASS again after restore.
- Web typecheck and scoped lint PASS (no errors or warnings). No API/DTO/ACL,
  derivative format or persistence changes. Source review found no blocker.
- New real-App browser scenario is prepared and independently reviewed without
  findings, but NOTRUN yet. It must pass on the integrated candidate before
  release; this commit does not claim its two browser cases already passed.
- Next: combine upload prop with UIX-613 lifetime guard without replacing the
  shared TokenPalette file; run real-App browser and common quality/release gate.
  Candidate is local only; no public PR or production deployment in this pool.
