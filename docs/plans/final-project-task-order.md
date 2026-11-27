# Очередь завершения проекта — 27.11.2026

Решение владельца от 27.11: сначала обновить production до актуальной серверной версии, затем завершать остальные задачи. Автономный режим — отдельное направление; локальный установщик готовить после остальных задач. Исследование первого входа, портфолио и общий продуктовый кейс теперь идут перед локальной сборкой. Календарные и внешние зависимости учитывать отдельно.

## Приоритет текущего этапа
1. Актуальный серверный релиз: сверить живой production, собрать кандидат поверх main, опубликовать и проверить.
2. Остальные задачи: пакет токенов, координация Blender-сцены, исследование входа, портфолио и продуктовый кейс; продление HTTPS по календарю.
3. Завершение автономного направления и локальной сборки после остальных задач.

Историческая таблица ниже отражает прежнюю очередь; приоритет текущего этапа выше неё.

Живая сверка Linear 27.11: started 3, backlog 4, unstarted 0, triage 0; все четыре выборки без следующей страницы. Всего 7 открытых задач. Linear остаётся источником статусов и критериев; этот файл задаёт порядок исполнения, а не меняет критерии закрытия.

| Порядок | Задача | Относительная сложность / условие исполнения |
|---|---|---|
| 1 | UIX-679 — продление HTTPS | Низкая; календарное выполнение 25.12.2026 |
| 2 | UIX-590 — запасной пакет токенов для Семёна | Низкая/средняя; нужны конкретная кампания и разрешённые исходники |
| 3 | UIX-800 — Blender-сцена Келзериаса | Средняя/высокая; исполнение закреплено за другим чатом |
| 4 | UIX-683 — автономный режим и синхронизация | Очень высокая; ближайшая доступная кодовая задача здесь |
| 5 | UIX-660 — исследование первого входа | После реализаций; реальные участники, результаты и доработка сценария |
| 6 | UIX-661 — публикация портфолио-кейса | После исследования и подготовки подтверждённых материалов |
| 7 | UIX-653 — общий продуктовый кейс | Последний итоговый этап |

При календарном или внешнем ограничении фиксировать условие и переходить к следующей доступной задаче. Одна активная реализация здесь; работа другого чата остаётся у её исполнителя. Возвращаться к ранее недоступной простой задаче при снятии ограничения.

## Текущее продолжение

Автономный режим: реализованы внутренний захват всех 128 таблиц, запись данных/медиа/проекций, единый структурный кандидат и SQL-проверка ограничений во временных таблицах с проверкой целевой схемы и миграций. Следующий связанный этап — полная согласованность игровых данных и истории, native PostgreSQL и наполненные кампании, затем архив/восстановление, атомарный импорт и интерфейс. Остальные исходные требования local-first/P2P и итоговая приёмка сохраняются.

Исходная ревизия: cd768ba4ebb22e842fa0f59254f32655e0fdba63; существующий WIP сохранён. Последний checkpoint — .qa-temp/final-release-20261126/POOL156-CHECKPOINT.md. Живая сверка Linear117 подтверждает7 открытых задач; очередь и условия первых трёх пунктов прежние. Internal readers не заменяют готовый пользовательский экспорт/импорт или финальный выпуск.

Пул 126: добавлен потоковый зашифрованный файл переноса и аутентифицированное обратное чтение в отдельный private stage; 42 связанных проверки и server tsc пройдены. Следующий пользовательский этап — авторизованное скачивание через интерфейс и атомарный локальный импорт.

Пул 127: скачивание зашифрованного файла через кабинет мастера реализовано локально; native PostgreSQL18 и реальный браузер 1365/390 подтверждают перенос 57 строк и иллюстрации, 69 связанных проверок пройдены. Следующий этап — атомарный импорт файла в локальную установку и запуск кампании. Живая сверка gate127: семь открытых задач.

Пул128: реализован внутренний атомарный импорт кампании в отдельную локальную БД с привязкой владельца, свежими медиа и receipt/recovery;70 связанных проверок, native PostgreSQL18 под ограниченной ролью и поздний rollback пройдены. Следующее — загрузка файла через локальный интерфейс и запуск кампании. Gate128: семь открытых задач.

Пул129: локальный кабинет принимает файл кампании и открывает её игровой стол. Настоящие AccountAuthWorkspace/CampaignRouter/App + Fastify/nativePG18 проверены браузером;72 связанных проверки, desktop/mobile формы просмотрены. Следующее — команды GM/PLAYER после импорта, restart/recovery и актуализация desktop candidate. Gate129: семь открытых задач.

