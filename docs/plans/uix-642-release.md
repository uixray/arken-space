# UIX-642 — единый релизный пул

## Checkpoint интеграции — 2026-09-06

- Решение владельца: опубликовать текущий пул как есть; дополнительную проверку
  смены игрока отложить. Это принятый риск, не заявление о безошибочности сценария.
- Исходный main: `f1a66c835b7915a68dbc3a287f0ae358efb656ae`.
- Объединённая ревизия до test-only адаптации: `cb2a38f9c09ac65b5f645b0ac0f3d98660b1301b`.
- Ветка: `codex/uix-642-release`. PR #58–67 объединены merge-коммитами без
  переписывания истории; исходные ветки и чужие рабочие деревья не менялись.
- Автоматических конфликтов нет. Проверены стыки App/Renderer: WASD TOKEN-only,
  смешанный выбор для Arrow/drag, hidden/inert guards, rollback/recovery и
  account-menu rename сохранены.
- Единственная дополнительная правка: `tests/e2e/navigation-completion.spec.ts`.
  При 390px проверяется compact shell, затем desktop priority+ assertions
  выполняются на границе 1024px; проверки клавиатуры и возврата к 2000px сохранены.
  Продуктовый код дополнительно не менялся.
- PR #67: checks SUCCESS (224 файла / 1804 теста), multiplayer SUCCESS (2/2),
  e2e SUCCESS (283 passed / 1 flaky / 4 skipped). Flaky — фокус при смене игрока,
  retry прошёл; расследование отложено владельцем. Это не clean PASS.
- Проверки отдельных PR не заменяют проверку объединённой ревизии. Следующий
  gate: checks/e2e/multiplayer интеграционного PR, затем точного нового main SHA.
- Локальный build объединённого дерева прошёл. Первый навигационный прогон:
  9 passed / 1 failed — Firefox при 1024px действительно помещает PLAYER-токены
  в overflow, в отличие от Chromium. Test-only контракт уточнён: активный раздел
  представлен ровно один раз; проверяется фактический путь, GM обязательно
  проходит overflow/Enter/Escape. Результаты финального gate фиксируются в
  UIX-642 и GitHub checks без переписывания этого checkpoint на каждом шаге.
- Финальный навигационный прогон: **10/10 PASS**, Chromium + Firefox. Локальные
  format/lint/typecheck прошли (lint: 0 errors / 4 warnings); полный Vitest:
  **227 файлов / 1817 тестов PASS**, exit 0, 739.53 s.
- Для обязательного non-live media gate добавлен
  `tests/multiplayer/media-smoke.spec.ts` и собственная synthetic Ogg/Vorbis fixture
  `uix642-synthetic-tone.ogg` (440 Hz oscillator, без стороннего контента).
  Existing disposable CI проверяет точную ревизию, upload/download/range,
  image decode/audio playback, reload и сохранность после backend restart.
  Production URL запрещён самим тестом; продукт/runner/workflow не менялись.
  Локальный Docker недоступен, поэтому runtime evidence должен дать Linux CI.
  Static tsc/prettier/eslint и discovery (3 tests / 2 files) прошли. Negative
  guard diversion с `https://example.invalid` дала ожидаемый exit 1 до создания
  context, health, database/auth/API writes. Это проверка изоляции, не замена
  положительного media runtime gate.
- Первый CI multiplayer на `a79f3cdf602d948589b1fd1ed3d8dcb055adf4b2`:
  existing 2 tests PASS, новый media test FAIL. PNG upload201, Ogg/Opus upload400
  `UNSUPPORTED_AUDIO_TYPE`: sniff давал `audio/ogg; codecs=opus`, не входящий в
  действующий allowlist. Исправлена только fixture на собственный Ogg/Vorbis:
  6769 bytes, 0.7 s / 48 kHz stereo, SHA-256
  `21777ec04536e1d079ec8c5c14253fff1a12944a1f1ac1191490029d570e2a73`.
  Sniff `audio/ogg`, music-metadata и реальный Firefox decode PASS.
  Product allowlist не менялся. После первого failed CI cleanup/leak-check PASS;
  новый runtime gate требуется на исправленной ревизии.
- Production пока не менялся. Перед выкладкой обязательны свежие host preflight,
  backup и restore rehearsal точного snapshot, non-live image/audio smoke,
  сохранённые rollback image IDs и двухфазный `infra/deploy/release.sh`.
- После выкладки: health с точной ревизией, auth/logout/WS и persistence smoke.
  UIX-217 и реальная hardware/human приёмка остаются отдельными; mobile P2–P6
  не входят в релиз и не считаются завершёнными.

## Утверждённые головы

| PR  | Задача  | SHA                                        |
| --- | ------- | ------------------------------------------ |
| 58  | UIX-621 | `34ccd8a98ad0bf753b9e373154597f593a4b5669` |
| 59  | UIX-416 | `f656a796c1f6a10b1ad9ad4f3be764fe992afed1` |
| 60  | UIX-491 | `ed6cf80dc5e4f1e3c56e46a3976690b9c6df136d` |
| 61  | UIX-405 | `1e2eb74631d8fde2bd4a1994a3daa709c7219aad` |
| 62  | UIX-507 | `1b68e74aa6d06e84f07133672e0675cef746a0d6` |
| 63  | UIX-502 | `5bd543126cf8390ae14a3ba6a0241afa78d84010` |
| 64  | UIX-418 | `4e59a8e7bb9df543cea76fd4898e56bc4bb88e10` |
| 65  | UIX-470 | `ed853d7d4b9d68309ce54af1f6b6b57136b0cc99` |
| 66  | UIX-475 | `e18b7830c2e1ea6ad96c228851b1a64e99695cdb` |
| 67  | UIX-624 | `8f1843a3656f7c59cf957cb9deac08ce152d879f` |
