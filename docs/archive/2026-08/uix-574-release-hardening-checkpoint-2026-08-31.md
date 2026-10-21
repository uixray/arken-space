# UIX-574 — checkpoint release hardening

Дата: **31 августа 2026 года**.

## Решения

- Точные running images `server` и `web` закрепляются тегами
  `arken-space-rollback-<service>:<production-sha>`. Существующий тег можно
  переиспользовать только при том же полном `sha256` image ID.
- Release удерживает один host lock, принимает target только из fetched
  `origin/main`, защищает production `.env` до и после checkout и требует
  отдельный unconfirmed pass перед confirmed запуском новой release automation.
- Disk gate считает без округления `MIN_FREE_DISK_BYTES + 5 GiB` перед build и
  сразу после него. Exit code обязательной команды сохраняется до чтения лога.
- Auth smoke не исполняет `.env` как shell: приватный login payload создаётся
  из валидированного файла. Проверяются точная session cookie, `HttpOnly`,
  `Secure`, `SameSite=Strict`, revision/schema и `401 AUTH_REQUIRED` для старой
  cookie после logout.
- Positive image/audio smoke остаётся явной ручной аттестацией disposable
  non-live candidate. Тестовые загрузки в live-кампанию запрещены.

## Ревизия

- Ветка: `codex/uix-574-release-hardening`.
- Основной commit:
  `1600a64bae73ef8b2fd30b9895d7ff64d96ca011`.
- Baseline и свежий `origin/main` после `git fetch`:
  `23683aeb1e3e0d50ca98e82b29b2c07682c9dde6`; main не продвинулся, merge не
  потребовался.

## Изменённые файлы

- `.github/workflows/checks.yml`;
- `infra/deploy/release.sh`, `release-core.mjs`, `build-and-start.sh`,
  `smoke-auth.sh`, `auth-smoke-core.mjs`;
- `tests/release-script.test.ts`, `release-core.test.ts`,
  `release-auth-smoke.test.ts`, `documentation-freshness.test.ts`;
- `docs/operations.md`, `production-release-checklist.md`,
  `plans/uix-574-release-hardening.md` и этот checkpoint.

Не изменялись `apps/web/src/styles.css`, `apps/web/src/App.tsx` и
`apps/web/src/sidebar/ChatPanels.tsx`.

## Проверка

- Focused release suite: **4 файла / 103 теста PASS**.
- `node --check` для обоих `.mjs`: PASS.
- `sh -n` отдельно для `release.sh`, `build-and-start.sh`, `smoke-auth.sh`:
  PASS. Те же три отдельные проверки добавлены в Ubuntu GitHub CI.
- Полный обязательный gate на `1600a64`:
  `format:check → lint → typecheck → build → test`, exit code 0; Vitest —
  **187 файлов / 1499 тестов PASS**. Lint: 0 ошибок, 3 прежних warning в
  `App.tsx` и `player-request-chat.tsx`.
- Изолированный `test:multiplayer` на context `desktop-linux`: **2/2 PASS**;
  health поднялся на точной revision `1600a64bae73ef8b2fd30b9895d7ff64d96ca011`,
  backend restart, cleanup и resource-leak check — PASS, containers/volumes не
  остались. `ARKEN_ISOLATED_ONLY=true`, поэтому production health не вызывался.
- UI E2E не запускался: UI-поток не менялся.

## Диверсии

- Снятие collision guard rollback tag, diagnostics status guard, корректного
  service tag, post-capture revision guard и post-logout invalidation guard
  давало ровно по одному ожидаемому targeted failure.
- Замена rollback tag в документации также роняла ровно freshness assertion.
- После каждого восстановления соответствующий focused-набор возвращался в
  зелёное состояние; итоговый общий focused run — 103/103.

## Блокеры и следующий шаг

- Issue-level локальных блокеров нет. GitHub CI ещё не запускался, потому что
  ветка не push-илась; PR, merge и production deploy не выполнялись.
- Отдельный follow-up: fresh-host bootstrap всё ещё содержит legacy domain в
  `infra/deploy/prepare-host.sh` и `infra/deploy/install-nginx.sh`, а
  `docs/deployment.md` неполно описывает first-deploy production origins. Это
  не изменялось в UIX-574 из-за отдельной approval boundary.
- Следующее действие: перевести UIX-574 в In Review. Push/PR и последующее
  слияние — только после решения владельца; production release потребует
  отдельного completed gate и явного запроса.
