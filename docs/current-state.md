# Текущее проверенное состояние Arken Space

> Сверено 19 сентября 2026 после production release PR85. Это снимок, а не автоматически обновляемый статус.

## С чего продолжать

1. [Единая точка входа](README.md).
2. [План на следующие месяцы](plans/global-roadmap-2026-09-18.md).
3. [Полный остаток задач](plans/remaining-work-2026-09-18.md) и [машиночитаемый источник](plans/remaining-work-2026-09-18.json).
4. [Пакеты исполнения](plans/execution-packets-2026-09-18.md).
5. [Правила агента](agent-guide.md).
6. [Отчёт текущего выпуска](release-2026-09-19.md).

Linear хранит статусы и исходные критерии; Git — реализацию; CI/runtime — проверенное поведение. Ни один источник отдельно не доказывает полную приёмку.

## Текущий production

| Уровень                    | Проверенное состояние                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin/main` и production | `aab0731a947852bbcb3c5955ed52008468353ae4`; PR85 merged, tree совпадает с PR head `e67bacc37a1ac4b77a2524388cc76a8ffacf5698`                             |
| `checks`                   | [35443744021](https://github.com/uixray/arken-space/actions/runs/35443744021) SUCCESS                                                                    |
| `E2E`                      | [35443743897](https://github.com/uixray/arken-space/actions/runs/35443743897) SUCCESS: 1063 PASS / 29 existing SKIP / 0 FAIL / 0 FLAKY / 0 report errors |
| `multiplayer`              | [35443743956](https://github.com/uixray/arken-space/actions/runs/35443743956) SUCCESS, 3/3 без retry                                                     |
| Confirmed backup           | `5ae46818eefb19341819a54553d35d9ee50eb5247fc9aace9f90c2e44f4136a9`                                                                                       |
| Restore                    | 22/22 PASS; 44→45 migrations, 55/55 tables, 120 media files, exact `aab0731…`, schema 2, cleanup без leftovers                                           |
| Runtime                    | health/database `ok`; auth/cookie/logout→401 и WebSocket 101 PASS, в том числе после controlled restart                                                  |

## Выпуск и recovery

Confirmed release сохранил rollback images, собрал и запустил target, но raw `release.sh` завершился exit 1: после build было 6,777,135,104 bytes при required 7,516,192,768. Порог не снижался.

Удалены только 19 заранее перечисленных reclaimable/non-shared build-cache IDs. Manifests всех images/volumes до и после идентичны; production/rollback images и данные не удалялись. Recovery disk gate: 7,851,753,472 bytes PASS. После controlled restart: 7,851,646,976 bytes PASS.

Persistence до deploy, после deploy и после restart совпадает:

- 55 table counts;
- 120 media files, 74,699,580 bytes;
- aggregate media SHA-256 `6bcace0864428fdd3e8a709cb3ddfc3698efcf5fea5e012d20e45a9d1c11b35b`;
- `.env` digest, owner и mode.

Rollback остаётся на точных images предыдущего `cce56397…`; deployed server/web image IDs и полный recovery описаны в [релизном отчёте](release-2026-09-19.md).

## Что опубликовано для мастера и игроков

Тема сохраняется отдельно для каждого игрока в каждой кампании (membership).
Предпросмотр, отмена, сохранение и сброс к своей теме не смешиваются; прежнее
`classic-v1` и системное оформление доступны. Назначение мастером default не
перезаписывает личный выбор. В выпуск также входят единые иконки Lucide,
читаемые подложки элементов над картой, компактные основные targets и корректные
слои меню диалогов. Полная приёмка всех игровых поверхностей остаётся отдельной.

## Browser evidence

Production observer функционально подтвердил:

- exact revision/schema и canvas после reload;
- персональный theme preview/cancel без persistence и с восстановлением исходной темы;
- existing audio range `206`;
- zero page errors, authorized HTTP errors и observer errors;
- logout→401.

Все 3 реально полученных JS/CSS payload hashes совпали с файлами deployed web container (`production-runtime-hashes.json`). Первый screenshot поймал exit-анимацию отменённого dialog; это был дефект наблюдателя, не runtime. Исправленный run в `release-2026-09-19/browser-final/` завершился PASS: `final-browser-summary.json` подтверждает zero errors, theme preview/cancel, audio `206` и совпадение всех runtime hashes. Финальный screenshot вручную принят: ready map, портреты/токены и журнал видимы, ghosted dialog отсутствует. Technical production release завершён в 13:30 UTC.

## Статусы конечного дизайн-пула

- **Done:** UIX-502, UIX-624 (P1), UIX-645.
- **In Progress:** UIX-317, UIX-644.

UIX-317 не является полной all-surface WCAG/first-paint/physical-device приёмкой. UIX-644 сохраняет исходные незакрытые границы: causal replay исторического ResizeObserver incident и headed native Firefox popup visual/pointer/Escape/focus. Зелёный release не отменяет эти критерии.

Не начинать автоматически следующий backlog. После фиксации финального screenshot и release evidence работа ставится на ограниченную паузу до явного следующего запроса владельца.

## Границы доказательств

- Human GM + 6 session, физические телефоны/Safari и субъективное прослушивание не подтверждены.
- 29 existing E2E skips не считаются приёмкой.
- Local Docker был недоступен из-за stale/inaccessible `sailor-ingest.sock`; окружение не ремонтировалось. Ручной media gate прошёл на отдельном loopback-only disposable host contour без production mounts, с очисткой assets/containers/volumes/network/image.
- Подробные исторические checkpoints остаются в Git, [финальном плане](plans/design-finish-2026-09-19.md) и [отчёте выпуска 18 сентября](release-2026-09-18.md). Не переносить их старые ограничения в текущий статус.

## Защищённые локальные материалы

- Неотслеживаемый `tests/e2e/selection-recovery.spec.ts` не входит в published candidate. SHA-256: `7A5AB2F67EA250F787DFAC9AC441CE387CD61C4F9B99AAA48210A935EB6D6D9A`. Не применять к нему `git add .`, `git clean`, reset или checkout.
- Рабочее дерево: `D:\AI\personal\experiments\arken-space\.worktrees\uix-421-scene-inputs`.
- Полный Lucide React 1.41.0 сохранён в `D:\AI\personal\experiments\arken-space\asset-library.local\lucide-react\1.41.0`; архив/лицензия не являются целиком runtime bundle.
- Операторские release receipts: `C:\Users\UIXRay\.codex\visualizations\2026\09\16\01a0a7d5-b072-7022-8e9d-4538c0a92b07\release-2026-09-19`.

## Следующий безопасный шаг

Технический release и scoped browser acceptance завершены. Зафиксировать stage gate и поставить работу на согласованную паузу. Не перезапускать неизменённые CI, backup/restore, deploy, restart, persistence, browser или payload gates. Не расширять scope и не создавать новый backlog pool.
