# ArkenHar — визуальная приёмка локального тестового стенда

**Текущая стадия:** чек-лист связан со стендом; ручная приёмка пользователем не выполнена.  
**Checklist URL:** `http://127.0.0.1:14183/acceptance`  
**Stand URL:** `http://127.0.0.1:14183/`  
**HTML source:** `.data/qa-prep/acceptance.html` (ignored, local-only).

## Граница безопасности

- Только локальный QA стенд и заранее подготовленные synthetic GM/PLAYER логины, кампании, пакеты и игровые активы. Это не production и не реальная кампания.
- Никогда не вводить пользовательские данные/секреты/реальные credentials; не загружать произвольные файлы, не публиковать или отправлять реальные материалы.
- Взаимодействие с записью разрешено только когда стенд явно показывает, что операция `synthetic/intercepted` или одноразовая QA fixture; если этой метки нет, проверить доступность/preview/cancel и остановиться перед submit. Для удаления разрешена только проверка открытия подтверждения и Cancel/Escape, не финальное удаление.
- Не использовать скрытые прямые URL, не менять роль/ACL вручную, не обходить отказ. Если нужный экран недостижим штатной видимой навигацией, отметить «не достигнут/pending» и передать владельцу стенда; не угадывать путь.
- Чекбоксы сохраняются в localStorage этого браузера. Не вводить туда отчёты или приватные сведения.

## Как пройти

1. Открыть стенд и закреплённую ссылку **«QA · Чек-лист приёмки»** в верхней навигации, либо напрямую `/acceptance`.
2. Проверить desktop `1280×900` и compact `390×844`; для keyboard flows использовать Tab/стрелки/Enter/Escape, а не автоматизированное `selectOption`.
3. Выполнять HTML-пункты по порядку. Любое не выполненное / скрытое без видимой навигации / не имеющее явного synthetic interception — оставить pending.
4. Сначала снять безопасные визуальные проверки. Для сценариев с локальным synthetic write — выполнять действие только при явном стендовом разрешении/interception; сличить видимое состояние до/после и затем не продолжать mutation.
5. Записать browser/version, размер окна, роль, scenario ID при его наличии, и результат без личных данных. Передать pending/дефект оператору; отметка здесь не закрывает серверный, API или production gate.

## Точные маршруты и ожидания, где они известны

- **Setup row menu:** на GM открыть Setup → `Общий каталог` → menu `⋯` первой synthetic строки. Escape закрывает row menu, возвращает фокус на строку; Setup остаётся. Внутри row menu открыть rename prompt и Escape: закрывается только prompt, menu/Setup остаются; не менять/сохранять название.
- **Files/catalog:** использовать только пункт `Файлы` / `Files`, если он виден в стендовой навигации. Проверить фильтр Media kind (ALL плюс два вида), список и доступную synthetic историю. Сценарий замены A→B разрешён только если сама QA fixture явно обозначает обе записи synthetic, Replace перехвачен и новая запись не попадает в campaign/API; если это не гарантировано — не выполнять, оставить pending.
- **Story attachment:** если GM navigation показывает `Story` и текущая QA fixture явно содержит опубликованный synthetic A, открыть correction UI → `Replace` → выбрать только подготовленный synthetic B → `Save`. Сверить B current, A prior revisions/history, A delete disabled/in-use. Это допускается только в изолированной synthetic local fixture; произвольную загрузку/удаление не выполнять. Если fixture/файл не размечены как synthetic — pending.
- **Sticker picker:** synthetic PLAYER chat → видимая кнопка sticker picker. Оба пакета, 24 и 115 элементов, должны иметь scope **GLOBAL_PUBLIC** и быть доступны GM/PLAYER в обеих тестовых партиях, не только в партии создателя. Проверить выбор/preview/закрытие desktop и compact. Не требовать индивидуальные имена стикеров. Send проверять только при явно обозначенном intercepted synthetic scenario; в противном случае — до нажатия Send и pending.
- **GM sticker pack controls:** только видимая GM Files/sticker-pack форма. Открыть отдельный менеджер общих паков: оба набора должны иметь scope `GLOBAL_PUBLIC`. Любой GM может создавать свой общий пак; чужой пак доступен для выбора, но не изменения. Старые частные паки остаются в отдельном каталоге кампании. Сверить provenance и нейтральные подписи. Preview локального подготовленного synthetic asset безопасен; Upload/Publish выполнять только при явной synthetic interception маркировке.
- **GM/PLAYER access:** брать роли только из предоставленных synthetic логинов/stand switcher. Сверить видимые navigation/actions и закрытый экран без прямого URL обхода. UI-осмотр не доказывает API/ACL защиту.
- **Sidebar:** GM Sidebar → видимый Preview; проверить recruit unavailable пока нет разрешённой текущей battle zone. Collapse/expand и resize — на synthetic campaign; не запускать recruit/combat mutation.
- **Tooltips/Dice:** tooltip hover/focus/Escape/edge placement. Dice tray geometry/idle можно проверить без Roll; Roll/result/error/retry только если локальный stand явно сообщает synthetic/intercepted transport.
- **Native select Escape:** только если пользователь реально видит системный popup в поддерживаемом браузере. Зафиксировать open, первый Escape (popup закрыт, фокус остаётся на select), второй deliberate Escape (родительская поверхность закрыта). DOM selection и `selectOption` это не подтверждают.

