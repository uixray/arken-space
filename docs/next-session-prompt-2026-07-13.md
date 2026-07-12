# Промпт для следующей сессии arken-space

Продолжи разработку проекта `arken-space` в `D:\AI\personal\experiments\arken-space`.

## Цель сессии

Не добавляй пока UX-фичи из playtest backlog. Следующая приоритетная задача — превратить существующий multiplayer smoke test в полноценный автоматический сценарий Session 3: один мастер и шесть независимых игроков, security visibility assertions, потеря соединения и восстановление backend.

## Состояние проекта

- Это private browser-first VTT для одного мастера и 5–6 игроков.
- Production: `https://arken.uixray.tech`.
- Локальный HEAD на момент handoff: `da87cbb`; рабочее дерево было чистым.
- Production на момент handoff был healthy и работал на сборке `d6a224b`.
- Реализованы PostgreSQL, migrations, nginx/HTTPS, Socket.IO, GM/player sessions, invitations, 2D map, tokens, fog, character sheets, chat/dice, assets/music, health и diagnostics.
- Исправлен P0 authorization: один игрок может владеть несколькими токенами; чужие токены ему недоступны; ownerless enemy/NPC tokens управляются только мастером.
- Изолированный Docker/Playwright smoke test прошёл для GM + 2 игроков: invitations, own/foreign/enemy token permissions, concurrent chat/dice, scene switch и reconnect.
- Отчёт: `docs/multiplayer-smoke-2026-07-13.md`.

## Обязательный порядок работы

1. Прочитай полностью:
   - `tasks.md`;
   - `docs/roadmap.md`;
   - `docs/playtest-feedback-2026-07-13.md`;
   - `docs/multiplayer-smoke-2026-07-13.md`;
   - `docs/operations.md`;
   - `docker-compose.e2e.yml`;
   - `scripts/run-multiplayer-e2e.mjs`;
   - `tests/multiplayer/game-session.spec.ts`;
   - `tests/realtime.test.ts`.
2. Проверь `git status`, последние коммиты и текущую production health, прежде чем менять код.
3. Составь короткий рабочий план и начни реализацию без повторного проектирования продукта.
4. Сначала доработай E2E runner:
   - preflight Docker permission, disk threshold, edge health и exact Origin;
   - сохранение тяжёлого Playwright image после failed retry;
   - гарантированная final cleanup после success/явного завершения;
   - JUnit/JSON или Markdown defect report.
5. Расширь сценарий до GM + 6 чистых browser contexts:
   - мастер создаёт шесть персонажей и приглашений;
   - игроки независимо входят и получают свои токены;
   - несколько игроков одновременно двигают свои токены;
   - GM двигает ownerless NPC/enemy;
   - foreign/enemy moves игрока получают `FORBIDDEN`;
   - мастер меняет fog и активную сцену;
   - одновременно отправляются chat и dice;
   - один клиент reload, один offline 20–30 секунд, один late join;
   - backend restart;
   - все клиенты получают authoritative current snapshot без дублей.
6. Добавь adversarial assertions: игрок не должен получать hidden tokens, GM-only messages/rolls, чужие private notes, закрытые scenes/assets или недоступную fog geometry.
7. Локально выполни typecheck, lint, unit/realtime tests, build и Playwright list/config validation.
8. Перед любой загрузкой на сервер обязательно создай Git commit. Загружай только Git archive конкретного commit.
9. На сервере используй отдельный Compose project и отдельные volumes/port; не трогай production данные.
10. После server run проверь отсутствие E2E containers/volumes, production health и свободный диск. Удаляй только временные E2E resources и неиспользуемый build cache.
11. Запиши результат в новый timestamped файл `docs/` и обнови `tasks.md`/`docs/roadmap.md` только по фактическим результатам.

## Ограничения и риски

- Не считать GM + 2 smoke полным семиклиентным тестом.
- Не начинать re-cover fog, token images, portraits, hover labels, quick dice, music sidebar, token palette, изометрию, уровни или 3D до завершения foundation gates.
- Не выполнять большой рефакторинг без воспроизводимой причины.
- Не менять VPN/прокси. `amnezia-awg` наблюдался в restart loop — только зафиксируй состояние, если оно повторится.
- Пользователь сервера не имеет прямого доступа к Docker socket; runner сейчас требует `sudo`.
- На текущем сервере следи за диском: Playwright image временно занимает несколько гигабайт. После последней очистки было 7.6 GiB свободно.
- Не сохраняй и не печатай секреты, cookies, invitation tokens или приватные ключи.

## Критерий завершения следующей сессии

- Автоматический семиклиентный сценарий запускается воспроизводимо на изолированном стенде.
- Получен конкретный pass/fail отчёт по каждому пункту, включая security и recovery.
- Production остался healthy и не был изменён тестом.
- Все изменения закоммичены, документация и открытые дефекты обновлены.

После этого предложи следующий шаг: устранение только воспроизведённых realtime/security дефектов либо, если сценарий чистый, переход к remote restic backup и clean restore.