Пул130: startup recovery, атомарные маркеры и защита потерянного COMMIT ACK реализованы. Три реальные остановки собственных importer-процессов подтверждены на nativePG18;49 связанных проверок и повтор настоящего UI/стола прошли. Следующее — восстановление повреждённых media из исходного файла, затем GM/PLAYER после import/restart. Gate130: семь открытых задач.

Пул131: добавлено восстановление актуальных файлов из исходного authenticated архива без отката персонажей и событий;89 связанных проверок, server/web tsc и native browser1365/390 прошли. Следующее — peer media cache и GM/PLAYER после import/restart. Семь открытых задач.

Пул132: версии peer chunks учитывают ремонт по прежнему ключу; чтение метаданных/байтов закреплено за одним FileHandle.30 проверок/server tsc/native browser прошли. Следующий этап — явная media revision для готового peer/PLAYER кеша; Windows active-reader repair требует обработки EPERM/retry. Gate132:7open.

Пул133: opaque mediaRevision связывает repair с очисткой peer Blob cache;104 связанных проверки подтверждают обновление сохраняемых байтов через настоящий player runtime при неизменном snapshotVersion. Native repair меняет поколение. Следующий этап — настоящие GM+PLAYER UI/restart и Windows active-reader retry. Gate133:7open.

Пул134: исправлен Windows active-reader repair — boundedretry и понятный409/повтор в UI;57 связанных проверок,server/web tsc и nativebrowser реального openhandle→busy→close→repair прошли. Далее настоящийGM+PLAYER/restart. Gate134:7open.

Пул135: actual imported GM+PLAYER WebRTC/chat/revoke прошёл после исправления закрытия livePLAYERстола.45 unitchecks/webtsc прошли. Визуально найден unsupported automatic App action toast — следующий кодовый дефект; полнаяPLAYERприёмка ещё открыта. Gate135:7open.

Пул136: подключены настоящие rolefiltered чтения истории/саундпада, безопасное PLAYERcapability и cleanupcursor.89 проверок,types,nativeWebRTCpassed;unsupportedstartupToast устранён и визуально подтверждён. ДалееGM+2PLAYERmap/commands/media/restart и savedcopyruntime. Gate136:7open.

Пул137: nativeGM+2PLAYER на импортированнойкампании подтвердиливидимуюкарту,токенmove,серверныйroll,privateA↔BбезGMдоступа,hotrepairсобновлениемобоихBlobкэшей,publicchat/revoke. Далеереальныйrestart/reconnectиsavedcopyreadcommands. Gate137:7open.

Пул138: реальный новыйNodeprocessснастоящимиroutesнасохранённойtargetDB подтвердилточнуюсохранностьevents/token/private иповторныйWebRTCPLAYERвход. Runtimehandlers≠новыйinstalledWindowsEXE;этоостаётсявплане. Далеекодsavedcopyreadcommands/LOCALexport. Gate138:7open.

Пул139: readonlycopy отключаетhostUndo иявнообъясняетнесохранённыйsoundpadcatalogue;73проверки/webtscпрошли. Выявленаобязательнаяследующаяправка exactsequence/cacheдляbigintbaseline;actualsavedcopybrowserпосленеё. Gate139:7open.

Пул140: exactsnapshotSequence/BigIntordering/encryptedcacheversion исправляютсохранениеприbaselineвышеMAX_SAFE;102проверки иnativeencryptedcopyUI прошли. Legacyunsafe pointevents требуютcanonicalresync вместоокруглённогоприменения. Далеекопияcapabilities/metadata,LOCALexport. Gate140:7open.

Пул141: readonlycopyкартаотключаетmutationtools/placement/drag;39проверок,webtsc,nativeencryptedcopyUIпройдены. ОстальныеAppmutationcontrols/статуснаяполосаимetadataкопиитребуютпродолжения. Gate141:7open.

Пул142: encrypted bundle4 сохраняет полученные catalogue/history metadata со scope-проверками;98 проверок, server/web tsc и native сохранение настоящего каталога/WAV прошли. Далее local-only playback и остальные readonly UI/copy qualification, затем LOCAL export. Gate142:7open.

Пул143: local-only Blob playback в копии;31 проверка/webtsc/native Chromium play+ended прошли. Далее readonly UI controls и status layout, затем LOCAL export. Gate143:7open.

