# Текущее состояние Arken Space

Этот файл — короткий проверяемый снимок реализации и незакрытых gate. Он не
дублирует backlog: **Linear — единственный источник статусов, приоритетов и
acceptance criteria**, Git — источник фактической реализации, а датированные
checkpoint-файлы в `docs/` объясняют историю решений.

Последняя проверка: **21 августа 2026 года** (вечерний пул UIX-517 / UIX-518).

## Идентичность ревизий

- Локальная ветка: `main`.
- Проверенный remote baseline `origin/main`:
  `42c7ccc61863f6728977d2381b9f8997f059e95c`.
- Поверх baseline локально зафиксированы непушенные технические,
  verification- и documentation-пулы. Точный tip и ahead-count нужно брать из
  `git rev-parse HEAD` и `git status`, а не из самоссылочного docs-файла.
- Production `/healthz` 20.08.2026 вернул `buildVersion: 0.3.2`,
  `buildRevision: 42c7ccc61863f6728977d2381b9f8997f059e95c`, `database: ok`.
- В production в рамках текущего пула ничего не развёртывалось.

## Что зафиксировано в Git

Arken Space — приватный web-first VTT для мастера и группы игроков. В `main`
зафиксированы авторизация кампании, PostgreSQL и миграции, realtime-сцены,
токены и туман произвольной формы, рисунки и линейка, персонажи и правила,
чат/активность/сюжет, броски, ресурсы и инвентарь, музыка, карты мира, заявки
игроков, стикеры и операторская обратная связь.

За точными инвариантами и границами следует обращаться к
[architecture.md](./architecture.md), а не к старым feature-checkpoint.

## Локально зафиксированный пул

Связанные изменения после передачи из Claude разбиты на отдельные
implementation, test, runner и documentation commits. Локальная фиксация не
заменяет Linear acceptance и production release gate:

- **UIX-491** — сохранить актуальные метаданные и изображение токена после
  socket-перемещения, не раскрывая через realtime закрытые туманом токены;
- **UIX-408** — GM viewed-scene lifecycle: wire-order intents, reconnect/resync,
  fail-closed setup и fog/drawings только нужного canvas;
- **UIX-450** — авторизованная пагинация истории до SQL limit/latest/unread,
  DIRECT loader и committed-authority guard клиента;
- **UIX-409** — честный process-window runtime counter и fail-closed isolated
  measurement script без доступа к production;
- **UIX-462 / UIX-463** — внутриигровая шпаргалка и единый manifest клавиш для
  resolver, подсказок и руководства;
- **UIX-470 / UIX-475 follow-up** — палитра рисования размещается относительно
  фактической ширины сворачиваемой панели инструментов;
- **UIX-498** — привести E2E к текущей семантике Activity/Story и клавиатурной
  навигации;
- **UIX-274 follow-up** — read cursor единой Activity учитывает TABLE, STORY и
  ROLLS, но не помечает прочитанными категории, скрытые текущими фильтрами;
- layered Escape для object list: первый `Esc` закрывает список и сохраняет
  selection, следующий очищает состояние карты;
- ремонт typed E2E-фикстур и селекторов после изменений навигации;
- Docker E2E hygiene: версия Playwright синхронизирована с package lock, а
  локальные worktree/workspace/sticker-материалы исключены из build context.
- **UIX-467** — фильтр расположен у заголовка журнала, раскрытие истории вынесено
  в отдельную доступную строку над лентой, дублирующая «Заявка мастеру» удалена,
  а «Мои заявки» сохранены в общей навигации;
- **UIX-492** — личная громкость отделена от playback lifecycle, gain
  применяется до первого `play()`, а slider не перезапускает и не перематывает
  общий трек.
- **UIX-399 / UIX-426** — существующая реализация частичной видимости и порядка
  fog/token layers получила недостающий browser acceptance: открытая половина
  чужого токена видна, закрытая перекрыта туманом, контролируемый токен остаётся
  видимым, GM-вид не сужается.
- **UIX-468** — resource counters используют семантические `DELTA`/`SET`,
  сериализацию по персонажу и rebase от актуальной головы очереди; быстрые
  клики не теряются при закрытии панели, не переносятся между персонажами и не
  перезаписывают параллельное изменение другого ресурса.

Три untracked-файла `docs/stickers/prompts/ST-*.md` относятся к отдельной
творческой работе. Они не входят в этот пул и не должны попадать в технические
коммиты без отдельной privacy/provenance-проверки.

Untracked `apps/web/src/assets/game-pause-rest.webp` также исключён: его
provenance, task mapping и ownership пока не подтверждены.

## Проверка связанного пула

Для технической серии до UIX-467/UIX-492 было подтверждено:

- `pnpm typecheck` — PASS, включая `tests/e2e/tsconfig.json`;
- `pnpm lint` — PASS с тремя существующими warnings, без errors;
- production build — PASS; остаётся предупреждение о крупном web chunk;
- полный Vitest — **167 files / 1193 tests PASS**;
- полный browser gate: Chromium — **75 passed / 10 skipped / 0 failed**,
  Firefox — **75 passed / 10 skipped / 0 failed**;
- post-fix targeted Chromium + Firefox для UIX-462, UIX-274, layered Escape и
  sticker contract — **8/8 PASS**;
- изолированный Docker multiplayer (GM + 6, restart/reconnect/privacy) —
  **2/2 PASS**; `playwrightExitCode: 0`, `cleanupExitCode: 0`, containers/volumes
  leftovers отсутствуют;
- технический scoped Prettier и `git diff --check` — PASS.

