# UIX-578 — checkpoint безопасных проекций и review-only импорта

## Состояние

- Ветка: `codex/uix-578-safe-projections`.
- Основание ветки: `0d05a71` (`UIX-577`), актуальный на старте
  `origin/main`: `23683ae`.
- Stage: локальная реализация и все обязательные гейты завершены; следующий
  шаг — локальный коммит и перевод UIX-578 в `In Review`.
- Production, push, PR и merge не выполнялись.

## Решения

1. Безопасный маршрут
   `GET /api/characters/:characterId/spell-progression` всегда возвращает
   player allowlist, в том числе при запросе GM. Полный graph доступен только
   отдельным GM-маршрутом
   `GET /api/gm/characters/:characterId/spell-progression`.
2. PLAYER читает только собственного или контролируемого активного персонажа,
   только `ACTIVE` graph version и только при наличии текущего assignment
   snapshot, закрепляющего выбранные `packId` и `packVersionId`.
3. `DISCOVERED` берёт mechanics из immutable snapshot; `AVAILABLE` и `LOCKED`
   вычисляются общим prerequisite evaluator. Assignment переживает смену
   версии по стабильной identity `schoolId + nodeId`, но не может перескочить
   между школами при повторном использовании UUID.
4. `GM_ONLY` полностью исключается из player schools/nodes/edges. Locked node
   содержит только `id`, `schoolId`, `displayName` и `state`; layout,
   provenance, исходные тексты, requirement metadata и import warnings не
   входят в безопасный DTO.
5. `POST /api/spell-packs/imports/reference/preview` является stateless
   GM-only preview: source передаётся явно, runtime не читает `docs/content`,
   adapter детерминированно строит только `REFERENCE`. Transport body ограничен
   до разбора JSON, а Zod дополнительно ограничивает canonical source.
6. Все 31 `требуетУточнения` сохраняются внутри immutable graph как `OPEN`
   markers; шесть неоднозначных схождений остаются `UNRESOLVED`. Review-версии
   получают 37 warnings, а promotion в `ACTIVE` превращает их в ошибки.
   Успешный promotion возможен только из новой версии с `RESOLVED` markers и
   явными `ALL | ANY` groups.
7. Новая таблица или миграция не нужны: graph и markers остаются snapshot JSONB
   существующей `spell_pack_versions`. Backup/reset manifests не менялись.

## Изменённые файлы

### Контракты и домен

- `packages/contracts/src/spell-schools.ts`
- `apps/server/src/spell-assignment-storage.ts`
- `apps/server/src/spell-projection.ts`
- `apps/server/src/spell-reference-import.ts`

### HTTP и PostgreSQL gate

- `apps/server/src/routes.ts`
- `apps/server/src/spell-pack-routes.ts`
- `apps/server/src/spell-projection-routes.ts`
- `apps/server/src/spell-projection.pg-probe.ts`
- `scripts/run-multiplayer-e2e.mjs`

### Тесты

- `apps/server/src/spell-pack-routes.integration.test.ts`
- `apps/server/src/spell-projection-routes.integration.test.ts`
- `apps/server/src/spell-projection.test.ts`
- `tests/spell-projection-contract.test.ts`
- `tests/spell-reference-import.test.ts`
- `tests/spell-school-graph.test.ts`
- `tests/spell-pack-persistence.test.ts`
- `tests/helpers/campaign-isolation-routes.ts`
- `tests/multiplayer-runner-report.test.ts`

### Документация

- `docs/architecture.md`
- `docs/content/README.md`
- `docs/plans/uix-262-spell-progression-graphs.md`
- `docs/plans/uix-578-safe-projections-import.md`
- `docs/uix-578-safe-projections-import-checkpoint-2026-09-01.md`

Hot frontend-файлы `apps/web/src/styles.css`, `apps/web/src/App.tsx` и
`apps/web/src/sidebar/ChatPanels.tsx` не менялись.

## Проверка

### Targeted

- Контракты, DB и server targeted build/typecheck: PASS.
- Import/fixture: 2 файла, 33 теста — PASS.
- Projection/prerequisite: 3 файла, 10 тестов — PASS до интеграции; после
  composite-identity regression — 2 интеграционных файла, 11 тестов — PASS.
- HTTP, campaign inventory, persistence, documentation и runner targeted
  наборы — PASS.
- Read-only интеграционное ревью: найдены и исправлены cross-school snapshot
  leak и отсутствие transport body limit; повторное ревью — блокеров нет.

### Диверсия

1. Import: временно отброшен один source warning. Точный тест дал
   `1 failed / 4 skipped` (`31`, фактически `30`, exit `1`); после возврата —
   PASS.
2. Privacy: в locked player DTO временно добавлен `mechanicsText`. Точный тест
   `omits hidden IDs, locked mechanics and every GM-only field from the player allowlist`
   дал `1 failed / 3 skipped`, Zod указал лишний `mechanicsText`, exit `1`;
   после возврата — `1 passed / 3 skipped`.

### Полный гейт

Последовательно выполнено:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

- Результат: PASS, `198` test files / `1509` tests.
- Lint: 0 errors; три ранее существовавших warning в `App.tsx` и
  `player-request-chat.tsx`.
- Build выполнялся до test; предупреждение Vite о размере bundle не новое и не
  относится к UIX-578.

### Multiplayer

- Явный Docker context: `desktop-linux` (`linux 29.7.2`).
- Режим: `ARKEN_ISOLATED_ONLY=true`; production health намеренно skipped.
- Проект: `arken-e2e-mtj0f0ug-11276`.
- Spell-pack PostgreSQL probe: exit `0`.
- Spell-assignment PostgreSQL probe: exit `0`.
- Новый spell-projection/import PostgreSQL probe: exit `0`.
- Playwright: `2 passed`, включая restart/reconnect и shared-browser handoff.
- Cleanup: exit `0`; containers `[]`, volumes `[]`; resource-leak-check PASS.
- Итоговый код: `MULTIPLAYER_EXIT_CODE=0`.

## Блокеры и следующий шаг

- Блокеров реализации и гейтов нет.
- Референс 2024 намеренно нельзя перевести в `ACTIVE`, пока мастер не разрешит
  31 неоднозначность и шесть схождений.
- Следующий шаг: explicit `git add` только перечисленных файлов, локальный
  commit `feat(magic): add safe spell projections (UIX-578)`, затем stage-gate
  comment и `In Review` в Linear. Push/PR/merge/deploy остаются решением
  пользователя.
