import { expect, test } from "./campaign-fixture";

/**
 * UIX-467: у каждой кнопки боковой панели должно быть доступное имя.
 *
 * В постановке значилось, что «у половины кнопок только иконка». На момент
 * задачи это оказалось уже неверно — подписи проставили UIX-388 и соседние
 * правки. Поэтому тест не чинит, а удерживает: иконочную кнопку легко добавить
 * без подписи, и заметить это в следующий раз будет некому.
 *
 * Проверяется именно доступное имя (текст или `aria-label`), а не `title`:
 * `title` не читает ни один экранный диктор, и кнопка с одним лишь `title`
 * остаётся безымянной.
 */
test("каждая кнопка боковой панели называет себя", async ({
  page,
  gmToken,
}) => {
  await page.goto(`/gm/${gmToken}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("aside.sidebar")).toBeVisible();

  const unnamed = await page.evaluate(() => {
    const sidebar = document.querySelector("aside.sidebar");
    if (!sidebar) throw new Error("Боковая панель не найдена");

    /**
     * Текст, который на самом деле попадает в доступное имя. Обычный
     * `textContent` для этого не годится: у иконочных кнопок значок лежит в
     * `<span aria-hidden="true">`, и такая кнопка выглядела бы подписанной
     * своей же иконкой — ровно та ошибка, из-за которой проверка сначала
     * ничего не находила.
     */
    const nameText = (element: Element): string =>
      [...element.childNodes]
        .map((node) => {
          if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
          if (node.nodeType !== Node.ELEMENT_NODE) return "";
          const child = node as Element;
          if (child.getAttribute("aria-hidden") === "true") return "";
          return child.getAttribute("aria-label") ?? nameText(child);
        })
        .join("");

    return [...sidebar.querySelectorAll("button")]
      .filter((button) => {
        const name = button.getAttribute("aria-label") ?? nameText(button);
        return name.trim().length === 0;
      })
      .map((button) => button.className || button.outerHTML.slice(0, 80));
  });

  expect(unnamed, `безымянные кнопки: ${unnamed.join(" | ")}`).toEqual([]);
});
