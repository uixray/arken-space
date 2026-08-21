# UIX-408 / UIX-409 / UIX-450 — checkpoint 2026-08-21

## Scope

Связанный privacy/performance-пул снапшотов и истории чата. Linear остаётся
источником acceptance/status, Git — фактической реализации. Production, push и
работа с боевыми данными в этот пул не входили.

## Revisions

- Base перед пулом: `7e441a4` (`test(toolbar): verify map tool glyphs`).
- UIX-408: `a1070bd4d0bf2e1eaa31412e5c0cee0c24b270c8`.
- UIX-450: `34b3e35664fdb7f99032f2e83b5775f47c0b0681`.
- UIX-409: `fcdaced98e09bbf504b7310bb5f04f2b04a3207c`.

## Decisions

### UIX-408

- `scene:view` — строгий GM-only UUID/null intent, назначенный в wire-order до
  асинхронной проверки сессии.
- Просматриваемая мастером неактивная сцена живёт только на socket и включается
  в initial/resync snapshot без изменения broadcast-сцены кампании.
- Более старый intent не может перезаписать новый; ошибки lookup/snapshot
  ловятся без unhandled rejection и без oracle существования чужой сцены.
- Reconnect восстанавливает текущий canvas один раз на transport; failed setup
  закрывается fail-closed и не ломает presence lifecycle.

### UIX-450

- Полная видимость сообщения применяется в SQL **до** `limit`, latest и unread:
  PUBLIC/GM_ONLY + frozen sticker viewers + canonical player-request ACL.
- Snapshot хранит последние 20 видимых сообщений на поток; более ранняя
  история загружается пагинацией.
- DIRECT получил тот же history loader, но сам Direct UI остаётся скрыт до
  UIX-365.
- Прокрутка вверх загружает страницу автоматически; кнопка остаётся keyboard и
  short-list fallback.
- Поздний ответ старого пользователя/thread не может попасть в global snapshot.
  `accepted + messageIds` подтверждается только следующим committed authority,
  поэтому deferred React updater не создаёт ложный success.

### UIX-409

- Broadcast с пустой комнатой не строит общий read set.
- Общие чтения выполняются один раз, персональные проекции — параллельно.
- Runtime query counter монотонный и честно помечен как
  `PROCESS_WINDOW_ESTIMATE`; он не выдаётся за scoped trace.
- Авторитетный замер разрешён только отдельным процессом через loopback к
  изолированной копии, с явными campaign/viewed-scene UUID и ровно 1 GM + 6
  PLAYER. Скрипт не выбирает произвольную кампанию и не печатает игровые данные.

## Changed files

- UIX-408: `packages/contracts/src/index.ts`,
  `apps/server/src/realtime.ts`, `apps/web/src/App.tsx`,
  `tests/realtime.test.ts`, `tests/visibility.test.ts`.
- UIX-450: `apps/server/src/chat-history.ts`,
  `apps/server/src/snapshot.ts`, точечные hunks `apps/server/src/routes.ts`,
  `apps/web/src/use-chat-history-actions.ts`,
  `apps/web/src/use-thread-history.ts`, `apps/web/src/sidebar/ChatPanels.tsx`
  и focused DOM/route tests.
- UIX-409: `apps/server/src/routes.ts`,
  `apps/server/src/snapshot-metrics.ts`, `.test.ts`,
  `scripts/measure-broadcast.ts`.

## Verification

- UIX-408 focused realtime + visibility: **2 files / 64 tests PASS**.
- UIX-450 focused route/action/hook/panels: **5 files / 29 tests PASS**.
- UIX-409 metrics: **1 file / 7 tests PASS**.
- `@arken/contracts`, `@arken/server`, `@arken/web` applicable typechecks: PASS.
- Contracts build: PASS outside sandbox after expected Windows `EPERM`.
- Measurement script standalone TypeScript check via temporary project: PASS.
- Measurement fail-closed smoke without `DATABASE_URL`: PASS.
- Scoped Prettier/ESLint from implementation workers and final
  `git diff --check`: PASS.

## Open gates / blockers

- Full Vitest, production build and targeted Chromium/Firefox QA have not been
  rerun for this final three-commit pool.
- Realtime/privacy changes require isolated Docker multiplayer before closure.
- UIX-408/409/450 acceptance requires before/after numbers on the same isolated
  restored production dump. No dump was opened and no values were invented.
- DB-time share is not measurable through the current pre-query `postgres`
  debug callback; record it as N/A unless proper duration instrumentation is
  introduced.
- No production deploy, push, backup/restore operation or human GM + 6 rehearsal
  was performed.

## Excluded working-tree material

- `apps/web/src/assets/game-pause-rest.webp` — provenance/task ownership unknown.
- `docs/stickers/` — private creative drafts.

These paths were neither inspected for publication nor staged.

## Next action

1. Run the broad local code gate on the committed revisions.
2. Start Docker and run the isolated multiplayer/reconnect/privacy gate.
3. Run targeted browser QA for GM viewed-scene switching and scroll-up history.
4. Restore the documented dump only in an isolated loopback environment and
   record comparable before/after UIX-408/409/450 measurements in Linear.
5. Only after all acceptance evidence, move the three issues to review/done.
