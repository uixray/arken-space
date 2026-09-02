# UIX-587 — asset closure токена после смены definition

Baseline: `origin/main@d789d97`. Scope — server snapshot/content ACL и focused
integration coverage. Schema, migrations и web UI не меняются.

## Замер до правки

- Видимый token placement хранит legacy `tokens.assetId`.
- Финальный Token DTO всегда публикует `tokenDefinitions.defaultAssetId`.
- PATCH definition обновляет только `token_definitions`; placement row остаётся
  со старым asset.
- PLAYER asset allowlist добавляет старый `tokens.assetId`, а новый definition
  asset добавляется только для definitions, которыми игрок управляет.
- `/api/assets/:id/content` повторно строит тот же snapshot и тем самым повторяет
  рассинхронизацию.

Репрезентативный сценарий: видимый чужой токен создан с asset A, затем GM меняет
его definition на B. Текущий DTO указывает B, но PLAYER может получить A, а B
может отсутствовать в `snapshot.assets`.

## Доменное решение

- Player asset closure строится из **финальных role-filtered Token DTO**, а не
  из denormalized placement row.
- `tokenDefinitions.defaultAssetId` остаётся единственным runtime image source
  токена. Placement-specific override сейчас не является поддержанным API.
- Legacy `tokens.assetId` сохраняется для совместимости history/restore и не
  удаляется из schema в этой задаче, но больше не даёт право на content.
- GM по-прежнему получает assets своей campaign; foreign campaign и неизвестный
  UUID остаются за одинаковым safe 404.

## Этапы

1. [ ] **Reproduction** — Fastify/PGlite test A → B доказывает текущую ошибку в
       snapshot и content route до production fix.
2. [ ] **Projection fix** — Token DTO строится один раз; asset closure использует
       его `assetId`; return переиспользует тот же массив.
3. [ ] **Focused proof** — PLAYER получает B и не получает A; direct A/foreign/
       unknown — 404; B и GM paths — 200.
4. [ ] **Diversion** — временно вернуть legacy placement asset в closure и
       убедиться, что падает ровно новый privacy-тест.
5. [ ] **Gates** — format, lint, typecheck, build, full test одним worker и
       isolated multiplayer без production health.

## Предполагаемые файлы

- `apps/server/src/snapshot.ts`;
- `tests/token-generator-http.integration.test.ts`;
- этот план и итоговый checkpoint.

## Не входит

- удаление `tokens.assetId` и migration/backfill;
- UIX-293 usage/deletion UI;
- новые placement image overrides;
- push, PR, merge или production.