Пул144: shared readonly context отключает sidebar resources/roll/composers и новые DM;skip-link layout исправлен с keyboard focus.77проверок/webtsc/nativecopyUI прошли. Далее workspace edit boundaries, LOCAL export. Gate144:7open.

Пул145: readonly character edit/portrait/roll/notes границы реализованы;118 проверок/webtsc/nativecorecard прошли. Визуально найден workspace/status overlap — следующий код, затем LOCAL export. Gate145:7open.

Пул146: исправлен portal карточки персонажа относительно локального стола;50 проверок/webtsc/native browser и визуальная проверка desktop пройдены. Далее LOCAL-source export. Последний live gate145:7open. Checkpoint: `.qa-temp/final-release-20261126/POOL146-CHECKPOINT.md`.

Пул147: LOCAL-source export подключён к кабинету с проверкой владельца экземпляра;47 проверок, servertsc, реальный PG18/browser export/decrypt прошли. LOCAL→файл→новыйLOCAL с новым владельцем/событиями/медиа проверен интеграционно. Live gate147:7open. Далее durable cloud reconciliation/APPLIED и authority/write ownership.

Пул148: cloud intake проверяет точный baseline, участников кампании, конфликты actionID и смену пароля владельца;61 проверка/servertsc пройдены. Далее durable writer/CAS fence всех путей записи перед typed APPLIED. Последний live gate147:7open.

Пул149: durable cloud writer/CAS и SQL fence78 игровых таблиц;140 проверок/servertsc/nativePG18 concurrency/rollback/CAS/archive-race пройдены. Схема105миграций/130таблиц. Далее typed state apply + durable APPLIED receipts и control-plane. Последний live gate147:7open.

Пул150: первый typed apply (название кампании), atomic APPLIED/mappings/cursors, exact retry/status/release lifecycle;144 проверки/servertsc/две реальныеPG18 базы+outbox+grant+duplicate apply пройдены. Схема106миграций/131таблица. Далее token/domain apply и control-plane/APPLIED lifecycle. Live gate150:7open.

Пул151: typed TOKEN_MOVED через shared core с ACL/геометрией/паузой/ревизиями/redo/journal;155 проверок/servertsc/две реальныеPG18 базы+controlledPLAYERmoves пройдены. Далее durable command/reference context и остальные домены, control-plane/APPLIED lifecycle. Последний live150:7open.

Пул152: shared TOKEN_MOVE undo/redo через стабильный actionUUID и точные локальные journal keys;197 проверок/servertsc/HTTPbigint и две реальныеPG18 базы с разными journal spaces пройдены. Далее остальные token state/history и домены, control-plane/APPLIED lifecycle. Live152:7open.

Пул153: shared resize/appearance/conditions + typed apply/history, точное округление111x74;211 проверок/servertsc/две реальныеPG18 базы с12applied events и совпавшими5journalrows пройдены. Далее рисунки/туман и остальные домены, control-plane/APPLIED lifecycle. Live153:7open.

Пул154: shared создание drawing/fog + typed apply с UUID/ACL/геометрией/полным journal;203 проверки/servertsc/две реальныеPG18 базы с15events/4receipts и разными fog order keys пройдены. Далее drawing update/delete и drawing/fog history, остальные домены/control-plane/APPLIED lifecycle. Последний live153:7open.

Пул155: shared drawing update/copy/delete и DRAWING/FOG undo/redo + typed apply;207 проверок/servertsc/две реальныеPG18 базы с22events/5receipts/11semanticjournals пройдены. Далее owner control-plane/UI и APPLIED confirmation/baseline binding, остальные домены. Live155:7open.

Пул156: issued archive/import lineage + проверка владельца/SHA/baseline/schema и readonly descriptor/UI;144проверки/server+webtsc/nativePG18/browser/desktop visual пройдены. Схема107миграций/132таблицы. Далее current-state/coverage preflight перед публичным writer control-plane и APPLIED confirmation. Live156:7open.

Пул157: исправлена очередь изменений подготовки сразу после импорта и после остановки сессии; неактивное владение epoch1, миграция0107. Связанные58/58 и server tsc пройдены. Далее bounded coverage/current-state preflight и writer lifecycle. Последний live156:7open. Подробности: POOL157-CHECKPOINT.md.

