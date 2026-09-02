# UIX-585 — интеграция готовых задач и production release

## Цель

Собрать один проверяемый release candidate от свежего `origin/main`, не переписывая
историю рабочих веток, провести локальные и GitHub-гейты, затем выполнить двухфазный
production release точного SHA.

## Состав release candidate

- уже в `main`: UIX-503;
- core: UIX-574, UIX-411, UIX-402, UIX-476, UIX-516, UIX-404;
- magic cumulative stack: UIX-575, UIX-579, UIX-580, UIX-577, UIX-578;
- pause authority: UIX-582.

UIX-582 включается последней: magic-стек уже занимает миграции `0041` и `0042`,
поэтому pause-миграция должна быть пересобрана как `0043` на объединённой схеме.

## Пулы

### 1. Интеграция без UIX-582

1. Влить UIX-574 и UIX-411.
2. Влить cumulative magic tip UIX-578 (он уже содержит UIX-575/579/580/577).
3. Влить UIX-402, UIX-476, UIX-516 и UIX-404.
4. Разрешать только подтверждённые конфликты, сохраняя обе предметные правки.

### 2. UIX-582 и миграции

1. Влить UIX-582 без переписывания исходной ветки.
2. Пересоздать её SQL и Drizzle metadata как следующую миграцию `0043`.
3. Обновить migration/reset/architecture tests и документацию под итоговую цепочку.
4. Добавить интеграционную регрессию порядка миграций.

### 3. Проверка release candidate

Последовательно, без параллельной нагрузки:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
pnpm test:multiplayer
```

Для новой интеграционной регрессии провести диверсию и зафиксировать точечное падение.

### 4. GitHub gate

1. Опубликовать только интеграционную ветку.
2. Создать PR с перечнем задач, диверсией и gate evidence.
3. Дождаться зелёных `checks`, `e2e`, `multiplayer`.
4. Слить merge-коммитом; проверить те же workflow на точном итоговом SHA `main`.

### 5. Production gate

1. На production host подтвердить текущий `buildRevision` через `/healthz`.
2. Запустить неподтверждённый `release.sh <SHA>`: preflight, свежий backup,
   isolated restore rehearsal; production stack не менять.
3. Выполнить disposable non-live media smoke точного SHA.
4. Только с реальным `MEDIA_SMOKE_APPROVAL=non-live-candidate-passed` выполнить
   подтверждённый проход `RELEASE_CONFIRM=deploy-now`.
5. Проверить health/schema, auth/logout, WebSocket, upload/audio, GM/player и
   persistence. При провале остановиться и использовать сохранённые rollback evidence.

## Fail-closed блокеры

- красный или отсутствующий обязательный gate;
- несогласованная последовательность миграций;
- отсутствие SSH/production-доступа;
- неподтверждённый non-live media smoke;
- отсутствие ручного GM+6 release gate.
