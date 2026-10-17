# UIX-587 — checkpoint asset closure токена

Дата: 2026-09-02

Baseline: `origin/main@d789d97`

Implementation revision: `a91ba5045c9463a90605be19d495f6b95cc4c99e`

## Решения

- `token_definitions.default_asset_id` — единственный runtime source картинки
  токена; `tokens.asset_id` остаётся legacy mirror для history/restore.
- Player asset closure строится из финальных scene/role/fog-filtered Token DTO.
  Тот же массив возвращается в snapshot, поэтому DTO и content ACL больше не
  могут выбрать разные asset id.
- Синхронизировать все placement rows при PATCH definition не нужно: это
  сохранило бы два изменяемых источника и добавило гонки с revisions/undo.
- Schema и migrations не меняются.
- Перед возобновлением незамерженной UIX-293 её asset usage resolver должен
  перестать эмитить `TOKEN_PLACEMENT` для legacy mirror. Иначе после A → B
  старый A навсегда останется `ASSET_IN_USE`.

## Изменённые файлы

- `apps/server/src/snapshot.ts` — единая проекция Token DTO и closure по её
  актуальному `assetId`.
- `tests/token-generator-http.integration.test.ts` — реальный A → B через
  Fastify/PGlite, snapshot и content ACL для PLAYER/GM/foreign/unknown.
- `docs/plans/uix-587-token-asset-closure.md` — план, замер, диверсия и гейты.
- этот checkpoint.

## Проверка

- Замер до правки: Token DTO указывал B, но `snapshot.assets` не содержал B.
- Focused после правки: `1 passed`, остальные 9 тестов файла skipped.
- Весь затронутый integration-файл: `10/10`.
- Диверсия: временный возврат closure к `tokens.assetId` уронил ровно новый
  UIX-587 test на отсутствии B; после восстановления focused снова зелёный.
- Два независимых read-only review: блокирующих замечаний нет; fixture не
  маскируется controller, character, uploader, map, audio или world-map closure.
- `pnpm format:check` — passed.
- `pnpm lint` — passed, 0 ошибок и 3 существующих предупреждения.
- `pnpm typecheck` — passed, workspace concurrency 1.
- `pnpm build` — passed, workspace concurrency 1.
- Полный Vitest: `207` файлов, `1673` теста, `maxWorkers=1`, passed. Один worker
  вместе с coordinator занимал около 1,17 ГиБ. Предыдущий неверный вызов с
  лишним `--` поднял два worker и был немедленно остановлен; гейтом не считается.
- Isolated multiplayer project `arken-e2e-uix587-a91ba50`:
  - exact build revision `a91ba5045c9463a90605be19d495f6b95cc4c99e`;
  - spell pack / assignment / projection PostgreSQL probes — exit `0`;
  - Playwright — `2/2`, один worker, backend restart пройден;
  - production health до и после — `skipped` (`isolated-only`);
  - cleanup exit `0`, leftover containers `0`, volumes `0`.
- Во время Playwright пик контейнера составил около 1,53 ГиБ. При свободных
  ~693 МиБ Windows временный контейнер был ограничен до 2 CPU / 2 ГиБ; гейт
  завершился зелёным, ресурсы и локальные images удалены.

## Блокеры и следующий шаг

Блокеров нет. Задача готова к `In Review`. Push, PR, merge и production не
выполнялись; следующий шаг требует отдельного решения владельца.
