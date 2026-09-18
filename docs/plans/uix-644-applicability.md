# UIX-644: применимость оставшихся пунктов реестра

Проверено по исходникам ревизии `c8d76655e737ec48ad2dcc4becc331b912ac379d`. Это разбор достижимости, **не браузерная приёмка и не закрытие UIX-644**. Полный статический реестр сохраняется: ничего не удалено ради зелёного счётчика.

## Доступный интерфейс и оставшаяся работа

- **PlayerRequestsWorkspace: шесть native select.** Исторический CI релизной ревизии успешен, но его dot-log не доказывает каждый именованный случай на текущем CSS. Следующий общий server gate должен включить существующие request cases, не дубли.
- **TokenPalette / GravityFormControls: одна известная ошибка ResizeObserver, отражённая в двух строках.** Она возникла при первом открытии списка персонажа, до Setup. Последующие успешные прогоны не являются исправлением. Следующий шаг — управляемое изменение геометрии первого открытия с сохранением диагностического listener; не повторять прежние warm/cold серии вслепую. Подробности: `token-resize-diagnosis/checkpoint.md` относительно artifactBase реестра.
- **Object list / drawing palette:** дополнительные пользовательские контролы за пределами AST-тегов. Их целостная приёмка не следует из успешных тестов соседнего меню токена. Сохранить самостоятельный scope; native color dialog отдельно от DOM-палитры.
- **Обычные раскрывающиеся блоки:** CharacterWorkspace «Предыстория», InitiativePanel «Очередь ходов», ResourceCounters «Ресурсы» — содержимое потока документа, не всплывающие окна. Проверять доступность раскрытия/сохранность ввода по своим критериям, а не требовать popup Escape/layering.

## Смешанные строки: активный и неактивный код

- **ChatPanels: два listbox.** `activity-slash-suggestions` доступен в Activity; восемь существующих случаев вошли в remaining-menu-gate. `chat-slash-suggestions` принадлежит ChatPanel, но текущая навигация не достигает его: chat-state.ts задаёт TABLE/STORY/ROLLS; sidebar-feed.ts оставляет GM ACTIVITY/STORY, PLAYER ACTIVITY, нормализует прочие значения. Sidebar.tsx для ACTIVITY рендерит ActivityPanel, для STORY — StoryChannel, только оставшаяся ветка рендерит ChatPanel. Нельзя включать старую вкладку ради теста. При изменении списка потоков пересмотреть исключение.
- **CharacterWorkspace: два FormSelect.** Один — активный выбор шаблона в создании персонажа (четыре случая сохранённого built gate). Другой требует showCharacterPicker: единственный нетестовый вызов CharacterPanel в CharacterWorkspace.tsx передаёт false. Его не принимать за второй проверенный шаблон и не активировать.
- **SetupPanel: шесть FormSelect.** Активны previewMembership, tokenCharacter и inviteCharacter; catalogKind находится в безусловном hidden-блоке, два старых select сцен — внутри безусловно hidden секции. Старое управление сценами не возвращать. Четыре built случая активных контролов не доказывают текущий полный lifecycle.

## Отдельно исключённые из игровых popup-сценариев

- DirectChatPanel: directMode инициализирован false, все найденные изменения ставят false; вкладка намеренно скрыта. Native recipient select не является доступным игроку меню сейчас.
- GravityFoundationPreview → FuturePoolDialogs: демонстрационная цепочка. FoundationPreviewRoute только объявлен; нет ссылки на него из действующего entry/router внутри src. Это не обещание отсутствия произвольных внешних импортов или будущего подключения. Не удалять демонстрационные файлы и не объявлять их принятыми.

## Что эта сверка НЕ закрывает

