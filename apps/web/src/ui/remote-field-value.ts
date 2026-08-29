import { useEffect, useRef } from "react";

/**
 * UIX-532/325 — показать чужую правку, не выбросив того, кто печатает.
 *
 * Поля карточки персонажа неуправляемые: правка уходит на `blur`. Значит
 * значение, приехавшее чужой правкой, надо доложить в поле руками — иначе тот,
 * кто уже открыл карточку, продолжит видеть старое число.
 *
 * Раньше это делалось `key` с ревизией: элемент пересоздавался, и новое
 * значение приходило вместе с ним. Цена оказалась неприемлемой — при
 * пересоздании **молча теряется фокус**. Человек продолжает печатать, буквы
 * больше не идут в поле, а Firefox с включённым «искать текст по мере набора»
 * принимает их за начало поиска по странице. Так и был найден UIX-325.
 *
 * Здесь то же намерение выражено без пересоздания: значение кладётся в живой
 * элемент. И ровно одно исключение — поле, в котором стоит курсор, не трогаем:
 * человек его сейчас правит, и затирать набранное чужой правкой нельзя. Его
 * собственное значение уедет на `blur` со свежей ревизией из пропсов, то есть
 * без конфликта.
 */
export type RemoteFieldSyncResult =
  "updated" | "skipped-focused" | "skipped-equal" | "no-field";

export function syncRemoteFieldValue(
  field: HTMLInputElement | HTMLTextAreaElement | null,
  remoteValue: string,
): RemoteFieldSyncResult {
  if (!field) return "no-field";
  // `ownerDocument`, а не глобальный `document`: поле может жить в другом
  // документе (портал в отдельном окне), и глобальная проверка там соврала бы,
  // то есть затёрла бы текст под курсором.
  if (field.ownerDocument.activeElement === field) return "skipped-focused";
  if (field.value === remoteValue) return "skipped-equal";
  field.value = remoteValue;
  return "updated";
}

/**
 * Ref кладётся на сам контрол через `controlRef` — так поле называет себя само,
 * и защита не зависит от того, во что его завернула разметка вокруг.
 */
export function useRemoteFieldValue<
  T extends HTMLInputElement | HTMLTextAreaElement,
>(remoteValue: string) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    syncRemoteFieldValue(ref.current, remoteValue);
  }, [remoteValue]);
  return ref;
}
