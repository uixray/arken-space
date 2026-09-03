import AxeBuilder from "@axe-core/playwright";
import { type Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";
import { openWorkspaceSection } from "./workspace-nav-helper";

/**
 * UIX-532 — доступность проверяется машиной, а не внимательностью.
 *
 * До этого её не проверял никто: в проекте не было ни axe, ни любой другой
 * автоматики. Разметка при этом здоровая — интерактив везде на настоящих
 * элементах, подписи есть, — но держалось это на аккуратности и разъехалось бы
 * при первой спешке, молча.
 *
 * Первый же прогон нашёл три настоящих дефекта, все исправлены в этом же
 * изменении: текст, который читают, покрашен нечитаемым токеном; флажки без
 * имени из-за вложенных `<label>`; лента событий прокручивается, но недоступна
 * с клавиатуры.
 *
 * Тегами, а не поимённым списком правил: набор WCAG — это и есть «что считать
 * дефектом», и выписывать его руками значило бы каждый раз решать заново.
 * Правила-исключения перечислены ниже поимённо и с причиной — так видно цену
 * каждого отказа. Сейчас исключений нет.
 *
 * `best-practice` намеренно не включён: там живут советы вроде «на странице
 * должен быть ровно один `<main>`», нарушение которых не мешает никому
 * пользоваться продуктом. Проверка, падающая на советах, будет выключена в
 * первый же красный день — и вместе с ней уйдут настоящие находки.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Правила, отключённые осознанно. Пусто — и пусть остаётся: каждая запись
 * здесь означает известное нарушение, которое решили не чинить.
 */
const DISABLED_RULES: string[] = [];

async function expectAccessible(page: Page, screen: string) {
  const result = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .disableRules(DISABLED_RULES)
    .analyze();

  // Отчёт собирается поимённо: «нарушений 3» в логе CI не говорит, что чинить,
  // и разбирать пришлось бы скачиванием артефакта.
  const findings = result.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${violation.id} (${violation.impact}) — ${node.target.join(" ")}: ${
          node.any[0]?.message ?? node.all[0]?.message ?? ""
        }`,
    ),
  );
  expect(findings, `${screen}: нарушения доступности`).toEqual([]);
}

async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
}

test("страница входа доступна", async ({ page }) => {
  // Единственный экран, который видят до входа. Если он недоступен, дальше
  // человек просто не попадёт.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Стол и карта" }),
  ).toBeVisible();
  // Шпаргалка раскрывается: свёрнутой её разметки на странице нет вовсе, и
  // проверять там было бы нечего.
  await page
    .getByRole("button", { name: "Показать все клавиши и команды" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Туман войны" }),
  ).toBeVisible();
  await expectAccessible(page, "страница входа");
});

test("игровой экран доступен", async ({ page, gmToken }) => {
  await signInAsGm(page, gmToken);
  await expect(page.locator("canvas").first()).toBeVisible();
  await expectAccessible(page, "карта и боковая панель");
});

test("рабочая область персонажей доступна", async ({ page, gmToken }) => {
  await signInAsGm(page, gmToken);
  await openWorkspaceSection(page, "Персонажи");
  await expect(page.locator(".character-workspace")).toBeVisible();
  await expectAccessible(page, "персонажи");
});
