# Claude handoff — Arken Space — 2026-08-21

## Current state

- Repository: `D:\AI\personal\experiments\arken-space`.
- Branch: `main`; local commits are not pushed to `origin/main`.
- Latest implementation series:
  - `a1070bd` — UIX-408 viewed-scene lifecycle;
  - `34b3e35` — UIX-450 authorized paginated history;
  - `fcdaced` — UIX-409 safe measurement gate.
- Detailed checkpoint:
  [uix-408-uix-409-uix-450-checkpoint-2026-08-21.md](./uix-408-uix-409-uix-450-checkpoint-2026-08-21.md).
- Linear live state at handoff: UIX-408, UIX-409 and UIX-450 are Urgent / In
  Progress. They are implemented locally but not accepted because broad,
  Docker, browser and same-dump measurement gates remain.
- Tracked working tree was clean after the three implementation commits.
  Untracked `apps/web/src/assets/` and `docs/stickers/` are explicitly excluded.

## Recommended order

1. Finish acceptance for UIX-408/UIX-409/UIX-450; do not start another
   architecture pool while these privacy/performance gates are open.
2. Reconcile already implemented In Review items, prioritising UIX-467, UIX-491,
   UIX-462 and UIX-465 by current Linear priority and missing evidence.
3. Audit High / In Progress UIX-431 and UIX-407 before any continuation of
   UIX-398. UIX-407 is the measurement gate for further App decomposition.
4. Keep UIX-382 multi-track audio, UIX-245 world content and UIX-364 personal
   player pages as separate product/design tracks; do not mix them into the
   technical closure pool.

## Prompt for a new Claude chat

```markdown
Продолжи работу над Arken Space как основной implementation-агент.

Рабочая директория:
`D:\AI\personal\experiments\arken-space`

Сначала прочитай:

- `AGENTS.md`;
- `README.md`;
- `docs/current-state.md`;
- `docs/uix-408-uix-409-uix-450-checkpoint-2026-08-21.md`;
- `docs/claude-handoff-2026-08-21.md`;
- `docs/plans/uix-408-409-snapshot.md`;
- `.workspace/tech_debt.md`.

Затем заново проверь Git и Linear: состояние могло измениться. Linear —
источник задач/status/acceptance, Git — источник реализации. Не закрывай задачу
по одному commit или focused test.

Текущая локальная серия:

- `a1070bd` — UIX-408: GM viewed-scene lifecycle и fail-closed realtime;
- `34b3e35` — UIX-450: full SQL visibility до pagination/latest/unread,
  DIRECT history, scroll-up loading, committed-authority guard;
- `fcdaced` — UIX-409: monotonic process-window metrics и безопасный isolated
  measurement script.

Первый пул — только acceptance/verification этих трёх Urgent issues:

1. Проверь точный `git status`, историю и diff трёх commits.
2. Запусти полный unit/integration gate, typecheck, lint и production build.
3. Подними Docker и выполни isolated multiplayer/reconnect/privacy gate, потому
   что UIX-408 меняет realtime/visibility.
4. Проведи Chromium + Firefox QA:
   - GM открывает неактивную сцену, сразу видит её fog/drawings;
   - быстрые scene:view intents не возвращают старый canvas;
   - reconnect/resync сохраняет правильный viewed scene;
   - история TABLE/STORY/ROLLS и DIRECT подгружается вверх, не прыгает, не
     дублируется и не переносится между user/thread/snapshot;
   - unread/latest не учитывают скрытые sticker/request rows.
5. Не запускай measurement script против production. Для чисел UIX-408/409/450
   используй только loopback и изолированную восстановленную копию того же дампа,
   с `ARKEN_MEASURE_CONFIRM=isolated-copy`, явными campaign/viewed-scene UUID и
   ровно 1 GM + 6 PLAYER. Если копии нет — зафиксируй blocker, не выдумывай
   значения.
6. Обнови Linear только на stage gate: приложи revisions, точные команды,
   результаты, blockers. Done — только после всех acceptance criteria.

После этого сделай свежий Linear triage. Рекомендуемый следующий порядок:

- In Review: UIX-467, UIX-491, UIX-462, UIX-465 — проверять фактический код и
  недостающие gates, не переимплементировать вслепую;
- High / In Progress: UIX-431, затем UIX-407; UIX-398 продолжать только после
  измерений UIX-407;
- UIX-382, UIX-245, UIX-364 держать отдельными продуктными пулами.

Жёсткие ограничения:

- не push/deploy production без явного запроса и release gate;
- не трогать `apps/web/src/assets/game-pause-rest.webp` и `docs/stickers/`;
- не использовать `git add -A`;
- не сбрасывать/перезаписывать чужой dirty work;
- не открывать production dump или secrets;
- работать связанными пулами, оставляя checkpoint после каждого major pool;
- Linear обновлять только на stage gates.

В первом ответе дай:

1. текущую ветку/revision/status;
2. live Linear status UIX-408/409/450;
3. какие gates уже подтверждены checkpoint, а какие надо повторить;
4. точный порядок команд без production действий;
5. первый конкретный verification action — и сразу приступай.
```