Пул158: серверный owner-only preflight выявляет пропущенные/искажённые события с точными bigint и bounded scan под writer fence. Связанные61/61, server tsc и native PG18/130events/две backend-блокировки пройдены. Далее current-cloud equality и полный writer/APPLIED lifecycle; COVERED не означает равенство SQL-состояния. Live158:7open. POOL158-CHECKPOINT.md.

Пул159: server-only передача writer CAS теперь возможна после реального полного capture/digest сравнения с issued архивом в одной fenced транзакции; unlogged изменения отклоняются. Связанные122/122/server tsc/nativePG18 пройдены. Далее публичный lifecycle+APPLIED/owner UI с локальным coverage. Последний live158:7open. POOL159-CHECKPOINT.md.

Пул160: проверка полноты очереди показана в GM-интерфейсе, shared strict bigint contract, bounded owner lock.80/80/server+web tsc и целевой nativePG18/browser503/desktop1365/mobile390 visual пройдены. Два расширенных inherited peer-прогона остановлены как зависшие, PASS им не присвоен; финальный прогон ограничен новым связанным сценарием. Далее owner writer/APPLIED lifecycle. Live160:7open. POOL160-CHECKPOINT.md.

Пул161: облачный owner-only кабинет показывает право записи и STORED_ONLY/APPLIED с точной пагинацией20; исправлены доступные имена полей.69сценариев (63server/contract+6UI re-run), server/web tsc, native limitedPG18/21receipts+1actualapply/real cookie+CSRF/browser1365+390 visual пройдены. Далее public lifecycle и локальное APPLIED confirmation; статус не является permit/dequeue proof. Live161:7open. POOL161-CHECKPOINT.md.

Пул162: scoped bearer чтение APPLIED/STORED_ONLY и точный локальный HTTPS verifier исходного batch/hash/всех action mappings.63/63/server+web tsc и native limitedPG18/realHTTP/2actualapply/release/revocation пройдены; HTTPS adapter отмечен явно. Далее durable local proof/applied cursor/UI и offline closed-source recovery. Live162:7open. POOL162-CHECKPOINT.md.

Пул163: durable APPLIED proof+ordered cursor, original metadata/hash-proven legacy reconstruction, local owner check/UI.109миграций/132таблицы.102/102/server+web tsc, two nativePG18 DBs/real game auth/browser1365+390/new Node proof reader пройдены; OS/cloud adapters указаны. Retained count честно переименован; target-aware pending ещё требуется. Далее readonly closed-source grant recovery/status без истёкшего ключа и индекс polling, затем public lifecycle/lineage. Live163:7open. POOL163-CHECKPOINT.md.

Пул164: локальная saved-proof history доступна при expired/missing OS key, keyset20 paging; OS load вынесен из root lock; выбранный новый сервер не наследует старый ACK.99/99/server+web tsc/native expired-adapter/8lock probes/browser1365+390 long-host visual пройдены. Далее readonly CLOSED-source grant recovery для ещё не скачанных подтверждений +индексы, public lifecycle/lineage. Live164:7open. POOL164-CHECKPOINT.md.

Пул165: CLOSED-source expired grant восстановление через отдельный READ_RECEIPTS_ONLY, intake/local send403, реальный cloud account UI->local missing APPLIED.110миграций/132таблицы +poll/history indexes.102сценария(95+7UI re-run), server/web tsc, native2DB/browser/DPAPI round-trip пройдены. Далее public writer/eligibility/all-domain reconciliation и epoch/archive/schema lineage; полный scope активен. Live165:7open. POOL165-CHECKPOINT.md.

Пул166: shared member rename+scene activation в sourceHTTP/cloud apply, actor/pause/tenant/revision checks;106/106/server tsc/native2DB semantic clock+proof passed. Next gameplay domains/context and safe owner lifecycle; original full scope remains. Last live165:7open. POOL166-CHECKPOINT.md.

Пул167: параметры сцен теперь используют общий sourceHTTP/cloud command; source event хранит intent+revision, MAP tenant/kind и GM/pause/CAS guards.116/116/server tsc/native2DB source→typedapply→localproof пройдены, final hashes checkpoint167. Live167:7open. Далее полный command coverage/безопасный lifecycle, исходный scope сохраняется. POOL167-CHECKPOINT.md.

Пул168: sourceHTTP/cloud создание сцен, точный intent/derived frame, создание→изменение→активация и durableproof на native2DB.128сценариев(124+4исправленныйfixture), server tsc0. Приоритет владельца изменён: production сейчас, прочие задачи перед локальной сборкой. POOL168-CHECKPOINT.md.