- Единую матрицу UIX-644 на согласованном текущем кандидате; реальные серверные ошибки/права/сохранение; физические устройства.
- Общую разработку Arken Space, текущие Review/In Progress и персональные темы.
- Компактное управление музыкой: music-topbar намеренно скрыт текущим mobile-foundation.css, отсутствие кнопок не равно готовому мобильному сценарию.
- Исходную ошибку ResizeObserver. Счётчик PASS не заменяет устранение причины.

## Следующий связанный блок

Приоритет — воспроизведение первого открытия проблемного Select управляемым изменением размеров, без фильтрации ошибок. Если ограниченная диагностика не воспроизводит сбой, продолжить отдельную проверку object-list/drawing palette, сохранив FAIL. После исправления — связанный owner gate, затем один текущий build/server gate; не повторять CI опубликованного PR81 и не публиковать накопленный кандидат без отдельного разрешения.

## Уточнение достижимости — 2026-09-17

Исходники проверены на `bc3dde8fd170b6c062ceb6e887f616f4861d6de9`: прежний перечень обычных блоков выше не означает, что все три подключены к действующему приложению. `InitiativePanel` экспортируется только в своём файле и импортируется в компонентном тесте; рабочих JSX-вызовов или импортов в `apps/web/src` не найдено. В `concept.spec.ts` существующий сценарий UIX-386 отдельно ожидает отсутствие `.initiative-panel` после загрузки активного encounter. Это не результат нового браузерного прогона и не приёмка действующей очереди encounter. Не включать старый компонент в приложение ради покрытия. Сохранить его статическую строку с явным исключением из текущих игровых сценариев.

Доступные in-flow блоки для адресной проверки: предыстория в CharacterWorkspace и ресурсы в ActivityPanel (ChatPanels.tsx). Для них применимы native summary Enter/Space, реальный pointer, сохранность содержимого при закрытии; popup Escape/outside-close не требуются.

## Occurrence-level reconciliation — 2026-09-19

Оригинальные критерии UIX-644 требуют полного реестра без молчаливых
пропусков и runtime smoke для каждого уникального **места использования**.
Они не требуют включать мёртвый или демонстрационный маршрут ради теста.
Поэтому статические строки не удалены и их исходные статусы/evidence сохранены,
но применимость шестнадцати occurrences теперь зафиксирована отдельно в
`uix-644-runtime-coverage.json`.

- 37 buckets / 76 JSX occurrences остаются неизменным статическим реестром.
- В восьми ранее applicability-blocked buckets находятся 16 occurrences:
  пять поддерживаемых и достижимых уже имеют PASS evidence, одиннадцать имеют
  `NOT_APPLICABLE_CURRENT_PRODUCT` с caller/source evidence и условием повторного
  открытия.
- Смешанные CharacterWorkspace, ChatPanels listbox и SetupPanel не объявлены
  целиком PASS: у каждого активные и недостижимые occurrences перечислены
  отдельно.
- `NOT_APPLICABLE_CURRENT_PRODUCT` закрывает только вопрос применимости в
  инвентаризации. Это не runtime PASS, не waiver и не удаление строки. При
  выполнении `reactivationCriterion` occurrence снова становится обязательным
  для runtime gate.
- FuturePoolDialogs, GravityFoundationPreview, скрытый Direct select и legacy
  InitiativePanel не нужно активировать или удалять для UIX-644. Их подключение
  к production entry/router автоматически отменяет текущую классификацию.

Текущую runtime-приёмку по-прежнему блокируют две независимые границы: один
исторический ResizeObserver-дефект, представленный строками TokenPalette и
GravityFormControls, и browser-owned native popup в поддерживаемом headed
Firefox для OperatorFeedbackFilters. Firefox keyboard/value/focus behavior уже
имеет автоматизированное evidence; ручная граница относится только к видимому
нативному popup, pointer selection и Escape cancel/focus return. UIX-644 остаётся
`INCOMPLETE`.

## Recovered ResizeObserver sequence — 2026-09-19

