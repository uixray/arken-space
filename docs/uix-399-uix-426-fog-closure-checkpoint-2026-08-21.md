# UIX-399 / UIX-426 fog closure checkpoint — 2026-08-21

## Ревизия

- Ветка: `main`.
- UIX-399 implementation: `726a9c5` — частично открытый токен не исключается
  из render/projection set.
- UIX-426 implementation: `39d232a` — игрок видит чужие токены под
  непрозрачным туманом, а контролируемые токены над ним.
- Server privacy projection: `351b22d` — полностью закрытые чужие токены не
  попадают в player snapshot.
- Closure evidence: `27decded3ad7b30b76c7a4aa80e216e84ade0a9f` —
  `test(fog): cover partial token occlusion (UIX-426)`.
- Push и deployment не выполнялись.

## Решения

- Production-код не изменялся: требуемая логика уже присутствовала в `main` и
  `origin/main`; незакрытым оставался browser acceptance для порядка Canvas
  layers.
- Fixture содержит частично открытый чужой токен, полностью закрытый чужой
  токен и контролируемый токен.
- Для частичного токена сравниваются две области с одинаковой фазой сетки и
  одинаковым `REVEAL`: область с токеном обязана отличаться от пустой открытой
  области. Закрытая половина обязана совпадать с пустым непрозрачным туманом.
  Вместе эти проверки ловят и повторное исключение partial token, и перенос
  foreign-token layer над fog.
- GM-проверка сохраняет прежнюю продуктовую границу: полностью закрытый для
  игрока токен остаётся видимым мастеру.
- Golden screenshot не добавлялся; локальные PNG buffers сравниваются только
  внутри одного браузера, чтобы не зависеть от межбраузерного сглаживания.

## Изменённые файлы

- `tests/e2e/concept.spec.ts`.

## Проверка

- Focused fog/visibility Vitest: **2 files / 23 tests PASS**.
- Targeted Playwright Chromium + Firefox, `--retries=0`: **2/2 PASS**.
- E2E TypeScript (`tests/e2e/tsconfig.json`): PASS.
- Scoped ESLint: PASS.
- Scoped Prettier: PASS.
- `git diff --check`: PASS.
- Независимый read-only review текущего diff: blockers не найдены.

## Блокеры и границы

- Блокеров по acceptance criteria UIX-399/UIX-426 не осталось.
- Browser-сценарий использует детерминированный mocked bootstrap и проверяет
  Canvas composition; это не live multiplayer gate.
- Human rehearsal GM + 6, production backup/restore/smoke и deployment остаются
  общими release gates проекта и этим test-only пулом не выполнялись.
- `apps/web/src/assets/` и приватные `docs/stickers/` не относятся к пулу и не
  включены в коммиты.

## Следующий шаг

1. Обновить UIX-399 и UIX-426 в Linear с implementation SHA и closure evidence.
2. Перейти к следующему срочному подтверждённому дефекту UIX-468.
