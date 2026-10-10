# UIX-293 — аудит исходных критериев

Revision: `ec67b2d3564505907ebbfd3f624c4c442c1c4064`.

| Исходный критерий | Проверенное доказательство |
| --- | --- |
| Превью, имя, тип, размер, использование и места | Actual MediaPanel Chrome: preview/name/type/size, grouping/filter/empty; API integration resolves scene/token/character/world/audio usage. Story library separately exposes current/historical revision locations without private chat identifiers. |
| Удаление неиспользуемого | Actual generic and story UI cleanup; API removes metadata/blob and handles audit/replay. |
| Блокировка используемого | Actual story UI disables deletion, DELETE409; generic HTTP integration returns409 and retains referenced bytes. |
| Замена без разрушения ссылок | Actual generic UI stable ID, changed URL version and downloaded SHA; HTTP integration preserves MAP/TOKEN/PORTRAIT/IMAGE/AUDIO relation rows. Actual published story A→B keeps A historical and B current; integration preserves both revision media bytes. |
| ACL usage/replace/delete/direct content | Current HTTP integration covers GM, PLAYER, foreign campaign, published/draft world content; story campaign/uploader boundary and PLAYER403. |
| Журналирование и API/integration tests | Audit insert rollback, immutable replay/conflict, cleanup retry, duplicate deletion and both completed serial chat-claim/delete orders tested. Not a simultaneous race-stress claim. |
| Все названные зависимости | Generic integration includes scenes, token definitions/placements, characters/resources, world-content and audio; separate story lifecycle was explicitly added, not replaced by world-content coverage. |

## Связанный финальный gate

Root: eight test files / **44 tests PASS**, exit0, session81742 on this revision:
asset-lifecycle HTTP integration, story lifecycle, StoryAttachmentLibrary,
feedback operator API, operator frontend, feedback diagnostics, two dialog suites.
The 293 subset is covered explicitly; unrelated operator tests are not used to
inflate 293 evidence. Official web typecheck exited0 for the native dialog fix;
server source is unchanged since its verified typecheck.

Luna actual browser receipts: `uix293-media-panel-followup.md` (ec67b2d),
`uix293-318-browser-check.md` (historical story runtime917af2d). Git between those
revisions changes only docs and the independently checked native Escape guard,
not story upload/revision/delete implementation. Receipts/screens remain in
ignored local QA storage; no private content is copied into this audit.

## Boundary

Implementation and acceptance are local, on synthetic data and real APIs/DB.
No production deployment, original campaign modification, full old E2E,
physical-device acceptance or simultaneous concurrency stress is claimed.
Those are not silently substituted for the explicit API/browser scope above.
Production release still requires a separately requested gate.