См. полный checkbox sheet: [acceptance.html](../../.data/qa-prep/acceptance.html).

## Текущие доказательства и ограничения

- UIX398 focused App provider test — 1/1 PASS; официальный web typecheck — exit 0. Доказан production App provider/action identity в synthetic rerenders и preference callbacks под тестовым DOM, но не browser-visual и не смена campaign/member identity.
- UIX644 bounded overlay: Chrome synthetic GM desktop наблюдал Setup row-menu Escape/focus return и вложенный rename Escape; focused Vitest/typecheck отдельно прошли. Checklist Playwright подтверждает только service-link/navigation/local state, не заменяет Product UI review; CharacterWorkspace owner, compact/delete-cancel/scroll-edge и native OS popup остаются ручными/непроверенными осями.
- UIX662 Dice DOM/browser checks использовали controlled synthetic transport; это не реальный серверный бросок и не человеческая визуальная приёмка.
- Inventory audit 48 buckets/90 occurrences (27 PASS / 2 FAIL / 19 BLOCKED) относится к старой revision и не переносится на текущий HEAD. Из 19 blocked восемь buckets были реальными reachable-кандидатами; 11 mixed/isolated/hidden/legacy/preview остаются явно ограниченными. Не оживлять скрытые пути ради зелёного отчёта.
- Проверка current delivery: root and `/acceptance` each `GET` → HTTP 200. First Vite-only relaunch PID 48348 with the wrong worktree-root cwd returned `/` 404; only that QA Vite process was stopped and relaunched as PID 38288 from `apps/web` cwd with the same config. API 14182/DB were not restarted or reseeded.

## Изменения и проверка этого пула

- `.data/qa-prep/acceptance.html` — уточнены действия и safe boundaries; отметки только локально.
- `.data/qa-prep/uix644-local-vite.config.ts` — только QA-only Vite plugin: `/acceptance` отдаёт локальный standalone HTML, а `transformIndexHtml` добавляет нефиксированную in-flow ссылку над dev stand root. Не изменены production App, `apps/web/vite.config.ts` или API.
- `docs/plans/arkenhar-visual-acceptance20261008.md` — текущий scope/гейты.
- **Narrow config check:** TypeScript `tsc --noEmit --skipLibCheck --module ESNext --moduleResolution Bundler --target ES2022 .data/qa-prep/uix644-local-vite.config.ts` exit 0.
- **Playwright receipt (isolated Chromium, read-only GET + localStorage):** desktop 1280×900 and compact 390×844. Injected QA nav visible, in-flow `position:relative`, bounds `x=0,y=0,height=27.19px`; normal stand nav link `Возможности` clicked successfully to `#capabilities-title` at both sizes. Checklist page/title and 28 checkboxes rendered; `b2` unchecked→checked persisted after reload; Reset cleared all; backlink returned to `/`; no page errors in either context. The previous fixed corner overlay did intercept a compact-menu click in the parallel UIX644 run; it has been replaced with the in-flow row and geometry/regular nav click were rechecked.
- **Still pending:** user-run visual acceptance points; UIX644 runtime owner should repeat their compact interaction flow after the safe link-layer change. This receipt verifies the checklist/navigation utility only; it does not pass product UIX644, sticker, native-popup, API/ACL, or production gates.