Это evidence checkpoint, а не закрытие дефекта. Исторический FAIL восстановлен
из `true-browser-zoom-gate/owner-06/token-generator-UIX-272-UI-05f7b--picker-at-desktop-viewport-chromium/trace.zip`,
соседнего `owner-results.json` и `checkpoint-fix-452f5f1.md` относительно
`artifactBase` runtime-ledger.

- Тестировался dev source Git revision
  `452f5f162da51f10fbafcedef92f5d85fc9d36cf`; строка runtime payload
  `buildRevision: test-revision` сама по себе SHA не доказывает, поэтому
  происхождение ревизии фиксируется по соседнему checkpoint.
- Это Chromium, GM, **обычный 100% browser zoom**, viewport `1280×900`, DPR 1.
  Родительская папка true-browser-zoom отражает связанный gate, но этот owner
  FAIL не является 125/150%-zoom repro.
- Точный сценарий: открыть `Новый токен`, выбрать `Explorer.png`, выполнить
  существующие keyboard-переходы image picker и впервые открыть FormSelect
  `Персонаж`. Popup-visible assertion завершился, после чего примерно через
  186 ms был отправлен неотфильтрованный `POST /api/client-logs` с
  `window.error: ResizeObserver loop completed with undelivered notifications`
  (примерно 207 ms после завершения trigger click).
- Следующие screenshot/geometry assertions, Escape, повторные открытия,
  outside-close, ArrowDown/Enter и переход workspace произошли уже после
  ошибки. Они не являются доказанными причинными prerequisites.

Единственный следующий causal gate должен сравнить ровно этот существующий
Chromium desktop сценарий на `452f5f1` и `e03b60e`, при 100%, `1280×900`, без
широких zoom/width/warm-cold sweep. После первого `popup visible` нужно сохранить
оригинальные неотфильтрованные window/client-log errors и наблюдать не менее
исторических 207 ms; bounded окно **500 ms** достаточно для одной проверки.
Адресная временная telemetry может записать identity/constructor stack
ResizeObserver и widths trigger, popup content и floating wrapper на callback,
не превращая gate в глобальный observer dump.

Между указанными ревизиями observer остаётся, а связанный diff меняет popup
content с фиксированного `width` на `minWidth` и добавляет `width: max-content`.
Это правдоподобная стабилизация sizing feedback, но trace не содержит callback
attribution и не доказывает причинность. Если обе ревизии в единственном
old/new gate зелёные, серию не повторять: causal gap остаётся открытым, а fix
не следует изобретать или объявлять подтверждённым по non-reproduction.

## Reachable personal-theme additions — dirty candidate

Историческая база реестра остаётся 37 buckets / 76 JSX occurrences с прежними
статусами и evidence. После base revision
`dfd07bb57e9c176df2642c36650193d24a9dd72d` в незамороженном рабочем кандидате
появились два новых достижимых `FormSelect`. Freeze SHA пока отсутствует и не
подменяется текущим dirty working tree.

- `PlayerThemeSettings.tsx` — один Select в личном диалоге оформления текущего
  campaign membership. Он остаётся `BLOCKED` до exact-frozen evidence из
  `player-theme-preference.spec.ts` для GM/PLAYER desktop/compact и изолированного
  real-server `player-theme-persistence.spec.ts`.
- `MemberDefaultThemeField.tsx` — один GM Select назначения темы участнику в
  Setup. Он не наследует PASS от старых shared-FormSelect проверок и остаётся
  `BLOCKED`, пока preference gate не содержит отдельный runtime case этого
  контрола, а real-server gate не докажет сохранение/default conflict behavior.

Текущий статический снимок с additions — 39 buckets / 78 occurrences, но это не
пересчёт исторических PASS/FAIL/BLOCKED до freeze и runtime evidence. Новая
Base UI кнопка рядом с каждым Select не является раскрывающимся контролом и не
добавляет строку UIX-644. Старые exact-main/menu gates видят общий FormSelect
contract, но не видят эти два новых уникальных reachable места использования.