Для UIX-467/UIX-492 на финальном содержимом отдельно подтверждено:

- focused Vitest — **4 files / 30 tests PASS**;
- full Vitest — **167 files / 1201 tests PASS**;
- targeted fixture QA Chromium — **3/3 PASS**;
- targeted fixture QA Firefox — **3/3 PASS**;
- `pnpm typecheck`, `pnpm lint`, production build, scoped Prettier и
  `git diff --check` — PASS.

Для closure UIX-399/UIX-426 отдельно подтверждено:

- focused fog/visibility Vitest — **2 files / 23 tests PASS**;
- targeted Canvas QA Chromium + Firefox — **2/2 PASS**, без retries;
- E2E TypeScript, scoped ESLint, scoped Prettier и `git diff --check` — PASS.

Для closure UIX-468 отдельно подтверждено:

- focused final Vitest — **2 files / 34 tests PASS**;
- full Vitest — **168 files / 1222 tests PASS**;
- targeted resource-counter QA Chromium + Firefox — **2/2 PASS**, без retries;
- `pnpm typecheck`, `pnpm lint`, production build, scoped Prettier и
  `git diff --check` — PASS.

Для локальной реализации UIX-408/UIX-409/UIX-450 отдельно подтверждено:

- realtime + visibility — **2 files / 64 tests PASS**;
- authorized chat history — **5 files / 29 tests PASS**;
- snapshot metrics — **1 file / 7 tests PASS**;
- applicable contracts/server/web typechecks и contracts build — PASS;
- standalone TypeScript check и fail-closed smoke measurement script — PASS;
- точный scope и незакрытые gates зафиксированы в
  [uix-408-uix-409-uix-450-checkpoint-2026-08-21.md](./uix-408-uix-409-uix-450-checkpoint-2026-08-21.md).

### Broad gates на тройке UIX-408/409/450 — выполнены 21.08.2026

Focused gates выше дополнены полным прогоном на итоговом содержимом:

- полный Vitest — **171 файл / 1251 тест PASS**;
- `pnpm typecheck`, `pnpm lint` (0 errors, 3 прежних warning) и production
  build — PASS;
- изолированный Docker multiplayer (GM + 6) — **2 passed**, включая шаги
  `backend-restart-marker` и `backend-restart`; `playwrightExitCode: 0`,
  `cleanupExitCode: 0`, без leftovers, оба `production-health` шага `skipped`;
- целевой browser QA Chromium + Firefox — **22 passed**, включая
  `story-channel.spec.ts:372` (пагинация истории UIX-450).

Multiplayer gate до этого был красным **не из-за тройки**: он падал так же на
`7e441a4`, базе перед пулом. Причина — UIX-517, разобран в
[uix-517-uix-518-checkpoint-2026-08-21.md](./uix-517-uix-518-checkpoint-2026-08-21.md).

UIX-408/409/450 остаются In Progress: не выполнено before/after measurement на
одной изолированной копии дампа. Копии `arken-20260815T065736Z` локально нет,
скрипт не запускался, значения не выдумывались.

### Live-token gate снят

Локальный том `arken-space_postgres-data` был от 24.07.2026 и пересоздан с
согласия владельца. На свежей базе seed применил GM-токен из `.env`, и восемь
ранее скипавшихся тестов начали реально выполняться. В частности,
`tests/e2e/activity-feed-layout.spec.ts` больше не environment gate — он
**проходит** в Chromium и Firefox.

Остаются два skip — явные `fixme` для UIX-422 (compact session shell) и UIX-365
(Direct UI redesign).

Два теста устарели незамеченными, пока скипались, и починены в `8493d10`:
`game-night.spec.ts` держал неоднозначный `getByText("Подготовка")`, ставший
недоступным после UIX-472.

### Полный browser gate нестабилен

Два полных прогона подряд на неизменном дереве дали **разные** наборы падений,
а все упавшие проходят изолированно. Причина — общая кампания и общая база на
все e2e; вынесено в UIX-518. Целевые прогоны по затронутым областям остаются
достоверными, полный прогон — пока нет.

Глобальный `pnpm format:check` красный только на трёх исключённых untracked
`docs/stickers/prompts/ST-*.md`; эти приватные творческие файлы не
редактировались и в репозиторий не попадают, поэтому CI-шаг `format:check`
на них не падает. Два tracked-файла из `a1070bd` (`apps/server/src/realtime.ts`,
`tests/realtime.test.ts`) форматирование нарушали и исправлены в `8a55844`. Человеческий recurring-session rehearsal GM + 6 и production
release gate остаются открытыми.

## Известные границы

- Direct messages намеренно не имеют текущей UI-точки входа до редизайна
  **UIX-365**; privacy/API-контракты нельзя ослаблять ради старого E2E.
- Следующий этап декомпозиции `App.tsx` не начинается без повторных измерений;
  выполненные этапы и критерии описаны в
  [app-tsx-decomposition-plan.md](./app-tsx-decomposition-plan.md).
- Полный recurring-session acceptance остаётся отдельным release gate. Нельзя
  выводить готовность production только из unit/typecheck/build.

## Где смотреть дальше

- [Linear project](https://linear.app/uixraydesign/project/arken-space-004b59486dc4)
  — текущие задачи и порядок.
- [Публичная доска](https://github.com/users/uixray/projects/1) — безопасная
  публичная проекция.
- [production-release-checklist.md](./production-release-checklist.md) —
  обязательные release gates.
- [README.md](./README.md) — карта документации и правило её свежести.
