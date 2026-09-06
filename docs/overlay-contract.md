# Меню и overlay: контракт подключения

UIX-644. Этот контракт развивает UIX-502/517/531, а не объявляет все меню
проверенными. Реестр и границы runtime evidence:
[uix-644-menu-inventory.md](plans/uix-644-menu-inventory.md).

## Выбор механизма

1. **Native select / color / file:** оставлять браузеру и OS. Их popup нельзя
   исправить увеличением CSS z-index страницы. Проверять настоящий input,
   доступное имя, constraints, focus и событие выбора.
2. **Gravity Select:** использовать `FormSelect`. Владелец поступает через
   `OverlayOwnerContext` под соответствующим `ArkenDialog`, не из внешнего
   замыкания. Raw Select допустим только с тем же owner wrapper (как feedback).
3. **Небольшой inline details popup:** обязательно `useDismissibleDetails` и
   настоящий ref. Обрезать длинную подпись, **не ancestor раскрытого popup**.
   Overflow, transform и stacking context проверять по всей цепочке предков.
   Если owner обязан скроллиться/обрезать содержимое, выбирать owner-aware
   portal, а не снимать overflow у всех панелей.
4. **Single-select listbox внутри details:** включать опцию `listbox: true`
   только для option-списка. Trigger получает `aria-haspopup`, `aria-controls`;
   список — name/role и `aria-selected` на options. ArrowUp/Down открывают
   выбранный option, Home/End выбирают границу, Escape закрывает и возвращает
   фокус. Выбор возвращает фокус trigger; Tab/focus outside закрывает без
   перетягивания фокуса обратно. Не применять listbox navigation к меню,
   содержащему поля, ползунки и разнородные действия.
5. **Custom mention/context/sticker/asset UI:** зарегистрировать отдельно;
   существование общего hook не доказывает, что такой consumer его использует
   или имеет правильный owner. Не делать глобальную миграцию без его сценария.

## Слои и жизненный цикл

- Сохранены целочисленные слои: base popup 1000; workspace 1200…1998,
  workspace popup 1999; modal 2000, modal popup 2001. Брать CSS tokens, не
  присваивать случайный больший z-index. CSS-порядок внутри отдельного stacking
  context не сравним напрямую с числами вне этого context.
- Popup базового экрана не должен появляться над новым modal. Native `<details>`
  в потоке (предыстория, ресурсы, initiative section) не являются popup и не
  должны закрываться от действий рядом.
- Outside pointer закрывает без focus steal; Escape возвращает фокус своему
  trigger только когда owner доступен. Произвольная иерархия одновременно
  открытых nested modal пока **не выражена уникальным owner ID** и требует
  отдельной проверки, а не заявления о полной поддержке.
- Для привязанного к viewport inline picker предусмотрена opt-in
  `closeOnViewportChange`: закрытие при resize/смене compact и прокрутке
  **предка anchor**. Прокрутка списка и соседнего журнала не закрывает меню.
  Это стратегия закрытия, не постоянного reposition. Она предотвращает
  возвращение устаревшего открытого меню после compact → desktop.
- Listbox ограничивает ширину/высоту реально доступным местом справа/снизу
  trigger. Внутренний список скроллится; hook не выводит его из owner-контекста.

## Регистрация и проверка

- Новый consumer добавляется в статический реестр вместе с role/owner,
  scroll/overflow chain и runtime сценарием. AST guard сканирует весь TSX src,
  а не фиксированный список старых файлов. Machine index — средство обнаружить
  изменение поверхности, **не PASS интерфейса**.
- На связанном пуле: реальный pointer hit-test (`elementFromPoint`) и click
  без force; open/select/close, Escape/focus return/Tab, повторное открытие,
  смена workspace, viewport/scroll; Chromium и Firefox. DOM `open` и наличие
  списка сами по себе недостаточны.
- Разделять GM/PLAYER, desktop/compact, page/workspace/modal/nested modal.
  Скрытый legacy consumer не активировать ради теста. Непроверенный сценарий
  помечать BLOCKED с причиной; новый consumer не наследует чужой runtime PASS.
- Отрицательный пример должен уронить точную проверку. Сначала сохранить
  исходные байты, после диверсии восстановить в `finally`, затем единый
  восстановленный pool. Не делать общую проверку после каждого метода.

Publication/production — отдельный gate; этот контракт не разрешает выкладку.
