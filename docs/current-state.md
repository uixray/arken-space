# Текущее состояние Arken Space

Этот файл — короткий проверяемый снимок реализации и незакрытых gate. Он не
дублирует backlog: **Linear — источник статусов, приоритетов и acceptance
criteria**, Git и GitHub — источник фактической реализации и CI, а датированные
checkpoint-файлы в `docs/` объясняют историю решений.

Последняя сверка: **5 сентября 2026 года**.

## Идентичность ревизий

- Актуальный `origin/main`: `f1a66c835b7915a68dbc3a287f0ae358efb656ae`
  (`f1a66c8`, merge PR #57).
- Основной подготовленный пул: ветка `codex/uix-621-core-gameplay`, ревизия
  `abd77c6ca564ccf279cecc448bbbefc1dcefb64f`, PR #58.
- Текущая задача — восстановить E2E PR #63 / UIX-502. Причина воспроизведена:
  дробный workspace popup z-index вычислялся как `auto`. Минимальная правка
  резервирует целочисленные слои `1998 < 1999 < 2000 < 2001`; до зелёного
  GitHub gate новый backlog-код не начинается.
- В production изменения текущего пула не развёртывались. Merge и публикация
  остаются отдельным решением владельца.

Точные tips веток и CI всегда проверяются через `git`, `gh` и Linear, а не
выводятся только из этого файла.

## Текущий release-tail

### База

- **PR #58 / UIX-621** — восстановление базового игрового контура: меню,
  токены, броски и мгновенный UI. База `main`; повторный CI после docs-only
  коммита `34ccd8a` полностью зелёный (checks 5м11с, E2E 15м08с,
  multiplayer 4м27с). Эта ветка является базой большинства следующих PR.

### Готовы по локальным и GitHub-гейтам

- **PR #59 / UIX-416** — навигация верхней панели и «Ещё»; CI зелёный. Linear
  при последней сверке всё ещё показывал `In Progress`, поэтому перед новым
  кодом нужно сверить checkpoint и перевести в `In Review`, если статус не был
  обновлён.
- **PR #60 / UIX-491** — multiplayer-регрессия непрерывности изображения
  токена при переносе; CI зелёный, Linear `In Review`. Этот PR основан
  непосредственно на `main`, а не на PR #58.
- **PR #61 / UIX-405** — WASD-перемещение выбранного токена и защита ping/ruler
  хоткеев; CI зелёный, Linear `In Review`.
- **PR #62 / UIX-507** — Shift+click, Shift+marquee, каноническая фильтрация
  доступных объектов, bulk move/delete и rollback; CI зелёный, Linear
  `In Review`.
- **PR #64 / UIX-418** (`4e59a8e`, база PR #58) и **PR #65 / UIX-470**
  (`ed853d7`, база PR #62) — все три GitHub workflow зелёные по живой сверке
  05.09.2026. Linear `In Review`; дополнительная реализация не требуется.

### Требуют завершения CI

- **PR #63 / UIX-502**, ветка `codex/uix-502-modal-popovers`, ревизия
  `3c685a0`, база PR #58:
  - `checks` и `multiplayer` зелёные;
  - `e2e` красный;
  - стабильно падает Chromium и Firefox тест
    `tests/e2e/scene-workspace-dialog.spec.ts:373` —
    `UIX-621 select portal receives pointer above token workspace`;
  - ожидание `elementFromPoint` получает `false` на строке 395;
  - новый modal-owned popup flow при этом локально прошёл 4/4 на desktop/narrow
    в Chromium и Firefox;
  - workspace regression воспроизведена локально; замер и минимальная правка
    описаны в `docs/plans/uix-502-modal-popovers.md`. Новый GitHub gate
    после push должен подтвердить итоговую ревизию;
  - переход picker → «Подготовка» доказывает cleanup/смену workspace, но не
    произвольную иерархию одновременно открытых nested modal/popups.

Ни один из PR #58–#65 агент не мержит самостоятельно.

## Первая задача следующей сессии

### UIX-502 — завершить проверку исправленного workspace popup

1. Проверить последний checkpoint `docs/plans/uix-502-modal-popovers.md`,
   `git status` и HEAD PR #63. Исходный FAIL и computed stacking уже измерены;
   не повторять широкий аудит с нуля.
2. Локальный связанный popup-пул Chromium+Firefox прошёл 8/8 без retries;
   все три диверсии (дробный popup, workspace cap, modal popup) дали ожидаемый
   FAIL, исходники восстановлены. Проверить итог полного quality/GitHub gate.
3. Не называть PR готовым до зелёных `checks`, `e2e`, `multiplayer` на
   последнем HEAD. В GitHub эти jobs не отмечены как protection-required,
   но обязательны по правилам проекта.
4. После зелёного CI зафиксировать review stage UIX-502/416 и готовый
   release-tail; затем перейти к точному ResourceCounters flow UIX-475.
5. Строгий порядок произвольных nested modal/popups пока не доказан:
   существующий token→«Подготовка» тест проверяет замену workspace и cleanup.
   Не скрывать это ограничение и не расширять архитектуру без воспроизведения.

## Очередь после восстановления release-tail

1. Дождаться и разобрать CI PR #64 и #65. Красный результат считается
   блокером соответствующего PR, зелёный не требует новой реализации.
2. Сверить Linear UIX-416 с зелёным PR #59 и корректно завершить stage gate.
3. **UIX-475** — воспроизвести автопрокрутку после реальной правки ресурсов.
   `useFollowScroll` уже использует `ResizeObserver`, а прежние синтетические
   замеры проблему не воспроизвели. Production-код нельзя менять без нового
   FAIL; сначала нужен browser diagnostic реального ResourceCounters flow.
4. **UIX-316** — мобильная и планшетная версия. Это крупная задача: сначала
   discovery, замеры и декомпозиция на подзадачи.
5. **UIX-217** — полный acceptance rehearsal GM + 6. Выполняется после
   интеграции текущего пула и не заменяется автоматическими тестами.
6. **UIX-473** — очередь операторских отчётов. Может требовать production data;
   без отдельного разрешения владельца к ним не обращаться.
7. **UIX-458** — школы магии. Перед реализацией проверить зависимость от
   активной UIX-262 и составить отдельный план.
8. Затем medium backlog: UIX-412, UIX-414, UIX-420, UIX-505, UIX-496,
   UIX-457, UIX-497, UIX-499, UIX-508, UIX-509, UIX-506, UIX-421, UIX-512 —
   только после live-сверки Linear и аудита, не реализованы ли они уже текущими
   ветками.

## Открытые gates и блокеры

- Полный recurring-session acceptance GM + 6 не проводился.
- Production release текущего пула не проводился.
- UIX-475 не воспроизводится имеющимися синтетическими сценариями; нужен точный
  пользовательский/browser flow.
- UIX-473 потенциально требует доступа к production/operator inbox.
- В Linear остаются старые задачи `In Progress`. Их нельзя продолжать или
  закрывать по одному статусу: сначала найти ветку, PR, ревизию, владельца и
  последний checkpoint.
- Сломанный battle UI удалён/скрыт в базовом пуле. Его нельзя случайно вернуть
  через UIX-505 или старые задачи; восстановление боя требует отдельного
  согласованного scope.

## Гейты

Полный gate выполняется после связанного пула или перед интеграцией:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

`build` перед `test` обязателен на чистом checkout. Для изменённого UI-потока
добавляется `pnpm test:e2e`; для realtime, доступа, сохранения канваса,
reconnect и миграций — `pnpm test:multiplayer`.

Новый тест обязан пройти диверсию: временно сломанное ожидание или поведение
должно уронить именно этот тест. Результат записывается в checkpoint, commit
body и PR.

На Windows `spawn EPERM`/`EPERM` у Vite, Playwright или Prettier считается
ошибкой среды, а не продуктовым FAIL. Повтор выполняется адресно и без
конвейера, маскирующего exit code.

## Известные границы

- Direct messages не имеют UI-точки входа до редизайна UIX-365; privacy/API
  нельзя ослаблять ради старых E2E.
- Новый этап декомпозиции `App.tsx` не начинается без повторных измерений.
- Не запускать `scripts/measure-broadcast.ts` и не обращаться к production
  данным без отдельного разрешения.
- Не трогать `apps/web/src/assets/` и `docs/stickers/`.
- Merge и deploy выполняются только после явного решения владельца.

## Где смотреть дальше

- [Linear project](https://linear.app/uixraydesign/project/arken-space-004b59486dc4)
  — актуальные задачи и порядок.
- [development-guide.md](./development-guide.md) — локальная разработка и CI.
- [testing.md](./testing.md) — уровни тестов и правила доказательств.
- [production-release-checklist.md](./production-release-checklist.md) —
  обязательные release gates.
- `docs/plans/uix-502-modal-popovers.md`,
  `docs/plans/uix-418-dangerous-actions.md`,
  `docs/plans/uix-470-map-tools.md` — checkpoints последних задач в их ветках.
