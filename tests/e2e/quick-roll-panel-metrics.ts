import { type Page } from "@playwright/test";

/**
 * Высота панели, при которой помещаются все кнопки быстрых бросков.
 *
 * Вынесено из спека отдельным модулем не ради красоты: воспроизвести условие,
 * на котором эта функция ломается, можно только подставив другую раскладку, и
 * проверять при этом надо саму функцию, а не её копию в зонде.
 *
 * **Панель здесь намеренно не растягивается.** Первая версия задавала ей
 * `window.innerHeight * 3` и мерила нижнюю границу последней кнопки. На машине,
 * где содержимое влезало в доступное место, это работало. В CI не влезает:
 * тело панели живёт в flex-колонке и в потолок родителя упирается независимо
 * от того, что написано в `style.height`. Последняя кнопка оказывалась
 * обрезана, замер возвращал 248px при нужных больше 260 — то есть меньше, чем
 * та высота, на которой тест и так падал.
 *
 * Поэтому берётся `scrollHeight`: он сообщает полную высоту содержимого, даже
 * когда оно обрезано, и не требует ничего трогать. Раскладку это не сдвигает,
 * а значит и обратной связи «мерим следствие собственного расчёта» здесь нет —
 * ровно той ловушки, из-за которой в UIX-469 замер раскачивался от кадра к
 * кадру.
 *
 * Вторым способом идёт нижняя граница последней кнопки. Он нужен на случай,
 * если прокрутка заведётся у вложенного списка, а не у тела: тогда
 * `scrollHeight` тела покажет неполную высоту. Берётся большее из двух —
 * завысить безопасно, занизить нет.
 */
export async function visibleButtons(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".quick-roll-panel");
    const body = panel?.querySelector(".quick-roll-panel__body");
    if (!panel || !body)
      throw new Error("Панель быстрых бросков не отрисована");
    const buttons = [...body.querySelectorAll("button")];
    const buttonsHost = buttons[0] ?? body;
    /* Невидимые кнопки описываются поимённо, а не считаются числом.
       Причина конкретная: в CI одна кнопка не появлялась НИ ПРИ КАКОЙ высоте
       панели — 260px, 420px и 536px давали одни и те же 12 из 13. Разница
       между «не поместилась» и «перекрыта чужим элементом» по счётчику
       неразличима, а воспроизвести это вне CI не удалось. Пусть отчёт сам
       называет, какая кнопка и что поверх неё. */
    const hidden: string[] = [];
    /* Фактическая высота панели против запрошенной и реально применённый
       шрифт. Обоих чисел не хватало во всех трёх попытках починки: по одному
       счётчику «12 из 13» неразличимы «панель не выросла», «кнопку перекрыли»
       и «подписи шире, чем на машине автора». Приложение тянет Inter с Google
       Fonts, и раскладка от него зависит. */
    const panelHeight = Math.round(panel.getBoundingClientRect().height);
    const font = getComputedStyle(buttonsHost).fontFamily;
    const fits = buttons.filter((button) => {
      const rect = button.getBoundingClientRect();
      const label =
        (button.textContent ?? "").trim().slice(0, 24) || "(без подписи)";
      if (rect.width === 0 || rect.height === 0) {
        hidden.push(`${label}: нулевой размер`);
        return false;
      }
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit === button || button.contains(hit)) return true;
      const covering = hit
        ? `${hit.tagName.toLowerCase()}${hit.className ? "." + String(hit.className).split(/\s+/).join(".") : ""}`
        : "ничего (точка вне окна)";
      hidden.push(
        `${label}: центр (${Math.round(x)}, ${Math.round(y)}) при окне ` +
          `${window.innerWidth}x${window.innerHeight}, поверх — ${covering}`,
      );
      return false;
    }).length;
    // Прокрутка ищется по всей панели: она может завестись и у вложенного
    // списка, а не только у тела — именно так и выглядела ошибка.
    const scrolls = [body, ...body.querySelectorAll("*")].some(
      (element) => element.scrollHeight > element.clientHeight + 1,
    );
    return {
      fits,
      total: buttons.length,
      scrolls,
      hidden,
      panelHeight,
      font,
    };
  });
}

export async function heightThatFitsAllButtons(page: Page): Promise<number> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".quick-roll-panel");
    const body = panel?.querySelector<HTMLElement>(".quick-roll-panel__body");
    if (!panel || !body)
      throw new Error("Панель быстрых бросков не отрисована");

    const buttons = [...body.querySelectorAll("button")];
    const last = buttons.at(-1);
    if (!last) throw new Error("В панели нет кнопок быстрых бросков");

    const bodyBox = body.getBoundingClientRect();
    const paddingBottom =
      Number.parseFloat(getComputedStyle(body).paddingBottom) || 0;

    // Нижняя граница последней кнопки в координатах содержимого: прокрутка
    // тела учитывается, иначе прокрученный список даёт заниженный результат.
    const byFlow =
      last.getBoundingClientRect().bottom - bodyBox.top + body.scrollTop;
    // `scrollHeight` уже включает нижний отступ, `byFlow` — нет.
    const content = Math.max(byFlow + paddingBottom, body.scrollHeight);

    // Всё, что панель занимает помимо тела: заголовок, ручка, рамки.
    const chrome = panel.getBoundingClientRect().height - bodyBox.height;

    /* Восемь пикселей сверху — не подобранное число, а защита от округления:
       дробные высоты строк дают остаток в доли пикселя, и панель ровно по
       содержимому иногда заводит прокрутку на пустом месте. Исход проверки
       этот запас не решает — его решает замер выше. */
    return Math.ceil(content + chrome) + 8;
  });
}
