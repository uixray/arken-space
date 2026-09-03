# UIX-494 — checkpoint реализации — 2026-08-29

## Решения

- Серия кнопок кошелька копится `600 мс` и отправляется одной относительной
  картой дельт; optimistic-значение видно сразу.
- Дельта строится по всем номиналам и повторно применяется к актуальной голове
  очереди после конфликта. Ручной ввод остаётся абсолютным `SET`.
- Отмена серии до нулевой дельты не отправляет запрос; закрытие панели сбрасывает
  принятую ненулевую серию в стабильную очередь `App`.
- Production-маршрут сервера не менялся: интеграционный тест подтвердил, что
  один итоговый wallet-only `PATCH` уже создаёт одну `WALLET_AUDIT`-строку с
  `operationCount: 1` и один `character.counters` event.

## Ревизия и файлы

- Baseline: `0154972d42db13fefecf98bee0a06792453365f9`.
- Ветка: `codex/uix-494-wallet-aggregation`.
- Изменены:
  - `apps/web/src/wallet.ts` и `wallet.test.ts`;
  - `apps/web/src/character-counter-mutation.ts` и его test;
  - `apps/web/src/sidebar/CharacterWorkspace.tsx`;
  - `tests/e2e/concept.spec.ts`;
  - `tests/pool-b-http.test.ts`;
  - `docs/plans/uix-494-wallet-aggregation.md` и этот checkpoint.
- Не затронуты `styles.css`, `App.tsx`, `ChatPanels.tsx` и production-код
  серверных маршрутов.

## Проверка текущего пула

- Unit: `wallet.test.ts` + `character-counter-mutation.test.ts` — 14 passed.
- Server integration: два узких сценария журнала — 2 passed; отдельный новый
  wallet-only сценарий после возврата диверсии — 1 passed.
- Browser Chromium: batching/optimistic/manual queue/zero-net/rollback — passed;
  существующий stale conflict/rebase — passed.
- Диверсия browser: временный `setTimeout(flush, 0)` дал целевое падение на
  границе до паузы (`[]` ожидалось, `[1]` получено); задержка возвращена.
- Диверсия server: временный `operationCount: 2` дал целевое падение нового
  теста (`1` ожидалось, `2` получено); route возвращён без diff.
- Полный основной gate: `format:check`, `lint`, `typecheck`, `build`, `test` —
  passed; Vitest: 182 файла, 1355 тестов. Первый повторный `build` поймал
  временный Windows `EPERM` на очистке `dist`, следующий неизменённый запуск
  прошёл.
- Полный локальный `test:e2e` пока не является зелёным доказательством: машине
  нужен живой API и одноразовый PostgreSQL, а Docker daemon не запустился.
  Прогон был остановлен после 22 быстрых environment-падений на недоступном
  `/api/bootstrap`; код Playwright не маскировался. Полный Chromium + Firefox
  gate должен пройти в изолированном GitHub Actions окружении PR.

## Блокеры и следующее действие

- Блокеров реализации нет; локальный полный E2E ограничен окружением.
- Следующее действие: commit, PR и все три GitHub workflow. PR нельзя передавать
  на merge, пока `checks`, `e2e` и `multiplayer` не зелёные.
