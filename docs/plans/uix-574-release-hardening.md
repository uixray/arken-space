# UIX-574 — сохранение rollback images и fail-closed release gate

## Диагноз

- Baseline: `origin/main` `23683aeb1e3e0d50ca98e82b29b2c07682c9dde6`.
- `release.sh` сохраняет только SHA из `/healthz`; точные образы запущенных
  `server` и `web` до `docker compose up --build` не получают отдельные теги.
- Текущий disk gate сравнивает округлённые GiB только один раз и не читает
  production `MIN_FREE_DISK_BYTES`.
- `.env`, restic env и их права до запуска не проверяются. Compose defaults
  позволяют пропустить часть обязательных production-настроек.
- `smoke-auth.sh` ищет cookie-флаги через `grep ... && echo`, поэтому отсутствие
  флага не роняет `set -e`; diagnostics печатается без сверки revision/schema.
- Более общий замер: `restic`, backup, restore, build и auth запускаются слева
  от pipe. POSIX `sh` возвращает статус последней команды (`tail`/`grep`), и
  реальный провал обязательного gate может выглядеть зелёным.
- Безопасного `DELETE /api/assets/:id` нет. Positive image/audio upload создаёт
  файл, строку `assets`, `game_event` и realtime-событие; прямой SQL/unlink
  обошёл бы доменные ограничения и не является допустимым cleanup.
- Baseline focused gate: `tests/release-script.test.ts` и
  `tests/documentation-freshness.test.ts` — 2 файла, 27 тестов, зелёные.

## Решения

1. Перед production build получить image ID ровно одного запущенного контейнера
   `server` и `web`, затем закрепить их тегами
   `arken-space-rollback-<service>:<production-sha>`.
2. Считать такие теги immutable в границах release automation: существующий
   тег допустим только при том же image ID; коллизия останавливает release.
3. После build повторно сверить оба rollback-тега с сохранёнными IDs, получить
   IDs новых running images и вывести все значения в итоговом evidence.
4. Проверять production `.env` fail-closed: обычный не-symlink файл, владелец —
   оператор, mode `600`, файл не tracked; обязательные значения непусты,
   origins точные, media path абсолютный и канонический, byte limits —
   положительные целые. Backup-секреты в application env запрещены.
5. Проверять root-owned mode `600` для restic env и password file. Значения
   секретов не выводить ни при успехе, ни при отказе.
6. Считать требуемый запас без округления:
   `MIN_FREE_DISK_BYTES + 5 * 1024 * 1024 * 1024`. Запускать gate перед build и
   сразу после него на файловой системе production media path.
7. Все обязательные команды сначала выполнять в приватный лог с сохранением
   собственного exit code; `tail`/`grep` разрешены только после успеха.
8. Вынести проверяемую семантику env/disk/image и auth headers/diagnostics в
   импортируемые `.mjs`-модули. Shell остаётся orchestration-слоем.
9. Auth smoke получает обязательные expected revision/schema, использует
   приватный `mktemp`, проверяет точный session cookie и каждый флаг, валидирует
   JSON diagnostics, выполняет logout и всегда удаляет временные секреты.
10. Media остаётся явным ручным gate на disposable non-live контуре точной
    кандидатной ревизии. Confirmed deploy потребует
    `MEDIA_SMOKE_APPROVAL=non-live-candidate-passed`; тестовые assets на live не
    создаются. Автоматизация переносится в отдельную задачу после безопасного
    asset lifecycle.
11. Удерживать фиксированный host lock весь release и перед checkout проверять
    production `.env`, отсутствие `.env` в target tree и принадлежность target
    к fetched `origin/main`; после checkout повторно сверять metadata и SHA-256
    файла.
12. Confirmed pass разрешать только когда процесс уже начался на target SHA.
    Это делает первый rollout новой release automation обязательным
    двухфазным: unconfirmed checkout, отдельная сверка HEAD, confirmed rerun.
13. До и после capture running image IDs повторно сверять `/healthz` с исходной
    production revision. Failure summary печатает tag → ID только после
    успешной проверки tag; после build tags проверяются немедленно.
14. Не исполнять application `.env` как shell ради auth smoke. Payload создаёт
    validator напрямую из проверенного файла, а после logout старая cookie
    обязана получить `401 AUTH_REQUIRED` на diagnostics.

## Подзадачи

1. Добавить pure-core для env, disk reserve и rollback image contracts вместе
   с табличными unit-тестами.
2. Добавить auth-smoke core, переподключить `smoke-auth.sh`, покрыть missing
   cookie flags, decoy cookie и revision/schema mismatch.
3. Перестроить `release.sh`: private workdir, точный rollback SHA, безопасные
   логи, env/permission gates, rollback tags, disk before/after, evidence.
4. Зафиксировать один compose project/path в `build-and-start.sh`, чтобы capture
   и build не могли обратиться к разным проектам.
5. Обновить release checklist/operations и freshness assertions для ручного
   non-live media gate и нового evidence.
6. Провести диверсии: collision rollback-tag и отсутствующий `Secure`/неверная
   diagnostics revision должны уронить только соответствующие focused-тесты.

## Гейты

```text
pnpm exec vitest run tests/release-core.test.ts tests/release-auth-smoke.test.ts tests/release-script.test.ts tests/documentation-freshness.test.ts
sh -n infra/deploy/release.sh
sh -n infra/deploy/build-and-start.sh
sh -n infra/deploy/smoke-auth.sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:multiplayer
```

`test:e2e` не требуется: UI-поток не меняется. `test:multiplayer` обязателен,
потому что меняется release/Docker orchestration; Docker-недоступность будет
записана как непройденный gate, а не как успех.

## Контрольная точка замера

- Решения: immutable service tags, byte-accurate disk reserve, fail-closed env
  и auth, сохранение exit code, manual non-live media approval.
- Ревизия: `23683aeb1e3e0d50ca98e82b29b2c07682c9dde6`.
- Изменённые файлы: только этот план.
- Проверка: focused baseline 2/27; Docker и production не запускались.
- Блокеры: нет; safe live media cleanup отсутствует и сознательно не
  имитируется.
- Следующее действие: реализовать pure-core и подключить release orchestration.
