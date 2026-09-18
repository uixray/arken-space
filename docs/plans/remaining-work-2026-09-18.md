# Remaining work inventory — 2026-09-18

> Fresh Linear inventory. Workflow status is not implementation status; attachments/PRs/tests/deploys do not prove acceptance.

## Counts

- Total **77**; started **20**; backlog **57**; unstarted **0**.
- core-development: **51**.
- content-or-parallel-game: **11**.
- portfolio: **9**.
- parent-or-acceptance: **6**.

Parent/acceptance issues coordinate or verify child work and are not independent features. Full original descriptions and all semantically matching acceptance/DoD sections are preserved in JSON.

## core-development

| Issue                                                                                                                           | Priority    | Linear      | Parent  | Next action                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [UIX-645](https://linear.app/uixraydesign/issue/UIX-645/arken-space-lucide-kak-edinyj-pak-ikonok-zamenit-vse-simvoly)           | High        | In Progress | —       | Закрыть оставшуюся визуальную приёмку реально отображаемых Lucide-контролов в GM/PLAYER, desktop/compact, keyboard/focus/disabled и темах; сверить receipts, ... |
| [UIX-644](https://linear.app/uixraydesign/issue/UIX-644/arken-space-vse-vypadayushie-menyu-skvoznoj-audit-edinyj-kontrakt)      | High        | In Progress | —       | Выполнить сквозную browser-приёмку общего overlay-контракта и последнего кейса фиксированной zoom-панели: реальное selection-поведение, GM/PLAYER, Chromium/F... |
| [UIX-624](https://linear.app/uixraydesign/issue/UIX-624/mobile-responsive-osnova-vhod-i-navigaciya)                             | High        | In Progress | UIX-316 | Получить однозначный GO на общедоступность кода и документации <issue id="ba47d268-e2ee-4963-910b-3c1aebb9d864" href="https://linear.app/uixraydesign/issue/U... |
| [UIX-507](https://linear.app/uixraydesign/issue/UIX-507/arken-space-mnozhestvennoe-vydelenie-obuektov-shiftklik-i-ramka)        | Medium      | In Review   | —       | Вынести pure selection helpers, добавить characterization tests существующих permission-фильтров, затем подключить Shift+click и Shift+drag без изменения bac... |
| [UIX-502](https://linear.app/uixraydesign/issue/UIX-502/arken-space-render-modal-dropdowns-and-asset-pickers-above-their)       | High        | In Review   | —       | Inspect the picker portal target and shared overlay tokens; route modal-owned popovers to the dialog overlay root rather than increasing arbitrary local z-in... |
| [UIX-411](https://linear.app/uixraydesign/issue/UIX-411/arken-space-net-monitoringa-o-padenii-uznayom-ot-igrokov)               | High        | In Progress | —       | Выбрать внешний мониторинг /healthz и канал уведомлений, явно зафиксировать решение по RPO (сутки либо предыгровой backup), затем проверить alert на недоступ... |
| [UIX-407](https://linear.app/uixraydesign/issue/UIX-407/arken-space-instrumentovka-proizvoditelnosti-klienta-gejt-dlya-uix-398) | High        | In Progress | —       | После отдельного разрешённого deploy снять живые метрики на реальной игре и по данным решить, нужен ли этап C UIX-398 и какой именно; до этого не объявлять и... |
| [UIX-405](https://linear.app/uixraydesign/issue/UIX-405/arken-space-peremeshenie-tokena-na-wasd-i-ping-po-hotkeyu)              | Medium      | In Progress | —       | Реализовать единый canvas-input пул: WASD с grid-aware шагом, подавлением в текстовых полях и ограничением мутаций, плюс Ctrl+click ping; закрепить permissio... |
| [UIX-398](https://linear.app/uixraydesign/issue/UIX-398/arken-space-decompose-apptsx-stabilise-actions-then-split-by-domain)    | High        | In Progress | —       | A0 отдельным коммитом, затем сцены как пилотный домен (6 обработчиков, изолирован).                                                                              |
| [UIX-318](https://linear.app/uixraydesign/issue/UIX-318/arken-space-add-secure-operator-feedback-inbox-and-restore-trusted)     | Medium      | In Progress | —       | Independently verify the production SSH host fingerprint, then perform a read-only report count and metadata-only inventory before designing the staff inbox.    |
| [UIX-317](https://linear.app/uixraydesign/issue/UIX-317/arken-space-sozdat-vizualnuyu-dizajn-sistemu-i-personalnye-temy)        | High        | In Progress | —       | Complete the read-only token/state inventory and prepare the canonical semantic-token schema plus a component-state matrix before changing production CSS.       |
| [UIX-293](https://linear.app/uixraydesign/issue/UIX-293/arken-space-bezopasnyj-zhiznennyj-cikl-fajlov-ispolzovanie-zamena-i)    | High        | In Progress | UIX-271 | Спроектировать usage registry и deletion guard до изменения UI.                                                                                                  |
| [UIX-289](https://linear.app/uixraydesign/issue/UIX-289/arken-space-add-animated-outcome-frames-for-natural-120-and-selected)   | Medium      | In Progress | —       | Inventory `MS0LXIPCEF91V` in Eagle, record format/dimensions/transparency/duration for every candidate, and select one critical plus one fumble frame for a b... |
| [UIX-214](https://linear.app/uixraydesign/issue/UIX-214/arken-space-persistent-drawings-shared-ruler-and-map-navigation)        | Medium      | In Progress | —       | Сверить текущую реализацию с исходным AC по persistence/permissions/undo/shared ruler/navigation и закрыть только непроверенные пункты синхронизационными и m... |
| [UIX-629](https://linear.app/uixraydesign/issue/UIX-629/mobile-fizicheskie-ustrojstva-dostupnost-set-i-proizvoditelnost)        | High        | Backlog     | UIX-316 | Дождаться явного approval плана <issue id="103cce38-2a96-4bb4-9fda-2c847996d2a2" href="https://linear.app/uixraydesign/issue/UIX-316/arken-space-sozdat-polno... |
| [UIX-628](https://linear.app/uixraydesign/issue/UIX-628/mobile-ogranichennyj-gm-rezhim-i-planshetnaya-komponovka)               | High        | Backlog     | UIX-316 | Дождаться явного approval плана <issue id="103cce38-2a96-4bb4-9fda-2c847996d2a2" href="https://linear.app/uixraydesign/issue/UIX-316/arken-space-sozdat-polno... |
| [UIX-627](https://linear.app/uixraydesign/issue/UIX-627/mobile-touch-scenarii-draw-fog-i-ruler)                                 | High        | Backlog     | UIX-316 | Дождаться явного approval плана <issue id="103cce38-2a96-4bb4-9fda-2c847996d2a2" href="https://linear.app/uixraydesign/issue/UIX-316/arken-space-sozdat-polno... |
| [UIX-626](https://linear.app/uixraydesign/issue/UIX-626/mobile-obshij-touch-vvod-karty-pan-pinch-i-upravlyaemye-tokeny)         | High        | Backlog     | UIX-316 | Дождаться явного approval плана <issue id="103cce38-2a96-4bb4-9fda-2c847996d2a2" href="https://linear.app/uixraydesign/issue/UIX-316/arken-space-sozdat-polno... |
| [UIX-625](https://linear.app/uixraydesign/issue/UIX-625/mobile-celnaya-player-sessiya-zhurnal-broski-i-personazh)               | High        | Backlog     | UIX-316 | Дождаться явного approval плана <issue id="103cce38-2a96-4bb4-9fda-2c847996d2a2" href="https://linear.app/uixraydesign/issue/UIX-316/arken-space-sozdat-polno... |
| [UIX-622](https://linear.app/uixraydesign/issue/UIX-622/arken-spacerandd-issledovat-karmicheskuyu-psevdosluchajnost-broskov-v)  | Low         | Backlog     | —       | Сначала описать текущую server-side dice pipeline и baseline-распределение, затем подготовить research note и simulation harness. До завершения анализа не вы... |
| [UIX-588](https://linear.app/uixraydesign/issue/UIX-588/arken-space-dobavit-resurs-vdohnovenie-dlya-perebrosov)                 | Low         | Backlog     | —       | Зафиксировать четыре правила расхода — допустимые броски, срок применения, выбор результата и максимум ресурса — затем встроить действие в существующий audit... |
| [UIX-527](https://linear.app/uixraydesign/issue/UIX-527/arken-space-sostav-gruppy-konfiguraciya-a-ne-konstanta-v-kode)          | Low         | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-526](https://linear.app/uixraydesign/issue/UIX-526/arken-space-onbording-pervyj-vhod-bez-chuzhoj-pomoshi)                  | Low         | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-525](https://linear.app/uixraydesign/issue/UIX-525/arken-space-master-sozdayot-svoyu-kampaniyu-izolyaciya-vmesto-odnoj)    | Low         | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-512](https://linear.app/uixraydesign/issue/UIX-512/arken-space-saundpad-s-obshimi-pakami-situativnyh-zvukov)               | Medium      | Backlog     | —       | Сначала определить event contract, лимиты и независимую Effects audio bus; не расширять persistent music transport одноразовыми эффектами.                       |
| [UIX-510](https://linear.app/uixraydesign/issue/UIX-510/randd-adaptivnyj-kontrast-linejki-otnositelno-fona-karty)               | Low         | Backlog     | UIX-509 | После выпуска стабильных персональных цветов собрать isolated renderer prototype и сравнить читаемость/стоимость трёх подходов.                                  |
| [UIX-509](https://linear.app/uixraydesign/issue/UIX-509/arken-space-personalnye-cveta-lineek-igrokov-i-kontrastnoe-svechenie)   | Medium      | Backlog     | —       | Проверить membership IDs кампании, определить hex + outline pairs, вынести pure resolver и затем заменить единый `visual.color.edit` в ruler render path.        |
| [UIX-508](https://linear.app/uixraydesign/issue/UIX-508/arken-space-animirovannyj-mayachok-pinga-padenie-udarnoe-kolco-i)       | Medium      | Backlog     | —       | Вынести pure motion timeline и отдельный `AnimatedMapPing` с imperative Konva animation/cleanup, затем заменить статический Group без изменения realtime-кода.   |
| [UIX-506](https://linear.app/uixraydesign/issue/UIX-506/arken-space-ajdentika-arkspejs-ikonka-favicon-i-kirillicheskij)         | Medium      | Backlog     | —       | Сгенерировать три концепта иконки и собрать компактный лист сравнения с wordmark «Аркспейс».                                                                     |
| [UIX-505](https://linear.app/uixraydesign/issue/UIX-505/arken-space-hide-player-turn-order-until-an-encounter-is-active)        | Medium      | Backlog     | —       | Derive PLAYER turn-order rendering from the active authorized encounter selector and characterize GM pre-combat requirements before changing shared markup.      |
| [UIX-496](https://linear.app/uixraydesign/issue/UIX-496/igrok-hochet-sam-dobavlyat-navyki-i-bonusy-v-svoyu-kolonku)             | Medium      | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-495](https://linear.app/uixraydesign/issue/UIX-495/zametki-ob-npc-v-kartochke-personazha)                                  | Low         | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-480](https://linear.app/uixraydesign/issue/UIX-480/arken-space-add-decorative-cartographic-location-labels)                | Low         | Backlog     | —       | Prepare two visual variants and define whether labels are a scene-title property, a location-marker property, or both.                                           |
| [UIX-473](https://linear.app/uixraydesign/issue/UIX-473/arken-space-razobrat-ochered-otchyotov-iz-knopki-soobshit-9)            | High        | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-459](https://linear.app/uixraydesign/issue/UIX-459/arken-space-prokachka-sposobnostej-za-sp-otdelnyj-razdel-upravleniya)   | Medium      | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-458](https://linear.app/uixraydesign/issue/UIX-458/arken-space-shkoly-magii-derevo-sposobnostej-redaktor-i-dostupnye)      | High        | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-457](https://linear.app/uixraydesign/issue/UIX-457/arken-space-ramki-dlya-broskov-svoya-u-igroka-svoya-u-skilla-i-shkoly)  | Medium      | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-430](https://linear.app/uixraydesign/issue/UIX-430/arken-space-oblast-dejstviya-sposobnosti-primenenie-ko-vsem-soyuznikam) | Low         | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-429](https://linear.app/uixraydesign/issue/UIX-429/arken-space-okno-prokachki-igrok-zayavlyaet-vlozhenie-ochkov-master)    | Low         | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-420](https://linear.app/uixraydesign/issue/UIX-420/arken-space-panel-instrumentov-karty-hotkei-v-podskazkah-i-gruppirovka) | Medium      | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-412](https://linear.app/uixraydesign/issue/UIX-412/arken-space-tochechnye-sobytiya-vmesto-polnoj-rassylki-snapshota)       | Medium      | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-382](https://linear.app/uixraydesign/issue/UIX-382/arken-space-design-multi-track-soundtrack-mixer-with-per-track-and)     | Medium      | Backlog     | —       | Approve transport semantics and a bounded maximum track count, then define the audio-state migration and client mixer contract.                                  |
| [UIX-379](https://linear.app/uixraydesign/issue/UIX-379/arken-space-add-player-achievement-collection-and-gm-achievement)       | Low         | Backlog     | —       | Define visibility and asset-selection rules, then prototype a small achievement-card model before implementation.                                                |
| [UIX-365](https://linear.app/uixraydesign/issue/UIX-365/arken-space-redesign-direct-messages-mechanic-before-re-enabling)       | No priority | Backlog     | —       | Scope the design questions above with the user before touching code.                                                                                             |
| [UIX-347](https://linear.app/uixraydesign/issue/UIX-347/arken-space-add-reusable-terrain-stamp-brushes-for-scene-drawing)       | Low         | Backlog     | —       | Prototype the data model and renderer performance with one curated pack and 100–500 placed stamps before designing pack management.                              |
| [UIX-314](https://linear.app/uixraydesign/issue/UIX-314/arken-space-render-fully-opaque-animated-cloud-texture-over-fog)        | Low         | Backlog     | —       | Prototype one low-resolution Canvas2D cloud layer over a fixed opaque mask and measure frame time/memory before selecting final art or WebGL.                    |
| [UIX-269](https://linear.app/uixraydesign/issue/UIX-269/arken-space-prototype-a-safe-bidirectional-telegram-bridge-for-story)   | Medium      | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-265](https://linear.app/uixraydesign/issue/UIX-265/arken-space-design-regional-economy-and-server-authoritative-shops)     | Low         | Backlog     | —       | Leave in backlog until item instances and calendar contracts are approved.                                                                                       |
| [UIX-264](https://linear.app/uixraydesign/issue/UIX-264/arken-space-build-gm-world-entity-and-campaign-instance-manager)        | Medium      | Backlog     | UIX-245 | Approve the canonical-vs-instance boundary and minimal field matrix for each entity type.                                                                        |
| [UIX-263](https://linear.app/uixraydesign/issue/UIX-263/arken-space-import-and-reconcile-tilda-framer-and-eagle-world-content)  | Medium      | Backlog     | UIX-245 | Produce a read-only inventory and conflict matrix before implementing or importing data.                                                                         |
| [UIX-262](https://linear.app/uixraydesign/issue/UIX-262/arken-space-model-versioned-spell-school-progression-graphs)            | Medium      | Backlog     | UIX-209 | Produce a structured inventory of every 2024 school/node/edge and an ambiguity report, then review it with the GM before any production seed/import.             |

## content-or-parallel-game

| Issue                                                                                                                          | Priority    | Linear      | Parent  | Next action                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------- | ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [UIX-647](https://linear.app/uixraydesign/issue/UIX-647/arkpath-pozdravitelnaya-kampaniya-mishi-pro-ptusika-mortedo)           | No priority | In Progress | UIX-364 | Провести неподтверждённую человеческую приёмку 10–30 минут и физический mobile/Safari прогон; затем отдельно решить release gate для нового режима, не переис... |
| [UIX-572](https://linear.app/uixraydesign/issue/UIX-572/misha-dispatch-sproektirovat-rasshiryaemuyu-igru-magicheskoj)          | Medium      | In Progress | —       | Собрать архитектурный и UX-бриф вертикального среза, затем начать локальную реализацию в изолированном модуле.                                                   |
| [UIX-364](https://linear.app/uixraydesign/issue/UIX-364/napolnit-lichnye-stranichki-igrokov-kontentom)                         | No priority | In Progress | —       | Собрать у каждого игрока материалы по его персонажам, затем наполнить соответствующий index.html.                                                                |
| [UIX-652](https://linear.app/uixraydesign/issue/UIX-652/arken-space-podrobnyj-lending-vozmozhnostej-i-strukturirovannaya-baza) | Low         | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-649](https://linear.app/uixraydesign/issue/UIX-649/dobavit-gotovyj-stiker-pak-arken-hara-v-arken-space)                   | No priority | Backlog     | —       | Ожидать отдельного разрешения пользователя на дальнейшую работу. Для будущей интеграции использовать сохранённую ручную выгрузку; повторный экспорт, генераци... |
| [UIX-591](https://linear.app/uixraydesign/issue/UIX-591/arken-spacerandd-mnogoetazhnaya-taverna-izometriya-i-top-down-karta)   | Low         | Backlog     | —       | Read-only найти канонический asset таверны и связанные материалы, затем сделать локальный floor/room inventory без изменения production.                         |
| [UIX-590](https://linear.app/uixraydesign/issue/UIX-590/arken-space-sobrat-dlya-semyona-zapasnoj-gm-pak-tokenov-iz-proshlyh)   | Medium      | Backlog     | —       | Определить кампанию Семёна, затем сделать read-only выборку кандидатов в Eagle с provenance и превью до загрузки в сервис.                                       |
| [UIX-499](https://linear.app/uixraydesign/issue/UIX-499/arken-space-mini-igra-ugadaj-personazha-po-stikeru-s-otkrytiem-bukv)   | Medium      | Backlog     | —       | До реализации выбрать MVP-механику раунда и определить безопасную схему данных, при которой правильный ответ не передаётся клиенту заранее.                      |
| [UIX-497](https://linear.app/uixraydesign/issue/UIX-497/zalit-pak-iz-27-stikerov-i-dat-masteru-interfejs-zagruzki)             | Medium      | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-461](https://linear.app/uixraydesign/issue/UIX-461/arken-space-generatory-navykovartefaktov-i-vnutriigrovaya-vitrina)     | Low         | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |
| [UIX-378](https://linear.app/uixraydesign/issue/UIX-378/sdelat-webar-prosmotr-oblozhki-rubinovyj-orden-na-arken-kharspace)     | Medium      | Backlog     | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |

## portfolio

| Issue                                                                                                                           | Priority | Linear  | Parent  | Next action                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------- | -------------------------------------------------------------------------------------------------- |
| [UIX-661](https://linear.app/uixraydesign/issue/UIX-661/sobrat-i-opublikovat-portfolio-case-po-arken-space)                     | High     | Backlog | UIX-653 | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria. |
| [UIX-660](https://linear.app/uixraydesign/issue/UIX-660/provesti-usability-testing-i-izmerit-uluchsheniya-klyuchevogo-first)    | High     | Backlog | UIX-653 | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria. |
| [UIX-659](https://linear.app/uixraydesign/issue/UIX-659/oformit-dizajn-sistemu-arken-space-kak-chast-produktovogo-kejsa)        | Medium   | Backlog | UIX-653 | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria. |
| [UIX-658](https://linear.app/uixraydesign/issue/UIX-658/provesti-ux-audit-i-dovesti-klyuchevye-scenarii-arken-space-do-urovnya) | Medium   | Backlog | UIX-653 | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria. |
| [UIX-657](https://linear.app/uixraydesign/issue/UIX-657/sdelat-produktovuyu-obolochku-arken-space-dlya-neznakomogo)             | High     | Backlog | UIX-653 | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria. |
| [UIX-656](https://linear.app/uixraydesign/issue/UIX-656/sformulirovat-pozicionirovanie-produktovye-principy-i-scope-publichnoj) | High     | Backlog | UIX-653 | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria. |
| [UIX-655](https://linear.app/uixraydesign/issue/UIX-655/provesti-polzovatelskoe-issledovanie-gm-i-proverit-produktovye)         | High     | Backlog | UIX-653 | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria. |
| [UIX-654](https://linear.app/uixraydesign/issue/UIX-654/provesti-konkurentnoe-issledovanie-vtt-rynka-i-najti-prostranstvo-dlya) | High     | Backlog | UIX-653 | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria. |
| [UIX-653](https://linear.app/uixraydesign/issue/UIX-653/prevratit-arken-space-iz-pet-project-v-polnocennyj-produktovyj-kejs)    | High     | Backlog | —       | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria. |

## parent-or-acceptance

| Issue                                                                                                                           | Priority    | Linear    | Parent | Next action                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [UIX-642](https://linear.app/uixraydesign/issue/UIX-642/arken-space-integrirovat-tekushij-pr-pul-i-opublikovat-reliz-2026-09)   | High        | In Review | —      | Сначала снять точный public-publication blocker и получить зелёный CI <issue id="ba47d268-e2ee-4963-910b-3c1aebb9d864" href="https://linear.app/uixraydesign/... |
| [UIX-585](https://linear.app/uixraydesign/issue/UIX-585/arken-space-integrirovat-gotovye-zadachi-i-provesti-production-release) | High        | In Review | —      | Создать интеграционную ветку от свежего origin/main, включить готовые ветки в безопасном порядке и разрешить migration collision до запуска полного gate.        |
| [UIX-316](https://linear.app/uixraydesign/issue/UIX-316/arken-space-sozdat-polnocennuyu-mobilnuyu-i-planshetnuyu-versiyu)       | High        | In Review | —      | Провести discovery pool: зафиксировать device matrix, mobile IA и отдельные PLAYER/GM journey maps, затем утвердить Player MVP и desktop-only границы до изме... |
| [UIX-371](https://linear.app/uixraydesign/issue/UIX-371/arken-space-manual-qa-checklist-nakopitelnyj-spisok-dlya-ruchnogo)      | No priority | Backlog   | —      | Прогнать целиком одним заходом, отметить проваленные пункты — заведём отдельные баги под каждый провал.                                                          |
| [UIX-245](https://linear.app/uixraydesign/issue/UIX-245/arken-space-build-world-encyclopedia-and-campaign-chronicles)           | Medium      | Backlog   | —      | Complete a source inventory and conflict matrix, then approve the canonical world entity and media provenance contracts before importing any content.            |
| [UIX-217](https://linear.app/uixraydesign/issue/UIX-217/arken-space-full-product-gm-6-acceptance-rehearsal)                     | High        | Backlog   | —      | Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.                                                               |

## Per-issue original acceptance and gaps

### UIX-647 — ARKPATH: поздравительная кампания Миши про Птусика Мортедо

- Category **content-or-parallel-game**; Linear **In Progress**; implementation **Unknown.**
- Source [UIX-647](https://linear.app/uixraydesign/issue/UIX-647/arkpath-pozdravitelnaya-kampaniya-mishi-pro-ptusika-mortedo); parent UIX-364.
- Next action: Провести неподтверждённую человеческую приёмку 10–30 минут и физический mobile/Safari прогон; затем отдельно решить release gate для нового режима, не переиспользуя исторический gate.
- Dependencies: parent:UIX-364.
- Original acceptance / DoD sections:

## Критерии готовности кампании

- Исходная история Птусика, Мортедо, Пауля и конфликта с Дестонами не подменена новыми утверждениями.
- Птусик не заменяет Леонарда молча; отдельный режим/сохранение согласован.
- Пользователь утвердил узнаваемость арта и сценарий с поздравительным финалом.
- Реплики распределены между друзьями, согласованы и записаны; субтитры/беззвучное прохождение доступны.
- Мобильное прохождение, повторный запуск и отсутствие повреждения основной кампании проверены.
- Публикация только отдельным запросом после gate.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-645 — [arken-space] Lucide как единый пак иконок: заменить все символы-псевдоиконки и запретить их возврат

- Category **core-development**; Linear **In Progress**; implementation **Unknown.**
- Source [UIX-645](https://linear.app/uixraydesign/issue/UIX-645/arken-space-lucide-kak-edinyj-pak-ikonok-zamenit-vse-simvoly); parent none.
- Next action: Закрыть оставшуюся визуальную приёмку реально отображаемых Lucide-контролов в GM/PLAYER, desktop/compact, keyboard/focus/disabled и темах; сверить receipts, hit-area и итоговый bundle.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- [x] Официальный Lucide скачан, подключён к web package, версия зафиксирована в manifest/lockfile; лицензия сохранена пакетом. Подключение уже интегрировано в main; повторная установка не требуется.
- [x] Есть общий documented import/accessibility contract и реальное использование SVG в приложении. AppIcon + icons.ts используются в интегрированном интерфейсе; SVG/accessibility contract подтверждён компонентными проверками.
- [ ] Все места из полного migration checklist переведены; Unicode/emoji/text glyphs больше не выступают UI-иконками.
- [ ] Иконки соответствуют действию, единообразны по размеру/stroke/выравниванию, используют currentColor и корректные hover/disabled/focus states.
- [ ] Icon-only buttons имеют понятные accessible names; декоративные SVG скрыты от accessibility tree, не создают лишний tab stop; при необходимости tooltip дополняет, а не заменяет имя.
- [ ] Работают desktop/compact, GM/PLAYER, клавиатура, темы и контраст; hit-area не уменьшаются.
- [ ] Нет runtime CDN и импорта всего каталога в итоговый bundle; typecheck/build и unit/browser проверки проходят.
- [ ] Есть автоматическая защита от повторного добавления псевдоиконок, проверенная отрицательным примером; исключения допустимы только для реального текста/контента, не для новых UI-иконок.
- [ ] Наличие пакета само по себе не закрывает задачу: полная замена, QA и anti-regression gate обязательны.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-644 — [arken-space] Все выпадающие меню: сквозной аудит, единый контракт слоёв и защита от повторных регрессий

- Category **core-development**; Linear **In Progress**; implementation **Evidence linked; implementation/acceptance not inferred.**
- Source [UIX-644](https://linear.app/uixraydesign/issue/UIX-644/arken-space-vse-vypadayushie-menyu-skvoznoj-audit-edinyj-kontrakt); parent none.
- Next action: Выполнить сквозную browser-приёмку общего overlay-контракта и последнего кейса фиксированной zoom-панели: реальное selection-поведение, GM/PLAYER, Chromium/Firefox и compact layout.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- [ ] Все найденные меню включены в проверяемый реестр; у каждого PASS / FAIL / BLOCKED с evidence, без молчаливых пропусков.
- [ ] Выбор карты/сцены реально открывается, виден и выбирается мышью и клавиатурой.
- [ ] Нет обрезания, перекрытия canvas/панелями/dialog, некорректного stacking/portal owner и invisible click interception.
- [ ] Проверены open/select/close, outside click, Escape, focus return, повторное открытие и смена workspace; keyboard semantics соответствуют типу контрола.
- [ ] Проверены обычная страница, скроллируемая панель, modal и nested modal, GM/PLAYER, desktop/compact, границы viewport, scroll/resize и browser zoom.
- [ ] Chromium и Firefox: реальные pointer clicks/hit-testing без force; DOM `open`, видимость trigger или наличие menu в DOM не считаются достаточной приёмкой.
- [ ] Общие причины покрыты регрессиями; каждое уникальное место использования имеет runtime smoke. Проверка всей матрицы выполняется одним gate, не после каждой микроправки.
- [ ] Задокументированы правило подключения новых меню и регрессионный чек, который не даст вернуть этот класс ошибок.
- [ ] Не закрывать по одному исправленному меню или старому зелёному CI; непроверенные ручные сценарии явно остаются открытыми.

### Обязательные критерии этого случая

- [ ] Панель масштаба остаётся компактной: размер и привязка в пределах одного viewport не меняются при 0 / 1 / нескольких выбранных токенах, рисунках или смешанном selection, при deselect и Escape.
- [ ] Не показывать в постоянном canvas HUD/панелях счётчики выбранных объектов, токенов и рисунков. Не переносить тот же ненужный счётчик в другую плашку.
- [ ] Selection-dependent controls не раздувают zoom panel. Сохранить доступность bulk actions/подтверждения удаления, но отделить их от фиксированного zoom cluster.
- [ ] «Фиксированная» означает стабильную геометрию панели, НЕ запрет изменения масштаба карты. +/−, slider, процент и «Вписать» продолжают работать.
- [ ] Не ломать Shift+click/marquee, pan, групповой move/delete, permissions, scene switch и compact layout.
- [ ] Добавить browser regression с сравнением bounding box панели до/после selection и отсутствием видимого счётчика; GM/PLAYER, Chromium/Firefox. Проверять реальное выделение, не только DOM open/видимость.
- [ ] E2E `tests/e2e/canvas-token-regressions.spec.ts` сейчас проверяет selection по этому тексту. Перевести проверки на фактическое состояние/поведение объектов, сохранив покрытие множественного выделения; не оставлять ненужный UI ради тестов.

**Решение по задачам:** вести как ещё один случай в общем <issue id="61a141b8-eafa-4113-ba26-706833d17483" href="https://linear.app/uixraydesign/issue/UIX-644/arken-space-vse-vypadayushie-menyu-skvoznoj-audit-edinyj-kontrakt">UIX-644</issue>, без новой однотипной карточки. Старое требование <issue id="02c32842-9831-4dfe-bc8a-10edbb134ef2" href="https://linear.app/uixraydesign/issue/UIX-507/arken-space-mnozhestvennoe-vydelenie-obuektov-shiftklik-i-ramka">UIX-507</issue> о постоянном счётчике отменено новым решением владельца. Код в этой боковой сессии не изменялся.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-642 — [arken-space] Интегрировать текущий PR-пул и опубликовать релиз 2026-09-05

- Category **parent-or-acceptance**; Linear **In Review**; implementation **Evidence linked; implementation/acceptance not inferred.**
- Source [UIX-642](https://linear.app/uixraydesign/issue/UIX-642/arken-space-integrirovat-tekushij-pr-pul-i-opublikovat-reliz-2026-09); parent none.
- Next action: Сверить текущие candidate SHA, origin/main и deployed SHA, затем выполнять только ещё не пройденные release-gate проверки; production publication требует актуального явного разрешения и не наследует исторические blockers.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Зафиксировать exact head/base SHA выбранных PR и актуальный main; не считать старый sibling CI интеграционным PASS.
- Перед merge каждого PR проверить destination/main, неизменность проверенного head, все checks/e2e/multiplayer; после каждого merge проверить новый main/CI. Branch protection сейчас отсутствует, gate обеспечивает оператор.
- На точном итоговом main SHA получить полный quality/E2E/Docker multiplayer, migration compatibility и non-live image/audio smoke. Retry/flaky/skips и локальные FAIL фиксировать честно.
- До deployment: проверка текущего host/DNS/TLS/nginx/env permissions/disk, свежий точный restic snapshot, exact-snapshot restore rehearsal, rollback server/web image IDs.
- Выпуск только exact reviewed main SHA через двухфазный infra/deploy/release.sh; не запускать production-changing phase до completed gate. Не загружать тестовые media в live, не делать gameplay reset.
- Post-deploy health/schema/revision, auth/session/logout/WebSocket и scoped GM/PLAYER browser/persistence smoke; при провале остановить rollout и использовать сохранённый rollback.
- <issue id="929cdefd-795d-457f-a441-ed4a2812d24f" href="https://linear.app/uixraydesign/issue/UIX-217/arken-space-full-product-gm-6-acceptance-rehearsal">UIX-217</issue> human 30–45 минут / GM+6 и hardware mobile acceptance остаются отдельно; автоматический PASS не означает их выполнение и не разрешает формальный Done.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-624 — [mobile] Responsive-основа, вход и навигация

- Category **core-development**; Linear **In Progress**; implementation **Evidence linked; implementation/acceptance not inferred.**
- Source [UIX-624](https://linear.app/uixraydesign/issue/UIX-624/mobile-responsive-osnova-vhod-i-navigaciya); parent UIX-316.
- Next action: Сверить текущую mobile/responsive реализацию с исходным AC на узком и desktop viewport, выделить ещё не доказанные вход/навигацию/overlay состояния и закрыть их одним проверяемым responsive-пулом без изменения publication scope.
- Dependencies: parent:UIX-316, blocks:UIX-629, blocks:UIX-626, blocks:UIX-625.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Утверждены IA, поддерживаемая ширина/матрица и ownership общих styles с <issue id="9f8a3f7a-be5d-4b96-ac53-a0703953d990" href="https://linear.app/uixraydesign/issue/UIX-317/arken-space-sozdat-vizualnuyu-dizajn-sistemu-i-personalnye-temy">UIX-317</issue> до кода.
- В согласованном диапазоне нет горизонтального overflow; карта, журнал и персонаж достижимы предсказуемо, controls имеют hit-area ≥44×44.
- Скрытые области не активны и не входят в Tab-порядок; keyboard/focus/return и retained state проверены.
- Desktop auth/navigation/overlays не регрессируют; существующие <issue id="8c1f7a7b-afa4-45ae-8b24-0ac43f07ee8d" href="https://linear.app/uixraydesign/issue/UIX-225/arken-space-fix-responsive-shell-non-blocking-dialogs-and-workspace">UIX-225</issue>/254/415/416/502 переиспользуются, не реализуются повторно.
- После связанного implementation-пула: адресная диверсия нового теста, format → lint → typecheck → build → test и E2E; realtime/access/save changes дополнительно multiplayer. CI обязателен.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-585 — [arken-space] Интегрировать готовые задачи и провести production release 2026-09-02

- Category **parent-or-acceptance**; Linear **In Review**; implementation **Evidence linked; implementation/acceptance not inferred.**
- Source [UIX-585](https://linear.app/uixraydesign/issue/UIX-585/arken-space-integrirovat-gotovye-zadachi-i-provesti-production-release); parent none.
- Next action: Создать интеграционную ветку от свежего origin/main, включить готовые ветки в безопасном порядке и разрешить migration collision до запуска полного gate.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Все включённые ветки интегрированы без потери истории; ветки Claude не переписываются.
- Конфликт миграций magic-стека и <issue id="368db483-63b1-45dc-bc80-48652707a898" href="https://linear.app/uixraydesign/issue/UIX-582/arken-space-pereryv-server-avtoritetnoe-sostoyanie-komanda-i-snapshot">UIX-582</issue> разрешён последовательной миграцией.
- На точной ревизии release candidate явно пройдены format, lint, typecheck, build, test, e2e и multiplayer.
- Новый интеграционный тест подтверждён диверсией.
- GitHub CI зелёный до merge.
- Production preflight включает restic check, свежий backup и изолированную restore rehearsal точного SHA.
- Deploy выполняется только точного подтверждённого SHA, после чего проверяются health, auth, websocket и базовый browser smoke.
- При отсутствии SSH/production-доступа блокер зафиксирован без ложного заявления о публикации.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-572 — [Misha Dispatch] Спроектировать расширяемую игру магической диспетчерской

- Category **content-or-parallel-game**; Linear **In Progress**; implementation **Unknown.**
- Source [UIX-572](https://linear.app/uixraydesign/issue/UIX-572/misha-dispatch-sproektirovat-rasshiryaemuyu-igru-magicheskoj); parent none.
- Next action: Собрать архитектурный и UX-бриф вертикального среза, затем начать локальную реализацию в изолированном модуле.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Игровой цикл включает карту происшествий, ростер магов, назначение команды, выполнение миссии, промежуточное решение и последствия.
- У магов есть различающиеся характеристики, стихии, особенности, усталость и отношения.
- Задания требуют осмысленного подбора команды; интерфейс объясняет риск без раскрытия точной формулы.
- Состояние смены сохраняется локально и восстанавливается после перезагрузки.
- Игровой движок и данные отделены от DOM-рендера, чтобы модуль можно было перенести в отдельный проект.
- Есть полноценный сценарий одной смены, а не декоративная демо-карточка.
- Пройдены desktop/mobile QA, проверка клавиатуры и reduced-motion.
- Production-публикация выполняется только после отдельного review gate.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-507 — [arken-space] Множественное выделение объектов: Shift+клик и рамка области

- Category **core-development**; Linear **In Review**; implementation **Evidence linked; implementation/acceptance not inferred.**
- Source [UIX-507](https://linear.app/uixraydesign/issue/UIX-507/arken-space-mnozhestvennoe-vydelenie-obuektov-shiftklik-i-ramka); parent none.
- Next action: Вынести pure selection helpers, добавить characterization tests существующих permission-фильтров, затем подключить Shift+click и Shift+drag без изменения backend contract.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Shift+клик работает для токенов и рисунков и повторный Shift+клик снимает конкретный объект.
- Shift+drag по пустому канвасу показывает рамку и выбирает пересекающиеся объекты.
- PLAYER может выбрать только видимые и управляемые им объекты; туман, GM-layer, locked и чужие объекты не раскрываются и не попадают в выбор.
- GM может выбирать разрешённые редактируемые токены и рисунки; MAP-layer и locked-объекты не попадают в bulk mutation.
- Начало marquee не конфликтует с pan, drag токена, Draw/Fog/Ruler, SCENE_REGION и контекстным меню.
- По решению владельца от 06.09.2026 постоянные счётчики выбранных объектов/токенов/рисунков в canvas HUD и панелях НЕ показываются. Панель масштаба сохраняет геометрию при selection/deselect; Escape/клик по пустому месту очищает выбор. Исправление и browser regression ведутся в <issue id="61a141b8-eafa-4113-ba26-706833d17483" href="https://linear.app/uixraydesign/issue/UIX-644/arken-space-vse-vypadayushie-menyu-skvoznoj-audit-edinyj-kontrakt">UIX-644</issue>.
- Drag любого элемента выбранной группы использует существующий queued bulk move с rollback/resync при конфликте.
- Bulk delete показывает подтверждение с количеством и типами объектов.
- Selection очищается или пересчитывается после удаления, смены сцены, resync и потери visibility/access.
- Есть unit-тесты selection reducer/geometry/permissions и browser E2E для GM и PLAYER.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-502 — [arken-space] Render modal dropdowns and asset pickers above their dialog

- Category **core-development**; Linear **In Review**; implementation **Evidence linked; implementation/acceptance not inferred.**
- Source [UIX-502](https://linear.app/uixraydesign/issue/UIX-502/arken-space-render-modal-dropdowns-and-asset-pickers-above-their); parent none.
- Next action: Inspect the picker portal target and shared overlay tokens; route modal-owned popovers to the dialog overlay root rather than increasing arbitrary local z-index values.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- The token image/character asset picker menu renders fully above the token modal.
- The fix applies consistently to dropdowns, comboboxes and popovers inside workspace dialogs.
- Overlay order is explicit: base content < workspace overlays < modal backdrop/surface < modal-owned popover < nested dialog.
- Menus are not clipped by modal overflow, transforms or ancestor stacking contexts.
- Clicking outside, Escape, focus return and keyboard navigation continue to work.
- A modal-owned menu does not appear above a newer unrelated/nested modal.
- Add a component or browser regression covering an asset picker opened inside the token modal.
- Verify at narrow and desktop viewport widths.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-411 — [arken-space] Нет мониторинга: о падении узнаём от игроков

- Category **core-development**; Linear **In Progress**; implementation **Unknown.**
- Source [UIX-411](https://linear.app/uixraydesign/issue/UIX-411/arken-space-net-monitoringa-o-padenii-uznayom-ot-igrokov); parent none.
- Next action: Выбрать внешний мониторинг /healthz и канал уведомлений, явно зафиксировать решение по RPO (сутки либо предыгровой backup), затем проверить alert на недоступности и неожиданной ревизии.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Недоступность прода даёт уведомление в течение нескольких минут.
- Проверка живёт вне хоста arken.
- Решение по RPO записано явно: либо сутки приняты, либо добавлен предыгровой бэкап.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-407 — [arken-space] Инструментовка производительности клиента (гейт для UIX-398 этап C)

- Category **core-development**; Linear **In Progress**; implementation **Unknown.**
- Source [UIX-407](https://linear.app/uixraydesign/issue/UIX-407/arken-space-instrumentovka-proizvoditelnosti-klienta-gejt-dlya-uix-398); parent none.
- Next action: После отдельного разрешённого deploy снять живые метрики на реальной игре и по данным решить, нужен ли этап C UIX-398 и какой именно; до этого не объявлять инструментирование принятым.
- Dependencies: none returned.
- Original acceptance / DoD sections:

No semantically matching acceptance/DoD heading; consult the untouched full original description in JSON.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-405 — [arken-space] Перемещение токена на WASD и пинг по хоткею

- Category **core-development**; Linear **In Progress**; implementation **Evidence linked; implementation/acceptance not inferred.**
- Source [UIX-405](https://linear.app/uixraydesign/issue/UIX-405/arken-space-peremeshenie-tokena-na-wasd-i-ping-po-hotkeyu); parent none.
- Next action: Реализовать единый canvas-input пул: WASD с grid-aware шагом, подавлением в текстовых полях и ограничением мутаций, плюс Ctrl+click ping; закрепить permission и key-repeat тестами.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- WASD двигают выбранный токен на клетку (или заданный шаг без сетки).
- Ввод в текстовых полях не перехватывается.
- Удержание клавиши не порождает поток запросов; закреплено тестом.
- Ctrl+клик ставит пинг, видимый остальным.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-398 — [arken-space] Decompose App.tsx: stabilise actions, then split by domain

- Category **core-development**; Linear **In Progress**; implementation **Unknown.**
- Source [UIX-398](https://linear.app/uixraydesign/issue/UIX-398/arken-space-decompose-apptsx-stabilise-actions-then-split-by-domain); parent none.
- Next action: A0 отдельным коммитом, затем сцены как пилотный домен (6 обработчиков, изолирован).
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Ссылки на обработчики не меняются между рендерами; закреплено тестом.
- Число пропсов `Sidebar` измеримо сокращается (ожидаемо 83 → \~15).
- В контексте действий нет изменяемых значений; закреплено тестом.
- Поведение не меняется ни на одном шаге — это рефакторинг. Каждый домен отдельным коммитом с зелёным полным прогоном.
- Этап C не начинается без замеров.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-364 — Наполнить личные странички игроков контентом

- Category **content-or-parallel-game**; Linear **In Progress**; implementation **Unknown.**
- Source [UIX-364](https://linear.app/uixraydesign/issue/UIX-364/napolnit-lichnye-stranichki-igrokov-kontentom); parent none.
- Next action: Собрать у каждого игрока материалы по его персонажам, затем наполнить соответствующий index.html.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Каждая страница отражает конкретного игрока: персонажи из кампании (прошлые и текущие), личные детали, которые игрок готов показать.
- Кнопка "Войти в игру" сохраняется на каждой странице.
- Изменения закоммичены в репозиторий и задеплоены на сервер (копия в `/var/www/arken-khar-players/<handle>.arken-khar.space/`).

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-318 — [arken-space] Add secure operator feedback inbox and restore trusted access

- Category **core-development**; Linear **In Progress**; implementation **Unknown.**
- Source [UIX-318](https://linear.app/uixraydesign/issue/UIX-318/arken-space-add-secure-operator-feedback-inbox-and-restore-trusted); parent none.
- Next action: Independently verify the production SSH host fingerprint, then perform a read-only report count and metadata-only inventory before designing the staff inbox.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- The current production host identity is independently verified before replacing any SSH known-host entry.
- The reason for the host-key change is recorded privately.
- Authorized operators can list reports by date, kind, status and build without direct unrestricted database access.
- Report details expose only the fields needed for triage.
- Contact information, diagnostics and screenshots are protected as sensitive data and revealed only when explicitly opened by an authorized operator.
- Attachment storage keys and internal paths are never returned as public URLs.
- Access requires a dedicated staff/admin authorization check; PLAYER and ordinary GM sessions cannot access the inbox.
- List/detail endpoints have pagination, bounded filters, rate limiting and audit logging.
- The UI supports at least: new, acknowledged, linked, resolved and dismissed states.
- A report can be linked to an existing Linear issue so duplicates are not created.
- Exporting or copying a report applies redaction and excludes tokens, cookies, private chat/character content and internal infrastructure details.
- Authorization tests cover anonymous, PLAYER, GM and authorized operator access.
- Regression tests cover report listing, detail redaction, attachment access, state transitions and Linear-link metadata.
- Production remains read-only during discovery; deployment requires a separate explicit release gate.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-317 — [arken-space] Создать визуальную дизайн-систему и персональные темы игроков

- Category **core-development**; Linear **In Progress**; implementation **Unknown.**
- Source [UIX-317](https://linear.app/uixraydesign/issue/UIX-317/arken-space-sozdat-vizualnuyu-dizajn-sistemu-i-personalnye-temy); parent none.
- Next action: Complete the read-only token/state inventory and prepare the canonical semantic-token schema plus a component-state matrix before changing production CSS.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Есть документированный каталог токенов с назначением, шкалами и правилами использования.
- Удалено дублирование между текущими color tokens, legacy aliases и arken tokens: определён один канонический слой и совместимый путь миграции.
- Базовые контролы и составные интерактивные компоненты используют общую матрицу состояний.
- Все опубликованные темы проходят WCAG-контраст для текста, контролов, focus indicators и критических состояний; цвет нигде не является единственным носителем смысла.
- Для каждого игрока можно назначить стабильную тему по умолчанию; пользователь может переключиться на любую опубликованную тему и вернуться к своей.
- Выбор хранится на корректном уровне профиля/аккаунта, а не только в глобальном localStorage.
- Canvas-adjacent controls, чат, карточки бросков, критические состояния кубов, fog/drawing/ruler UI читаемы во всех темах.
- Dropdown/popover/dialog/toast используют единую layer scale и не перекрываются в неправильном порядке.
- Темы работают без reload и без заметной вспышки неправильной темы.
- Representative states покрыты component/integration tests и visual regression snapshots для GM/PLAYER, desktop/mobile и keyboard focus.
- Есть migration checklist; переход выполняется по стабильным областям интерфейса, без единовременного переписывания App, Sidebar или renderer mechanics.
- Добавление новой темы не требует изменения компонентов.

### Критерий готовности

После внедрения тем прежнее визуальное оформление остаётся доступным в переключателе, применяется к интерфейсу и сохраняется после перезагрузки и повторного входа. Это дополнение не отменяет персонализированную тему по умолчанию для каждого игрока.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-316 — [arken-space] Создать полноценную мобильную и планшетную версию

- Category **parent-or-acceptance**; Linear **In Review**; implementation **Unknown.**
- Source [UIX-316](https://linear.app/uixraydesign/issue/UIX-316/arken-space-sozdat-polnocennuyu-mobilnuyu-i-planshetnuyu-versiyu); parent none.
- Next action: Провести discovery pool: зафиксировать device matrix, mobile IA и отдельные PLAYER/GM journey maps, затем утвердить Player MVP и desktop-only границы до изменения layout.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Документирована матрица устройств, браузеров, размеров и ориентаций: iOS Safari, Android Chrome и актуальные tablet browsers.
- У приложения нет обязательного фиксированного min-width; отсутствует горизонтальный overflow на поддерживаемых экранах.
- Не создан отдельный renderer или fork игрового состояния.
- PLAYER и GM имеют явную мобильную IA и навигацию; карта, журнал и персонаж доступны в один-два предсказуемых действия.
- Критические player session flows полностью выполняются с телефона.
- Определён и проверен минимальный GM mobile scope; desktop-only действия обозначены в интерфейсе, а не просто ломаются.
- Touch, mouse и keyboard используют общий command layer, где действие эквивалентно.
- Два пальца всегда безопасно переключают карту в навигацию и не создают случайный fog/drawing/ruler input.
- Все controls и hit areas доступны для touch, keyboard и screen reader; focus не теряется при открытии/закрытии sheets.
- Поля не скрываются экранной клавиатурой; composer остаётся доступным.
- Safe areas, portrait/landscape, zoom текста и reduced motion поддержаны.
- Серверные permissions и visibility остаются авторитетными; скрытые сущности не попадают в mobile DOM, accessibility tree или asset delivery.
- Loading, empty, reconnect, offline/slow-network и conflict states проработаны.
- Representative PLAYER/GM flows покрыты unit/integration/E2E; есть real-device QA checklist.
- Производительность карты и realtime traffic измерены на целевых устройствах.
- Каждый delivery pool можно выпустить и откатить независимо.
- Production deployment выполняется только через отдельный release gate.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-293 — [arken-space] Безопасный жизненный цикл файлов: использование, замена и удаление

- Category **core-development**; Linear **In Progress**; implementation **Unknown.**
- Source [UIX-293](https://linear.app/uixraydesign/issue/UIX-293/arken-space-bezopasnyj-zhiznennyj-cikl-fajlov-ispolzovanie-zamena-i); parent UIX-271.
- Next action: Спроектировать usage registry и deletion guard до изменения UI.
- Dependencies: parent:UIX-271.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Для файла показываются превью, имя, тип, размер, статус использования и места использования.
- Неиспользуемый файл можно удалить.
- Удаление используемого файла блокируется или требует явного разрешения зависимостей.
- Доступно действие замены файла без разрушения существующих ссылок.
- ACL действует на просмотр usage, замену, удаление и прямую выдачу контента.
- Операции журналируются и покрыты API/integration tests.
- Проверены зависимости сцен, token definitions/placements, персонажей, story media и audio.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-289 — [arken-space] Add animated outcome frames for natural 1/20 and selected skill rolls

- Category **core-development**; Linear **In Progress**; implementation **Unknown.**
- Source [UIX-289](https://linear.app/uixraydesign/issue/UIX-289/arken-space-add-animated-outcome-frames-for-natural-120-and-selected); parent none.
- Next action: Inventory `MS0LXIPCEF91V` in Eagle, record format/dimensions/transparency/duration for every candidate, and select one critical plus one fumble frame for a bounded prototype.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- A natural d20 result of 1 uses the configured fumble frame.
- A natural d20 result of 20 uses the configured critical frame.
- Modified totals equal to 1 or 20 do not trigger natural-roll frames unless the raw d20 value matches.
- Non-d20 and multi-die formulas do not receive a natural d20 frame accidentally.
- GM can assign an approved frame theme to selected skill/action outcomes without embedding arbitrary asset IDs in player input.
- Roll and skill mechanics remain identical with frames enabled or disabled.
- The frame is decorative: text explicitly communicates critical/fumble/outcome state and remains readable without motion or color.
- `prefers-reduced-motion` shows a static poster or restrained non-animated state.
- Historical chat does not run an unlimited number of simultaneous animations; only the newest/active card animates according to an explicit performance policy.
- Off-screen frames pause and resume safely; long chat history remains responsive.
- Missing, failed or deprecated frame assets fall back to the normal roll/skill card.
- Frame assets are imported with provenance and optimized derivatives; Eagle originals are not modified.
- Asset authorization prevents direct access to unpublished/private themes.
- Tests cover natural 1/20 versus modified totals, non-d20/multi-die rolls, selected skill outcomes, fallback, reduced motion and history performance.
- Browser QA covers realtime delivery, reload, old history and supported narrow layouts.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-214 — [arken-space] Persistent drawings, shared ruler and map navigation controls

- Category **core-development**; Linear **In Progress**; implementation **Unknown.**
- Source [UIX-214](https://linear.app/uixraydesign/issue/UIX-214/arken-space-persistent-drawings-shared-ruler-and-map-navigation); parent none.
- Next action: Сверить текущую реализацию с исходным AC по persistence/permissions/undo/shared ruler/navigation и закрыть только непроверенные пункты синхронизационными и multi-client тестами.
- Dependencies: blockedBy:UIX-212, blockedBy:UIX-213, blocks:UIX-217.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Drawings persist with author, points, color, transform and revision.
- Author/GM may move, recolor, copy or delete; others are read-only.
- Drawing commands participate in undo/redo.
- Shared ruler shows grid-aware distance without persisting as campaign content.
- GM can adjust map scale/alignment and grid offset safely.
- Wheel, minus/plus and slider share one bounded zoom state.
- Reconnect and multi-client permission tests pass.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-661 — Собрать и опубликовать portfolio case по Arken Space

- Category **portfolio**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-661](https://linear.app/uixraydesign/issue/UIX-661/sobrat-i-opublikovat-portfolio-case-po-arken-space); parent UIX-653.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: parent:UIX-653.
- Original acceptance / DoD sections:

## Критерий качества

После просмотра должно быть понятно не только «что было нарисовано», но как принимались решения, какие данные их поддерживали, где были компромиссы и какой эффект дали изменения.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-660 — Провести usability testing и измерить улучшения ключевого first-run сценария

- Category **portfolio**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-660](https://linear.app/uixraydesign/issue/UIX-660/provesti-usability-testing-i-izmerit-uluchsheniya-klyuchevogo-first); parent UIX-653.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: parent:UIX-653.
- Original acceptance / DoD sections:

## Результат

- baseline до улучшений, если возможно;
- результаты тестов;
- список проблем по severity;
- минимум один цикл iteration → retest;
- измеримые before/after выводы для portfolio case.

Не подгонять выводы под заранее желаемую историю: провалы и опровергнутые гипотезы фиксировать явно.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-659 — Оформить дизайн-систему Arken Space как часть продуктового кейса

- Category **portfolio**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-659](https://linear.app/uixraydesign/issue/UIX-659/oformit-dizajn-sistemu-arken-space-kak-chast-produktovogo-kejsa); parent UIX-653.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: parent:UIX-653.
- Original acceptance / DoD sections:

## Результат

Компактная, доказательная часть дизайн-системы, которую можно показать отдельно и встроить в portfolio case. Не делать огромную библиотеку ради количества компонентов.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-658 — Провести UX-аудит и довести ключевые сценарии Arken Space до уровня портфолио

- Category **portfolio**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-658](https://linear.app/uixraydesign/issue/UIX-658/provesti-ux-audit-i-dovesti-klyuchevye-scenarii-arken-space-do-urovnya); parent UIX-653.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: parent:UIX-653.
- Original acceptance / DoD sections:

## Проверить

- создание и подготовка кампании;
- работа GM со сценой, токенами, fog и персонажами;
- приглашение/подключение игроков;
- session continuity, reconnect и восстановление после ошибок;
- navigation/IA;
- consistency компонентов и состояний;
- responsive/mobile там, где это важно для выбранного сценария;
- accessibility и keyboard behavior для ключевых действий;
- понятность ошибок, destructive actions и recovery.

## Результат

- приоритизированный список UX-проблем;
- исправления P0/P1, которые мешают целевому сценарию;
- before/after материалы для portfolio case;
- список сознательно оставленных ограничений с объяснением причин.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-657 — Сделать продуктовую оболочку Arken Space для незнакомого пользователя

- Category **portfolio**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-657](https://linear.app/uixraydesign/issue/UIX-657/sdelat-produktovuyu-obolochku-arken-space-dlya-neznakomogo); parent UIX-653.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: parent:UIX-653.
- Original acceptance / DoD sections:

## Критерий

Незнакомый пользователь должен суметь понять, что такое Arken Space, создать кампанию и пригласить игрока без объяснений автора проекта.

Не реализовывать billing, marketplace или сложную plugin ecosystem, если они не нужны для проверки выбранного сценария.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-656 — Сформулировать позиционирование, продуктовые принципы и scope публичной версии Arken Space

- Category **portfolio**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-656](https://linear.app/uixraydesign/issue/UIX-656/sformulirovat-pozicionirovanie-produktovye-principy-i-scope-publichnoj); parent UIX-653.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: parent:UIX-653.
- Original acceptance / DoD sections:

## Результат

Короткий product brief/one-pager, который можно использовать как основу для дальнейшего дизайна и portfolio case.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-655 — Провести пользовательское исследование GM и проверить продуктовые гипотезы Arken Space

- Category **portfolio**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-655](https://linear.app/uixraydesign/issue/UIX-655/provesti-polzovatelskoe-issledovanie-gm-i-proverit-produktovye); parent UIX-653.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: parent:UIX-653.
- Original acceptance / DoD sections:

## Результат

- interview guide;
- краткие конспекты/insights;
- affinity map или другая группировка проблем;
- JTBD/problem statements;
- список гипотез с отметками: подтверждено / опровергнуто / требует проверки;
- 1–2 целевых сегмента, на которых имеет смысл сфокусировать Arken.

Важно: негативный результат тоже считается полезным результатом исследования.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-654 — Провести конкурентное исследование VTT-рынка и найти пространство для Arken Space

- Category **portfolio**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-654](https://linear.app/uixraydesign/issue/UIX-654/provesti-konkurentnoe-issledovanie-vtt-rynka-i-najti-prostranstvo-dlya); parent UIX-653.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: parent:UIX-653.
- Original acceptance / DoD sections:

## Результат

- сравнительная матрица;
- 5–10 устойчивых паттернов рынка;
- список зон, где рынок уже commoditized;
- 3–5 потенциальных возможностей/ниш для Arken;
- отдельный вывод: где Arken НЕ должен пытаться конкурировать.

Не считать self-hosted + SaaS уникальностью без дополнительных доказательств.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-653 — Превратить Arken Space из pet project в полноценный продуктовый кейс

- Category **portfolio**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-653](https://linear.app/uixraydesign/issue/UIX-653/prevratit-arken-space-iz-pet-project-v-polnocennyj-produktovyj-kejs); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Итоговый результат

- понятное позиционирование Arken Space;
- подтверждённый целевой сценарий и продуктовые гипотезы;
- публичный first-run/onboarding flow;
- продуктовая оболочка вокруг существующего VTT;
- результаты тестов и измеримые улучшения;
- опубликованный portfolio case с аргументацией решений, альтернативами и выводами.

Подзадачи ниже покрывают discovery, productization, validation и упаковку кейса.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-652 — [arken-space] Подробный лендинг возможностей и структурированная база знаний / FAQ

- Category **content-or-parallel-game**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-652](https://linear.app/uixraydesign/issue/UIX-652/arken-space-podrobnyj-lending-vozmozhnostej-i-strukturirovannaya-baza); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Критерии готовности

- [ ] Главная до входа понятно объясняет назначение платформы и все доступные группы возможностей; отдельно понятны сценарии мастера и игрока.
- [ ] Ключевые сценарии сопровождаются актуальными скриншотами и пояснениями; демонстрационные данные не раскрывают личную информацию, секретные ссылки и закрытые материалы кампаний.
- [ ] Шорткаты соответствуют действующему интерфейсу; указаны назначение и ограничения применения.
- [ ] Инструкции позволяют пройти описанный сценарий по шагам, а не ограничиваются рекламным перечислением функций.
- [ ] После оценки объёма зафиксировано решение: достаточно структурированного лендинга либо нужна отдельная база знаний. Во втором случае она реализована с разделами, статьями, FAQ и навигацией.
- [ ] Неопубликованные, экспериментальные и недоступные конкретной роли функции не представлены как общедоступные готовые возможности.
- [ ] Лендинг и справка удобны на настольных и мобильных экранах, доступны с клавиатуры; изображения оптимизированы и не мешают быстрому входу в игру.
- [ ] Вход в сервис остаётся легко доступным, все ссылки и описанные пользовательские пути проверены.
- [ ] Определены единый источник материалов и правило актуализации скриншотов, инструкций и шорткатов после изменения интерфейса.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-649 — Добавить готовый стикер-пак Аркен-Хара в Arken Space

- Category **content-or-parallel-game**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-649](https://linear.app/uixraydesign/issue/UIX-649/dobavit-gotovyj-stiker-pak-arken-hara-v-arken-space); parent none.
- Next action: Ожидать отдельного разрешения пользователя на дальнейшую работу. Для будущей интеграции использовать сохранённую ручную выгрузку; повторный экспорт, генерацию, изменения Figma, реализацию и публикацию сейчас не начинать.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Использованы только финальные одобренные версии с подписями из выбранной секции Figma.
- Подготовлены изображения 512×512 с прозрачностью; обводки и подписи не обрезаны.
- Названия, персонажи и эмодзи проверены по изображениям и согласованы отдельно; старые имена файлов и каталоги экспорта не считаются надёжным сопоставлением.
- Стикеры доступны для выбора и отправки в чате, корректно отображаются у другого участника; проверены desktop и mobile.
- Нет дублей и потери существующих стикеров.
- Production-публикация только после отдельного разрешения и завершённого gate.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-629 — [mobile] Физические устройства: доступность, сеть и производительность

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-629](https://linear.app/uixraydesign/issue/UIX-629/mobile-fizicheskie-ustrojstva-dostupnost-set-i-proizvoditelnost); parent UIX-316.
- Next action: Дождаться явного approval плана <issue id="103cce38-2a96-4bb4-9fda-2c847996d2a2" href="https://linear.app/uixraydesign/issue/UIX-316/arken-space-sozdat-polnocennuyu-mobilnuyu-i-planshetnuyu-versiyu">UIX-316</issue>, затем освежить Git/Linear/ownership и взять только этот связанный пул. До approval код не начинается.
- Dependencies: parent:UIX-316, blockedBy:UIX-628, blockedBy:UIX-627, blockedBy:UIX-625, blockedBy:UIX-624, blockedBy:UIX-626.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Записаны точные модели/OS/browser/viewport, матрица обеих ориентаций и реальные critical PLAYER/GM flows; эмуляция не заменяет hardware QA.
- Проверены keyboard/safe areas, text zoom/reduced motion, focus/screen reader, cancel/second finger, slow/offline/reconnect и private asset delivery.
- Измерены frame-time/input latency/memory/финальный commit и realtime bytes на согласованной сцене/сети; пороги утверждены после baseline.
- Есть regression/diversion/CI ссылки и rollback границы; <issue id="929cdefd-795d-457f-a441-ed4a2812d24f" href="https://linear.app/uixraydesign/issue/UIX-217/arken-space-full-product-gm-6-acceptance-rehearsal">UIX-217</issue> остаётся владельцем GM+6 30–45 минут rehearsal, <issue id="9e09746b-72d5-4362-869d-8c920c0a7dd0" href="https://linear.app/uixraydesign/issue/UIX-412/arken-space-tochechnye-sobytiya-vmesto-polnoj-rassylki-snapshota">UIX-412</issue> — транспортной архитектуры.
- PWA/offline editing и production deployment не входят; release/merge требуют отдельного GO.
- После связанного implementation-пула: адресная диверсия нового теста, format → lint → typecheck → build → test и E2E; realtime/access/save changes дополнительно multiplayer. CI обязателен.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-628 — [mobile] Ограниченный GM-режим и планшетная компоновка

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-628](https://linear.app/uixraydesign/issue/UIX-628/mobile-ogranichennyj-gm-rezhim-i-planshetnaya-komponovka); parent UIX-316.
- Next action: Дождаться явного approval плана <issue id="103cce38-2a96-4bb4-9fda-2c847996d2a2" href="https://linear.app/uixraydesign/issue/UIX-316/arken-space-sozdat-polnocennuyu-mobilnuyu-i-planshetnuyu-versiyu">UIX-316</issue>, затем освежить Git/Linear/ownership и взять только этот связанный пул. До approval код не начинается.
- Dependencies: parent:UIX-316, blockedBy:UIX-625, blockedBy:UIX-627, blockedBy:UIX-626, blocks:UIX-629.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Владелец подтвердил точный обязательный телефонный GM scope и desktop-only исключения до кода.
- Оперативный GM journey доступен без обрезанных форм, не теряет контекст/черновик при ориентации и клавиатуре.
- Scene/music/pause flows переиспользуют существующие контракты; отсутствие нужной функции не восполняется скрытым расширением scope.
- Никакого возврата battle/new DM, расширения mixer или <issue id="e7bdbd9f-8c8d-442c-8813-f08cb8d76676" href="https://linear.app/uixraydesign/issue/UIX-512/arken-space-saundpad-s-obshimi-pakami-situativnyh-zvukov">UIX-512</issue> soundpad; limited fog зависит от P4, whispers от <issue id="0dcb7e14-63a2-4d4c-958a-721ba78a0cc5" href="https://linear.app/uixraydesign/issue/UIX-365/arken-space-redesign-direct-messages-mechanic-before-re-enabling">UIX-365</issue>.
- После связанного implementation-пула: адресная диверсия нового теста, format → lint → typecheck → build → test и E2E; realtime/access/save changes дополнительно multiplayer. CI обязателен.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-627 — [mobile] Touch-сценарии Draw, Fog и Ruler

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-627](https://linear.app/uixraydesign/issue/UIX-627/mobile-touch-scenarii-draw-fog-i-ruler); parent UIX-316.
- Next action: Дождаться явного approval плана <issue id="103cce38-2a96-4bb4-9fda-2c847996d2a2" href="https://linear.app/uixraydesign/issue/UIX-316/arken-space-sozdat-polnocennuyu-mobilnuyu-i-planshetnuyu-versiyu">UIX-316</issue>, затем освежить Git/Linear/ownership и взять только этот связанный пул. До approval код не начинается.
- Dependencies: parent:UIX-316, blockedBy:UIX-626, blocks:UIX-629, blocks:UIX-628.
- Original acceptance / DoD sections:

## Acceptance Criteria

- После P3 согласовано ownership <issue id="78eec3e2-e776-4f6d-8229-8bfb029d8615" href="https://linear.app/uixraydesign/issue/UIX-214/arken-space-persistent-drawings-shared-ruler-and-map-navigation">UIX-214</issue> и инвентаризация реально существующих команд; не повторяется persistence/geometry/brush preview.
- Preview и итоговая операция совпадают; второй палец и cancel удаляют незавершённый draft без записи.
- PLAYER/GM права и видимость остаются каноническими; нельзя воздействовать на чужие/скрытые targets.
- Touch regression с диверсией и multiplayer persistence/rollback доказаны; battle не возвращается.
- После связанного implementation-пула: адресная диверсия нового теста, format → lint → typecheck → build → test и E2E; realtime/access/save changes дополнительно multiplayer. CI обязателен.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-626 — [mobile] Общий touch-ввод карты: pan, pinch и управляемые токены

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-626](https://linear.app/uixraydesign/issue/UIX-626/mobile-obshij-touch-vvod-karty-pan-pinch-i-upravlyaemye-tokeny); parent UIX-316.
- Next action: Дождаться явного approval плана <issue id="103cce38-2a96-4bb4-9fda-2c847996d2a2" href="https://linear.app/uixraydesign/issue/UIX-316/arken-space-sozdat-polnocennuyu-mobilnuyu-i-planshetnuyu-versiyu">UIX-316</issue>, затем освежить Git/Linear/ownership и взять только этот связанный пул. До approval код не начинается.
- Dependencies: parent:UIX-316, blockedBy:UIX-624, blocks:UIX-629, blocks:UIX-628, blocks:UIX-627.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Состояния и пороги жестов согласованы на устройствах; ownership карты/инструментов <issue id="78eec3e2-e776-4f6d-8229-8bfb029d8615" href="https://linear.app/uixraydesign/issue/UIX-214/arken-space-persistent-drawings-shared-ruler-and-map-navigation">UIX-214</issue> проверен до кода.
- Два пальца всегда pan+pinch, второй палец отменяет draft; pointercancel/lostcapture/blur/orientation не дают случайный commit.
- Одинаковые действия mouse/keyboard/touch используют общий command core; финальный commit не теряется/не дублируется.
- Owner/controlled/foreign/hidden/locked случаи и pause проверены; <issue id="ca6da0b5-3ccd-4979-a8db-3bd84ee0ba0f" href="https://linear.app/uixraydesign/issue/UIX-405/arken-space-peremeshenie-tokena-na-wasd-i-ping-po-hotkeyu">UIX-405</issue>/507 и существующий core <issue id="01b272e6-821f-4bdc-8c67-4609669a4f0b" href="https://linear.app/uixraydesign/issue/UIX-256/arken-space-build-map-interaction-command-core-and-keyboard-access">UIX-256</issue> не дублируются.
- После связанного implementation-пула: адресная диверсия нового теста, format → lint → typecheck → build → test и E2E; realtime/access/save changes дополнительно multiplayer. CI обязателен.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-625 — [mobile] Цельная PLAYER-сессия: журнал, броски и персонаж

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-625](https://linear.app/uixraydesign/issue/UIX-625/mobile-celnaya-player-sessiya-zhurnal-broski-i-personazh); parent UIX-316.
- Next action: Дождаться явного approval плана <issue id="103cce38-2a96-4bb4-9fda-2c847996d2a2" href="https://linear.app/uixraydesign/issue/UIX-316/arken-space-sozdat-polnocennuyu-mobilnuyu-i-planshetnuyu-versiyu">UIX-316</issue>, затем освежить Git/Linear/ownership и взять только этот связанный пул. До approval код не начинается.
- Dependencies: parent:UIX-316, blockedBy:UIX-624, blocks:UIX-629, blocks:UIX-628.
- Original acceptance / DoD sections:

## Acceptance Criteria

- PLAYER проходит вход → сообщение → бросок → ресурс/персонаж → возврат на карту с сохранением drafts/focus/follow-scroll.
- Composer и активное поле не скрыты экранной клавиатурой; pending/error/reconnect/conflict состояния проверены.
- Whispers остаются явной отложенной зависимостью <issue id="0dcb7e14-63a2-4d4c-958a-721ba78a0cc5" href="https://linear.app/uixraydesign/issue/UIX-365/arken-space-redesign-direct-messages-mechanic-before-re-enabling">UIX-365</issue>: скрытую DM-вкладку не возвращать и эту часть не объявлять принятой.
- Серверные ACL и private данные при handoff/отзыве доступа проверены реальными синтетическими сессиями.
- После связанного implementation-пула: адресная диверсия нового теста, format → lint → typecheck → build → test и E2E; realtime/access/save changes дополнительно multiplayer. CI обязателен.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-622 — [arken-space][R&D] Исследовать «кармическую» псевдослучайность бросков в отдельном контуре

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-622](https://linear.app/uixraydesign/issue/UIX-622/arken-spacerandd-issledovat-karmicheskuyu-psevdosluchajnost-broskov-v); parent none.
- Next action: Сначала описать текущую server-side dice pipeline и baseline-распределение, затем подготовить research note и simulation harness. До завершения анализа не выбирать алгоритм для прототипа.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Подготовлен source-backed обзор аналогичных механик и их известных рисков; сведения о конкретных играх не выдаются за точную реализацию без надёжного источника.
- Зафиксирована текущая dice pipeline и точка безопасного подключения стратегии RNG.
- Реализован интерфейс DiceRandomStrategy без изменения baseline semantics.
- Минимум три кандидатных алгоритма сравниваются с baseline в воспроизводимом simulation harness.
- Для каждого варианта описаны параметры, reset policy, scope истории и возможные способы эксплуатации.
- Маргинальное распределение d20 не имеет необъяснимого систематического смещения; любые намеренные отклонения явно документированы.
- Natural 1/20, advantage/disadvantage, модификаторы и перебросы имеют закреплённую семантику и тесты.
- Алгоритм не гарантирует успех или провал конкретного броска и не читает желаемый сюжетный исход.
- Режим включается только в отдельной тестовой кампании и явно маркируется в UI/chat/audit.
- Baseline остаётся default и покрыт regression tests.
- Есть kill switch и безопасный возврат к baseline без потери истории.
- Проведён слепой пользовательский тест и сформулирована рекомендация: отказаться, продолжить эксперимент или предложить opt-in режим.
- Production deployment и включение в основную кампанию не входят в задачу.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-591 — [arken-space][R&D] Многоэтажная таверна: изометрия и top-down карта для боя

- Category **content-or-parallel-game**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-591](https://linear.app/uixraydesign/issue/UIX-591/arken-spacerandd-mnogoetazhnaya-taverna-izometriya-i-top-down-karta); parent none.
- Next action: Read-only найти канонический asset таверны и связанные материалы, затем сделать локальный floor/room inventory без изменения production.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Эксперимент находится вне production-контура и не изменяет production БД/ассеты.
- Зафиксированы provenance и разрешение на использование изображения таверны Семёна в private R&D.
- Созданы согласованные изометрический и top-down варианты минимум одного этажа.
- Исследована многоэтажная модель; подготовлено минимум два floor layers или документирован блокер исходных данных.
- Для каждой комнаты/лестницы показано соответствие между видами либо отмечено, что соответствие неизвестно.
- Top-down версия использует единый измеримый масштаб и пригодна для сетки/линейки.
- Проверен сценарий: обзор в изометрии → начало боя → переход на top-down → смена этажа → возврат без потери состояния.
- Fog, drawings, token placements и visibility не протекают между этажами/ролями.
- Сравнены варианты ручной реконструкции, image-to-image генерации и 3D/2.5D исходника по времени, качеству и повторяемости.
- Результат содержит визуальные артефакты, ограничения и архитектурную рекомендацию: продолжать, упростить или отказаться.
- Никакого production deploy в рамках эксперимента.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-590 — [arken-space] Собрать для Семёна запасной GM-пак токенов из прошлых партий

- Category **content-or-parallel-game**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-590](https://linear.app/uixraydesign/issue/UIX-590/arken-space-sobrat-dlya-semyona-zapasnoj-gm-pak-tokenov-iz-proshlyh); parent none.
- Next action: Определить кампанию Семёна, затем сделать read-only выборку кандидатов в Eagle с provenance и превью до загрузки в сервис.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Уточнены конкретная кампания Семёна и целевая медиатека; импорт не попадает в общую библиотеку по ошибке.
- Для каждого выбранного изображения сохранена безопасная provenance-запись: источник Eagle, автор/лицензия или статус «только внутреннее использование».
- Материалы с неясными правами остаются private и не используются в публичной демо-кампании.
- Подготовлен сбалансированный стартовый набор по четырём категориям без очевидных дублей.
- Каждый токен обрезан без деформации; ключевой объект остаётся читаемым в малом размере.
- Crop/zoom и рамка можно повторно отредактировать без изменения исходного IMAGE.
- Использовано несколько рамок, но категория не кодируется только цветом.
- Имена и теги позволяют быстро найти токен по категории.
- Семён видит набор в палитре и может поставить токен на сцену без повторной загрузки изображения.
- Проверены создание размещения, перемещение, reload и замена изображения; токен не возвращается к старому asset (<issue id="6b8a23ef-38fd-4646-8a7c-243baabe39fe" href="https://linear.app/uixraydesign/issue/UIX-491/izobrazhenie-tokena-propadaet-pri-peretaskivanii">UIX-491</issue>).
- Зафиксированы количество загруженных токенов, отклонённые материалы и причина отклонения.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-588 — [arken-space] Добавить ресурс «Вдохновение» для перебросов

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-588](https://linear.app/uixraydesign/issue/UIX-588/arken-space-dobavit-resurs-vdohnovenie-dlya-perebrosov); parent none.
- Next action: Зафиксировать четыре правила расхода — допустимые броски, срок применения, выбор результата и максимум ресурса — затем встроить действие в существующий auditable roll pipeline.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- У персонажа есть серверно сохраняемые current/max значения вдохновения.
- PLAYER видит и расходует ресурс только у управляемого персонажа; GM может редактировать его.
- Один подтверждённый расход уменьшает значение ровно на единицу и создаёт ровно один новый roll event.
- Операция расхода и создание повторного броска выполняются атомарно.
- Исходный и повторный результаты остаются в журнале и связаны между собой.
- Нельзя перебросить чужой, неподходящий, устаревший или уже переброшенный roll event.
- Конкурентные нажатия и повторная доставка команды не приводят к отрицательному балансу или нескольким перебросам.
- В PLAYER-visible данных нет скрытых GM-модификаторов или закрытых бросков.
- Покрыты contract, authorization, idempotency, concurrency, component и multiplayer regression tests.
- Пройдены typecheck/lint и подходящие тесты; production deployment выполняется отдельно.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-527 — [arken-space] Состав группы — конфигурация, а не константа в коде

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-527](https://linear.app/uixraydesign/issue/UIX-527/arken-space-sostav-gruppy-konfiguraciya-a-ne-konstanta-v-kode); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Состав группы меняется без пересборки и деплоя.
- Существующие шесть входов продолжают работать после миграции.
- Клиент получает только то, что нужно текущему пользователю, а не полный список.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-526 — [arken-space] Онбординг: первый вход без чужой помощи

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-526](https://linear.app/uixraydesign/issue/UIX-526/arken-space-onbording-pervyj-vhod-bez-chuzhoj-pomoshi); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: blockedBy:UIX-524, blockedBy:UIX-525.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Человек, впервые открывший сервис, доходит до игрового стола без инструкций из чата и без помощи владельца.
- Ни один шаг не требует доступа к серверу, `.env` или консоли.
- Первый вход проверен на живом человеке, а не только автотестом: сценарий и результат записаны в задачу.
- Существующая группа не проходит онбординг заново — их вход не ломается.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-525 — [arken-space] Мастер создаёт свою кампанию: изоляция вместо одной seed-кампании

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-525](https://linear.app/uixraydesign/issue/UIX-525/arken-space-master-sozdayot-svoyu-kampaniyu-izolyaciya-vmesto-odnoj); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: blocks:UIX-526.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Мастер создаёт кампанию из интерфейса, не трогая `.env` и не перезапуская сервер.
- Данные двух кампаний не пересекаются ни в одном срезе: сцены, токены, чат, персонажи, ассеты, заявки.
- Есть тест «мастер A против мастера B» по образцу существующего `tests/visibility.test.ts:350` («не отдаёт игроку ничего, принадлежащего другому игроку»), проверенный намеренной поломкой.
- `ensureSeed` перестаёт быть единственным источником кампании, но существующая кампания продолжает работать без миграции вручную.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-512 — [arken-space] Саундпад с общими паками ситуативных звуков

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-512](https://linear.app/uixraydesign/issue/UIX-512/arken-space-saundpad-s-obshimi-pakami-situativnyh-zvukov); parent none.
- Next action: Сначала определить event contract, лимиты и независимую Effects audio bus; не расширять persistent music transport одноразовыми эффектами.
- Dependencies: none returned.
- Original acceptance / DoD sections:

### Acceptance Criteria для обрезки

- GM может загрузить длинный файл, выбрать диапазон, прослушать его и сохранить как кнопку саундпада без стороннего редактора.
- Preview соответствует сохранённому диапазону с допустимой технической погрешностью.
- Некорректный, пустой, отрицательный или выходящий за длительность диапазон отклоняется.
- Оригинал не изменяется и не удаляется автоматически после создания клипа.
- Повторная команда с тем же actionId идемпотентна.
- Тесты покрывают границы диапазона, мобильный touch/keyboard control, квоту, авторизацию и совпадение preview/result.

## Acceptance Criteria

- GM может создать, изменить, опубликовать и скрыть звуковой пак.
- Разрешённый PLAYER и GM запускают опубликованный звук; все подключённые слушатели получают одно событие.
- Неразрешённый участник, скрытый asset и asset другой кампании отвергаются сервером.
- Один eventId воспроизводится максимум один раз на клиент.
- Sound effects не меняют play/pause/seek/volume музыкальных дорожек.
- Локальный effects mute/volume работает независимо и сохраняется per campaign + membership.
- Cooldown, rate limit, voice limit и emergency stop проверены тестами.
- Reconnect не воспроизводит историю старых эффектов.
- Autoplay-blocked state и декодирование ошибок обрабатываются без падения.
- GM/PLAYER, desktop/mobile, slow network и simultaneous trigger flows покрыты integration/E2E.
- Проведена performance-проверка, особенно с учётом <issue id="871f3041-0bdb-4829-8c01-021cc2031617" href="https://linear.app/uixraydesign/issue/UIX-394/arken-space-investigate-post-audio-update-platform-lag">UIX-394</issue>.
- Production deployment требует отдельного release gate.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-510 — [R&D] Адаптивный контраст линейки относительно фона карты

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-510](https://linear.app/uixraydesign/issue/UIX-510/randd-adaptivnyj-kontrast-linejki-otnositelno-fona-karty); parent UIX-509.
- Next action: После выпуска стабильных персональных цветов собрать isolated renderer prototype и сравнить читаемость/стоимость трёх подходов.
- Dependencies: parent:UIX-509.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Сравнены минимум три подхода: фиксированный двухслойный outline, blend/composite mode, анализ яркости небольшого участка canvas.
- Эксперимент не читает и не передаёт скрытые данные карты игроку; используется только уже отрисованная доступная клиенту поверхность.
- Измерено влияние на FPS при нескольких линейках и активном fog.
- Подготовлены примеры на светлой, тёмной и пёстрой карте.
- Зафиксировано решение: оставить фиксированный outline либо перейти к адаптивной схеме.
- До отдельного одобрения гипотеза не влияет на основную реализацию.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-509 — [arken-space] Персональные цвета линеек игроков и контрастное свечение

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-509](https://linear.app/uixraydesign/issue/UIX-509/arken-space-personalnye-cveta-lineek-igrokov-i-kontrastnoe-svechenie); parent none.
- Next action: Проверить membership IDs кампании, определить hex + outline pairs, вынести pure resolver и затем заменить единый `visual.color.edit` в ruler render path.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Один membership получает один и тот же цвет у всех клиентов и после reconnect.
- Стартовая палитра назначена указанным участникам.
- Связь хранится по стабильному membership ID или campaign setting; displayName используется только для первоначального seed/migration, а не как постоянный ключ.
- Локальный draft и полученная realtime-линейка одного участника имеют одинаковый цвет.
- Основная линия, стрелка, waypoint-маркеры и подпись расстояния используют согласованную цветовую схему.
- Под основной линией рисуется более широкий полупрозрачный outline/glow, обеспечивающий отделение от фона.
- Толщина линии, outline и маркеров остаётся визуально стабильной при zoom.
- Цвет GM не становится невидимым на тёмной карте: чёрная основная линия получает светлый внешний outline.
- Эффект не требует изменения частоты `ruler:update` и не создаёт дополнительные realtime-события.
- Unit-тесты покрывают стабильное разрешение membership→color и fallback; browser QA проверяет светлую, тёмную и пёструю карту с несколькими линейками.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-508 — [arken-space] Анимированный маячок пинга: падение, ударное кольцо и затухание

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-508](https://linear.app/uixraydesign/issue/UIX-508/arken-space-animirovannyj-mayachok-pinga-padenie-udarnoe-kolco-i); parent none.
- Next action: Вынести pure motion timeline и отдельный `AnimatedMapPing` с imperative Konva animation/cleanup, затем заменить статический Group без изменения realtime-кода.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Локальный и полученный по realtime ping используют один компонент и одинаковую анимацию.
- Анимация не меняет `map:ping` contract и не раскрывает содержимое под туманом.
- При zoom размеры капли, кольца, stroke и подписи остаются визуально стабильными.
- До 8 одновременных пингов анимируются без React state update на каждый кадр; предпочтительно Konva Tween/Animation с корректным cleanup.
- Повторные пинги одного участника не перезаписывают друг друга; ключ остаётся уникальным по membership/time.
- Имя автора читаемо, но не конкурирует с точкой; подпись затухает вместе с эффектом.
- `prefers-reduced-motion: reduce` показывает спокойную статичную точку/кольцо с коротким fade без падения и масштабного импульса.
- Цвет берётся из canvas visual tokens и сохраняет достаточный контраст на карте и поверх непрозрачного тумана.
- Unit-тестами покрыта временная шкала/геометрия; browser screenshot или canvas-diff подтверждает начало, impact и fade; multiplayer regression подтверждает доставку поверх тумана.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-506 — [arken-space] Айдентика «Аркспейс»: иконка, favicon и кириллический wordmark

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-506](https://linear.app/uixraydesign/issue/UIX-506/arken-space-ajdentika-arkspejs-ikonka-favicon-i-kirillicheskij); parent none.
- Next action: Сгенерировать три концепта иконки и собрать компактный лист сравнения с wordmark «Аркспейс».
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Представлено не менее 3 различимых вариантов иконки, читаемых на 16–32 px.
- Выбранная иконка используется как favicon и рядом с wordmark.
- Во всех пользовательских точках бренда отображается «Аркспейс».
- Технические идентификаторы и имена экспортируемых файлов не переименованы без необходимости.
- Шрифт поддерживает кириллицу, имеет совместимую открытую лицензию и поставляется локально.
- Есть светлое/тёмное или контрастно-безопасное отображение иконки.
- Пройдены scoped tests, typecheck/lint и browser QA на auth и основном экране.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-505 — [arken-space] Hide player turn order until an encounter is active

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-505](https://linear.app/uixraydesign/issue/UIX-505/arken-space-hide-player-turn-order-until-an-encounter-is-active); parent none.
- Next action: Derive PLAYER turn-order rendering from the active authorized encounter selector and characterize GM pre-combat requirements before changing shared markup.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- PLAYER does not see or focus the turn-order block when no encounter is ACTIVE.
- The block appears automatically when the GM starts an encounter visible to that player.
- It disappears or transitions to an appropriate completed state when the encounter ends.
- Reload, reconnect and scene transition derive visibility from authoritative encounter state rather than stale local UI state.
- GM retains the required preparation and encounter-management controls before combat.
- Hidden PLAYER content does not leave empty spacing, separators or inaccessible focus targets.
- Tests cover pre-combat, active combat, encounter end, reconnect and PLAYER/GM role differences.
- Browser QA verifies the sidebar at narrow and default widths.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-499 — [arken-space] Мини-игра «Угадай персонажа по стикеру» с открытием букв

- Category **content-or-parallel-game**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-499](https://linear.app/uixraydesign/issue/UIX-499/arken-space-mini-igra-ugadaj-personazha-po-stikeru-s-otkrytiem-bukv); parent none.
- Next action: До реализации выбрать MVP-механику раунда и определить безопасную схему данных, при которой правильный ответ не передаётся клиенту заранее.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Игрок видит стикер, маску имени, использованные буквы и оставшееся число ошибок/попыток.
- Кириллица, регистр, пробелы, дефисы и повторяющиеся буквы обрабатываются корректно.
- Ответ нельзя получить из имени файла, alt-текста, клиентского payload или другого очевидного поля до завершения раунда.
- Подпись самого стикера не показывается во время угадывания.
- Раунд корректно заканчивается победой и поражением; после завершения открывается ответ.
- Можно перейти к следующему случайному персонажу без немедленного повтора.
- В игру попадают только карточки со статусом, разрешающим публикацию.
- Есть пустое состояние, загрузка, ошибка изображения и ситуация, когда доступных стикеров недостаточно.
- Интерфейс работает на desktop и mobile и доступен с клавиатуры.
- Добавлены тесты логики букв, маски имени, завершения раунда и защиты ответа от преждевременного раскрытия.
- Проведена browser-проверка полного сценария игрока.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-497 — Залить пак из 27 стикеров и дать мастеру интерфейс загрузки

- Category **content-or-parallel-game**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-497](https://linear.app/uixraydesign/issue/UIX-497/zalit-pak-iz-27-stikerov-i-dat-masteru-interfejs-zagruzki); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

No semantically matching acceptance/DoD heading; consult the untouched full original description in JSON.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-496 — Игрок хочет сам добавлять навыки и бонусы в свою колонку

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-496](https://linear.app/uixraydesign/issue/UIX-496/igrok-hochet-sam-dobavlyat-navyki-i-bonusy-v-svoyu-kolonku); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

No semantically matching acceptance/DoD heading; consult the untouched full original description in JSON.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-495 — Заметки об NPC в карточке персонажа

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-495](https://linear.app/uixraydesign/issue/UIX-495/zametki-ob-npc-v-kartochke-personazha); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

No semantically matching acceptance/DoD heading; consult the untouched full original description in JSON.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-480 — [arken-space] Add decorative cartographic location labels

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-480](https://linear.app/uixraydesign/issue/UIX-480/arken-space-add-decorative-cartographic-location-labels); parent none.
- Next action: Prepare two visual variants and define whether labels are a scene-title property, a location-marker property, or both.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- GM can choose plain or decorative label presentation per supported map/scene.
- Decorative labels remain readable across light/dark map art, pan/zoom and supported screen sizes.
- Label text is accessible as text; decoration does not replace the semantic name.
- Placement does not obscure tokens or essential map controls and can be adjusted by GM.
- Player visibility follows existing location/scene visibility rules.
- The first version uses approved local design assets or CSS/SVG treatment, not unreviewed external copyrighted assets.
- Include performance and reduced-motion constraints if labels animate.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-473 — [arken-space] Разобрать очередь отчётов из кнопки «Сообщить» — 9 непрочитанных

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-473](https://linear.app/uixraydesign/issue/UIX-473/arken-space-razobrat-ochered-otchyotov-iz-knopki-soobshit-9); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

No semantically matching acceptance/DoD heading; consult the untouched full original description in JSON.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-461 — Arken Space: генераторы навыков/артефактов и внутриигровая витрина

- Category **content-or-parallel-game**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-461](https://linear.app/uixraydesign/issue/UIX-461/arken-space-generatory-navykovartefaktov-i-vnutriigrovaya-vitrina); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Критерий успеха

Игрок может создать собственный навык или артефакт, получить понятную оценку его силы/стоимости, использовать его в кампании после одобрения GM, улучшить/объединить/разобрать объект и при необходимости выставить одобренный шаблон на общую витрину за внутриигровую валюту.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-459 — [arken-space] Прокачка способностей за SP: отдельный раздел управления

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-459](https://linear.app/uixraydesign/issue/UIX-459/arken-space-prokachka-sposobnostej-za-sp-otdelnyj-razdel-upravleniya); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Правила прокачки записаны в задаче до кода.
- Отдельный раздел управления прокачкой.
- Потраченные SP видны у персонажа и переживают перезагрузку.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-458 — [arken-space] Школы магии: дерево способностей, редактор и доступные ветки у персонажа

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-458](https://linear.app/uixraydesign/issue/UIX-458/arken-space-shkoly-magii-derevo-sposobnostej-redaktor-i-dostupnye); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Мастер создаёт и правит ветку: узлы, связи, описания, стоимость, частота.
- Ветка выдаётся персонажу; у персонажа видно, какие ветки ему доступны.
- Поддержаны ноль веток и кастомная школа.
- Контент 13 веток загружен как референс.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-457 — [arken-space] Рамки для бросков: своя у игрока, своя у скилла и школы

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-457](https://linear.app/uixraydesign/issue/UIX-457/arken-space-ramki-dlya-broskov-svoya-u-igroka-svoya-u-skilla-i-shkoly); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Игрок выбирает рамку из доступных и видит её на своих бросках.
- Мастер задаёт рамку скиллу; бросок этого скилла показывает её у всех.
- Приоритет источников задан явно и закреплён тестом.
- Рамка не тянет в ленту исходные мегабайты.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-430 — [arken-space] Область действия способности: применение ко всем союзникам в радиусе

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-430](https://linear.app/uixraydesign/issue/UIX-430/arken-space-oblast-dejstviya-sposobnosti-primenenie-ko-vsem-soyuznikam); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

No semantically matching acceptance/DoD heading; consult the untouched full original description in JSON.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-429 — [arken-space] Окно прокачки: игрок заявляет вложение очков, мастер применяет

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-429](https://linear.app/uixraydesign/issue/UIX-429/arken-space-okno-prokachki-igrok-zayavlyaet-vlozhenie-ochkov-master); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

No semantically matching acceptance/DoD heading; consult the untouched full original description in JSON.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-420 — [arken-space] Панель инструментов карты: хоткеи в подсказках и группировка

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-420](https://linear.app/uixraydesign/issue/UIX-420/arken-space-panel-instrumentov-karty-hotkei-v-podskazkah-i-gruppirovka); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- У каждого инструмента с хоткеем подсказка содержит клавишу.
- Клавиша берётся из общего источника; расхождение ловится тестом.
- Туман отделён от навигации.
- Инструменты, недоступные игроку, не показываются ему вовсе (проверить, что так и есть).

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-412 — [arken-space] Точечные события вместо полной рассылки снапшота

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-412](https://linear.app/uixraydesign/issue/UIX-412/arken-space-tochechnye-sobytiya-vmesto-polnoj-rassylki-snapshota); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Домены переводятся по одному, отдельными коммитами.
- На каждый новый event есть тест видимости — кто получает и кто нет.
- Количество полных рассылок на типовое действие измерено до и после.
- Реконнект по-прежнему приводит клиента к каноническому состоянию.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-382 — [arken-space] Design multi-track soundtrack mixer with per-track and master volume

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-382](https://linear.app/uixraydesign/issue/UIX-382/arken-space-design-multi-track-soundtrack-mixer-with-per-track-and); parent none.
- Next action: Approve transport semantics and a bounded maximum track count, then define the audio-state migration and client mixer contract.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- GM can start, stop and manage more than one authorized campaign audio asset concurrently.
- Each active track has an independent GM-controlled mix volume; player has a local master volume that never writes into campaign state.
- Joining, reload and reconnect converge to the intended active mix without duplicate playback.
- Removing/replacing a track safely releases the corresponding audio element.
- Existing single-track campaigns migrate without losing current playback settings.
- Realtime, authorization and browser tests cover GM/player, reconnect and at least two concurrent tracks.
- Performance limits and autoplay/consent behavior are specified before implementation.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-379 — [arken-space] Add player achievement collection and GM achievement builder

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-379](https://linear.app/uixraydesign/issue/UIX-379/arken-space-add-player-achievement-collection-and-gm-achievement); parent none.
- Next action: Define visibility and asset-selection rules, then prototype a small achievement-card model before implementation.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- GM can create, edit, archive and award an achievement to one or more players.
- An achievement supports approved icon/asset reference, colour, title, optional description and provenance.
- Player profile displays only achievements that are visible to that player/audience.
- Award/revoke events are auditable and do not leak GM-only context.
- Reuse of game-pack media respects the existing asset ACL and lifecycle rules.
- UI supports the two initial example achievements without hard-coding them.
- Authorization, persistence and visibility tests cover GM, owner and other players.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-378 — Сделать WebAR-просмотр обложки «Рубиновый орден» на arken-khar.space

- Category **content-or-parallel-game**; Linear **Backlog**; implementation **Evidence linked; implementation/acceptance not inferred.**
- Source [UIX-378](https://linear.app/uixraydesign/issue/UIX-378/sdelat-webar-prosmotr-oblozhki-rubinovyj-orden-na-arken-kharspace); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Критерии готовности MVP

- На [arken-khar.space](http://arken-khar.space) существует отдельная AR-страница.
- Она открывается с телефона без установки приложения.
- Пользователь может дать доступ к камере.
- Обложка «Рубиновый орден» стабильно распознаётся.
- Цветной анимированный контент визуально привязан к печатной обложке.
- После успешного прототипа понятно, как тем же механизмом подключать другие иллюстрации книги.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-371 — [arken-space] Manual QA checklist — накопительный список для ручного тестирования

- Category **parent-or-acceptance**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-371](https://linear.app/uixraydesign/issue/UIX-371/arken-space-manual-qa-checklist-nakopitelnyj-spisok-dlya-ruchnogo); parent none.
- Next action: Прогнать целиком одним заходом, отметить проваленные пункты — заведём отдельные баги под каждый провал.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Проверить

### Линейка (ruler)

- [ ] Протянуть линейку, отпустить — дистанция показывается в клетках сетки ("N кл." / "N px без сетки" вне сетки).
- [ ] На дальнем конце линейки видна стрелка.
- [ ] Протянуть линейку → переключить инструмент кнопкой → линия пропадает у всех участников.
- [ ] Протянуть линейку → нажать Esc → линия корректно пропадает (не остаётся висеть на карте).

### Рисование (DRAW)

- [ ] Быстро потаскать слайдер толщины линии — ошибок "Не удалось выполнить действие" быть не должно.
- [ ] Сменить цвет через палитру и через color-picker — без ошибок.
- [ ] Нарисовать линию — не должно быть заметной задержки/пропадания линии после отпускания кнопки мыши.
- [ ] Начать рисовать → нажать Esc посреди штриха → штрих должен отмениться (не оставаться и не "выпрыгивать" при следующем включении DRAW).

### Видимость слоёв

- [ ] Не-GM роль не видит GM-слой токенов.
- [ ] Токены с `visible=false` на MAP-слое не видны игрокам, только GM.

### Fog (туман войны)

- [ ] REVEAL/COVER применяются в правильном порядке при перекрытии операций.
- [ ] BRUSH-инструмент fog работает (circular brush). POLYGON пока не реализован — ожидаемо недоступен.

### Домен и инфраструктура

- [ ] Логин и вся функциональность работают через `arken-khar.space`.
- [ ] Старые ссылки на `arken.uixray.tech` корректно редиректят на новый домен.
- [ ] 6 личных страничек игроков открываются (archinamon/irakly123/daryasteel/veepeek/zheludock/uixray.arken-khar.space).

### Прочее

### Operator feedback inbox (<issue id="450acb54-0cdf-4911-bec2-95443a07b8ac" href="https://linear.app/uixraydesign/issue/UIX-318/arken-space-add-secure-operator-feedback-inbox-and-restore-trusted">UIX-318</issue>)

- [ ] Зайти под GM-аккаунтом — в Sidebar должен быть доступен инбокс фидбэка.
- [ ] С player-аккаунта (любого из 6 игроков) инбокс НЕ должен быть виден/доступен.
- [ ] Открыть отчёт, проверить reveal/скрытие контактных данных по умолчанию, смену триаж-статуса.
- [ ] Вкладка "Личные" (direct messages) скрыта из чат-панели (<issue id="0dcb7e14-63a2-4d4c-958a-721ba78a0cc5" href="https://linear.app/uixraydesign/issue/UIX-365/arken-space-redesign-direct-messages-mechanic-before-re-enabling">UIX-365</issue>, до редизайна).

### <issue id="dc11889c-ff75-4d84-b7d9-e01c381e1c17" href="https://linear.app/uixraydesign/issue/UIX-363/arken-space-improve-chattoken-ux-paste-images-draggable-dice-panel">UIX-363</issue> — пул UX-правок

- [ ] Ctrl+V и Cmd+V вставляют картинку из буфера обмена в личный чат; вставка текста работает как раньше.
- [ ] Перетащить токен из трея на карту под GM — работает.
- [ ] То же под игроком с правами на токен — работает; без прав — перетаскивание недоступно.
- [ ] GM может создать персонажа "на основе" существующего — статы/навыки/инвентарь переносятся, имя/портрет/заметки — нет; изменения нового персонажа не влияют на исходный. Недоступно игрокам.
- [ ] Панель быстрых бросков костей перетаскивается за ручку-грип, остаётся в границах экрана, кнопка сброса позиции работает; сами броски костей работают как раньше.

### <issue id="118b00ac-6330-48db-ac13-343bf5aff2b3" href="https://linear.app/uixraydesign/issue/UIX-292/arken-space-add-character-sheet-media-galleries-and-illustrated">UIX-292</issue> — медиагалерея персонажа

- [ ] Игрок загружает картинки в галерею своего персонажа (портрет при этом не ломается).
- [ ] Открытие в full-size просмотрщике, навигация стрелками/Esc работает.
- [ ] Смена категории/подписи/порядка работают без ошибок.
- [ ] "Убрать из галереи" (detach) доступно владельцу; файл при этом не удаляется физически.
- [ ] Только GM видит кнопку "Удалить навсегда" и может её использовать — у владельца её нет.
- [ ] GM может зайти на ЛЮБОй лист персонажа (не только свой) и управлять его галереей, включая GM-only материалы, которые владелец не видит.
- [ ] Игрок-контроллер (без владения) НЕ видит кнопок редактирования галереи чужого персонажа.

### Бой с карты/региона (<issue id="cd038783-025b-43e0-9ef3-eda09ac167a5" href="https://linear.app/uixraydesign/issue/UIX-311/arken-space-start-encounters-from-map-regions-or-linked-tactical">UIX-311</issue>)

- [ ] GM: кнопка «Начать бой» на тактической карте → «Выделить область текущей сцены» → выделить прямоугольник на карте → подтвердить — камера всех участников фокусируется на выделенной области.
- [ ] «Завершить бой» после SCENE_REGION — камера возвращается к обзору всей сцены.
- [ ] GM: «Начать бой» → «Перейти в другую локацию» → выбрать локацию со связанной сценой → видно preflight-предупреждение, если у игрока нет токена на целевой сцене.
- [ ] После подтверждения LINKED_SCENE — все игроки переключаются на целевую сцену одновременно, токены игроков перенеслись на относительно ту же позицию, что была на исходной сцене.
- [ ] «Завершить бой» после LINKED_SCENE — игроки НЕ возвращаются на исходную сцену автоматически.
- [ ] То же через «Начать бой» в рабочем пространстве карты мира (только LINKED_SCENE там должен быть доступен, не SCENE_REGION).
- [ ] Игрок не видит кнопки «Начать/Завершить бой» вообще.

- Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-365 — [arken-space] Redesign direct messages mechanic before re-enabling

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-365](https://linear.app/uixraydesign/issue/UIX-365/arken-space-redesign-direct-messages-mechanic-before-re-enabling); parent none.
- Next action: Scope the design questions above with the user before touching code.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Design brief covering: who can DM whom, GM visibility into DM content (if any), notification/unread behavior, relationship to the existing activity feed.
- UI/UX pass on the entry point (currently a plain tab button) and thread list/composer.
- Tab re-enabled in Sidebar.tsx once design is approved and any needed backend changes are made.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-347 — [arken-space] Add reusable terrain stamp brushes for scene drawing

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-347](https://linear.app/uixraydesign/issue/UIX-347/arken-space-add-reusable-terrain-stamp-brushes-for-scene-drawing); parent none.
- Next action: Prototype the data model and renderer performance with one curated pack and 100–500 placed stamps before designing pack management.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Stamp brushes are a separate drawing mode and cannot accidentally modify fog.
- GM can select a stamp from a curated palette, preview placement, set size and rotation, and place repeated instances efficiently.
- MVP includes representative forest, mountain and cloud stamps or an equivalent test pack.
- Placed stamps are persistent server-authoritative scene objects with stable IDs, author, transform, layer and revision.
- Stamps participate in selection, area selection, move, copy, delete, undo and redo.
- Visibility/layer rules are explicit; PLAYER cannot access hidden GM-only stamps or their assets.
- Asset delivery does not preload hidden stamp packs for unauthorized clients.
- Dense stamping has documented batching, payload and renderer-performance limits.
- Pointer, keyboard and touch behavior is compatible with the shared interaction-command architecture.
- Tests cover permissions, persistence, reconnect, undo/redo, repeated placement and large stamp counts.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-314 — [arken-space] Render fully opaque animated cloud texture over fog

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-314](https://linear.app/uixraydesign/issue/UIX-314/arken-space-render-fully-opaque-animated-cloud-texture-over-fog); parent none.
- Next action: Prototype one low-resolution Canvas2D cloud layer over a fixed opaque mask and measure frame time/memory before selecting final art or WebGL.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Covered player pixels remain fully opaque regardless of cloud animation frame, texture alpha or blending.
- REVEAL/COVER geometry and hit/visibility behavior are unchanged.
- Cloud texture is clipped to covered fog and never becomes the coverage mask itself.
- Boundary rendering has no transparent pinholes; pixel tests confirm covered alpha remains 255.
- GM preview opacity remains separate and cannot alter PLAYER opacity.
- Animation pauses when document is hidden and uses a static fallback for reduced motion and low-power mode.
- Animation frame rate and resolution are capped; mask geometry/cache is not rebuilt every animation frame.
- Long sessions, large scenes and many fog operations remain responsive.
- Missing texture or rendering failure falls back to the current solid fog.
- No hidden map data is sampled to generate the cloud texture.
- Browser QA covers reload, reconnect, zoom/pan, resize, supported narrow viewports and different DPR values.
- Tests include deterministic mask composition, opaque pixel assertions, reduced-motion fallback and performance budget.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-269 — [arken-space] Prototype a safe bidirectional Telegram bridge for story chat and dice

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-269](https://linear.app/uixraydesign/issue/UIX-269/arken-space-prototype-a-safe-bidirectional-telegram-bridge-for-story); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- A GM explicitly links one Telegram chat/thread to one campaign using a short-lived, single-use token; arbitrary chats cannot attach themselves.
- Telegram webhook requests are authenticated and updates are durably deduplicated by Telegram update/message identifiers.
- Service STORY publication can mirror supported text/images to the linked Telegram destination without exposing drafts, GM notes, provenance or hidden attachments.
- Supported Telegram messages can enter a review queue or configured published flow with explicit author mapping and rights status; unknown users are rejected or quarantined.
- Echo loops are prevented using a persisted internal↔Telegram message mapping and origin marker.
- `/roll` commands use the server's existing canonical dice pipeline; one roll is persisted once and the same result is rendered in the service and Telegram.
- Retries are idempotent; partial media failures are visible and recoverable.
- Token, chat ID and webhook secret are stored as secrets/private configuration and never sent in player payloads or logs.
- Rate limits, media type/size validation, edit/delete policy, audit log and unlink/kill switch are defined and tested.
- The first release is limited to a test bot and test campaign; production activation requires a separate explicit gate.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-265 — [arken-space] Design regional economy and server-authoritative shops

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-265](https://linear.app/uixraydesign/issue/UIX-265/arken-space-design-regional-economy-and-server-authoritative-shops); parent none.
- Next action: Leave in backlog until item instances and calendar contracts are approved.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Item templates have a base price and currency/unit.
- Markets/merchants define region, stock and applicable pricing rules.
- Price quotes are calculated server-side from base price plus explicit region, season, merchant, supply, buyer-charisma and GM modifiers.
- Every quote records the input revision, applied factors, rounding and final price.
- Quote expiry/revalidation prevents buying against stale stock, wallet or rules.
- Purchase atomically updates wallet, stock, inventory and transaction history.
- Repeated action IDs cannot duplicate a purchase.
- Player cannot substitute another character, charisma value, region, season or price.
- GM may override a price only with a recorded reason.
- Hidden stock and GM pricing rules are filtered server-side.
- Tests cover concurrent purchase, insufficient funds, stale quote, seasonal change, charisma modifier, rollback and authorization.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-264 — [arken-space] Build GM world-entity and campaign-instance manager

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-264](https://linear.app/uixraydesign/issue/UIX-264/arken-space-build-gm-world-entity-and-campaign-instance-manager); parent UIX-245.
- Next action: Approve the canonical-vs-instance boundary and minimal field matrix for each entity type.
- Dependencies: parent:UIX-245.
- Original acceptance / DoD sections:

## Acceptance Criteria

- GM can create, edit, version, archive and relate canonical MVP entity types.
- Entities support aliases, type/subtype, tags, public summary/text, GM-only text, cover and ordered gallery.
- Canonical location/person/monster/item records can be referenced from multiple campaigns.
- Campaign instances can override display name, current state, GM notes, portrait/token, owner and current location without changing canon.
- One canonical NPC/monster can have multiple independent campaign instances.
- Item instances support at least quantity, owner/container and condition; pricing is explicitly out of scope.
- Location entities link to world-map nodes and zero or more local scenes.
- Revisions/CAS prevent silent overwrite; operations are idempotent and audited.
- Deleting an entity used by maps, chronicles or campaigns is rejected or converted to an explicit archive flow.
- Player APIs never expose drafts, GM fields, hidden relations or private media.
- Browser verification covers create/edit/link/archive and player-safe projection.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-263 — [arken-space] Import and reconcile Tilda, Framer and Eagle world content

- Category **core-development**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-263](https://linear.app/uixraydesign/issue/UIX-263/arken-space-import-and-reconcile-tilda-framer-and-eagle-world-content); parent UIX-245.
- Next action: Produce a read-only inventory and conflict matrix before implementing or importing data.
- Dependencies: parent:UIX-245.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Tilda, Framer and Eagle records retain stable external IDs/URLs, retrieval date and raw checksum.
- Source priority is provisional: Tilda newer > Framer legacy; every field conflict enters a review queue.
- Eagle originals are matched by ID/checksum/curated mapping rather than filename alone.
- Each asset stores attribution, rights-review status and relation to original/derivative variants.
- Re-import is idempotent and never creates duplicate entities or media.
- Imports create DRAFT records only and cannot publish automatically.
- Unknown types, missing masters, conflicting names and unmatched assets produce actionable warnings.
- Responsive duplicates from the Framer page are collapsed into one logical media record.
- No source content is deleted or modified.
- A reviewed migration report lists created, matched, skipped, conflicted and blocked records.
- Location media can later be selected by <issue id="7d03f894-387a-4eb4-8e51-40fa73d7aa3a" href="https://linear.app/uixraydesign/issue/UIX-243/arken-space-add-hierarchical-world-maps-party-position-and-explicit">UIX-243</issue> without duplicating the file.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-262 — [arken-space] Model versioned spell-school progression graphs

- Category **core-development**; Linear **Backlog**; implementation **Evidence linked; implementation/acceptance not inferred.**
- Source [UIX-262](https://linear.app/uixraydesign/issue/UIX-262/arken-space-model-versioned-spell-school-progression-graphs); parent UIX-209.
- Next action: Produce a structured inventory of every 2024 school/node/edge and an ambiguity report, then review it with the GM before any production seed/import.
- Dependencies: parent:UIX-209.
- Original acceptance / DoD sections:

## Acceptance Criteria

- The system stores spell progression as a validated directed graph supporting forks and converging prerequisites.
- Cycles, dangling references, duplicate edges and cross-pack corruption are rejected.
- ALL versus ANY prerequisite semantics are explicit.
- A spell’s narrative text, mechanics, costs and activation conditions are separate fields consistent with <issue id="9cd314c3-83a4-49ad-8300-8b9cad815495" href="https://linear.app/uixraydesign/issue/UIX-261/arken-space-render-skill-and-ability-usage-as-immersive-chat-cards">UIX-261</issue>.
- Usage cadence supports examples ranging from per-combat to per-session, weekly and monthly limits.
- Passive abilities and active abilities are distinguishable; hybrid passive+activation entries are supported.
- GM can create, edit, archive, version and assign a school or individual spell.
- Character assignment snapshots rules/provenance so later pack edits do not rewrite existing characters silently.
- GM can override prerequisites with an auditable reason.
- Player visibility supports discovered/available/locked/hidden nodes without leaking hidden mechanics in API payloads.
- Graph layout is presentation metadata and can be recomputed without changing progression rules.
- Import tooling first produces a reviewable draft with validation warnings; it never promotes the 2024 reference pack directly to canonical rules.
- Tests cover branching, convergence, ALL/ANY requirements, cycle rejection, versioning, assignment snapshots, role filtering and legacy catalog compatibility.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-245 — [arken-space] Build world encyclopedia and campaign chronicles

- Category **parent-or-acceptance**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-245](https://linear.app/uixraydesign/issue/UIX-245/arken-space-build-world-encyclopedia-and-campaign-chronicles); parent none.
- Next action: Complete a source inventory and conflict matrix, then approve the canonical world entity and media provenance contracts before importing any content.
- Dependencies: none returned.
- Original acceptance / DoD sections:

## Acceptance Criteria

- World content survives campaign deletion and can be reused across campaigns.
- GM can manage MVP entity types, relations, tags, covers and galleries.
- Player encyclopedia exposes only PUBLISHED or campaign-discovered content.
- GM-only names, text, relations, drafts and media cannot be discovered through search, API, snapshot, DOM or direct asset URLs.
- Search and filtering cover type, tags, region/era and known relations.
- Stable entity pages show connected locations, people, creatures and articles.
- Chronicle entries sort by game-world time rather than server creation time.
- GM can author/edit/publish chronicle entries and attach entity/media references.
- A technical game event can seed a chronicle draft but its raw payload is never published.
- Canonical entities and campaign instances are distinct; campaign overrides never silently rewrite canon.
- Location entities integrate with <issue id="7d03f894-387a-4eb4-8e51-40fa73d7aa3a" href="https://linear.app/uixraydesign/issue/UIX-243/arken-space-add-hierarchical-world-maps-party-position-and-explicit">UIX-243</issue> map nodes without duplicating descriptions or images.
- Revision/CAS, idempotent action IDs and audit history protect edits.
- Accessibility, desktop/narrow layouts and player/GM browser flows are verified.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.

### UIX-217 — [arken-space] Full product GM + 6 acceptance rehearsal

- Category **parent-or-acceptance**; Linear **Backlog**; implementation **Unknown.**
- Source [UIX-217](https://linear.app/uixraydesign/issue/UIX-217/arken-space-full-product-gm-6-acceptance-rehearsal); parent none.
- Next action: Подтвердить актуальный scope по Linear и выполнить первый непроверенный пункт Acceptance Criteria.
- Dependencies: blockedBy:UIX-222, blockedBy:UIX-221, blockedBy:UIX-220, blockedBy:UIX-219, blockedBy:UIX-218, blockedBy:UIX-215, blockedBy:UIX-211, blockedBy:UIX-214, blockedBy:UIX-210, blockedBy:UIX-216.
- Original acceptance / DoD sections:

## Acceptance Criteria

- Fresh verified backup and tested migration/reset evidence exist first.
- Automated unit/integration/browser/GM+6/recovery gates pass at deployed revision.
- A 30–45 minute rehearsal covers access, characters/catalog/rolls, currency, canvas, undo/redo, tokens, chat, presence and music.
- Chrome, Firefox and Edge are represented.
- Adversarial checks show no cross-player mutation or GM-layer leak.
- Defects include reproduction, expected/actual, revision and action/request IDs.
- Readiness requires blockers fixed and rerun.

* Gaps: implementation, deployed revision, automated checks, manual/device acceptance, and user acceptance remain unknown unless explicitly evidenced.
