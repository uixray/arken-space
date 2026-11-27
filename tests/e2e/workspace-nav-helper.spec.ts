import { expect, test } from "@playwright/test";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const name of ["Редактор мира", "Мир (черновик)+ [1]"]) {
  for (const hint of [false, true]) {
    test(`compact navigation matches literal ${name}, hint=${hint}`, async ({ page }) => {
      await page.setContent(`
        <nav aria-label="Основные области">
          <button id="compact-nav-menu">Меню</button>
        </nav>
        <section role="region" aria-label="Меню кампании" hidden>
          <button id="other">${name} дополнительный</button>
          <button id="target">${name}${hint ? " <small>Удобнее на компьютере</small>" : ""}</button>
        </section>
        <output aria-label="Выбранный раздел"></output>
        <script>
          const menu = document.querySelector('section');
          document.querySelector('#compact-nav-menu').onclick = () => menu.hidden = false;
          menu.querySelectorAll('button').forEach(button => button.onclick = () => {
            document.querySelector('output').textContent = button.id;
            menu.hidden = true;
          });
        </script>
      `);
      await openWorkspaceSection(page, name);
      await expect(page.getByLabel("Выбранный раздел")).toHaveText("target");
      await expect(page.getByRole("region", { name: "Меню кампании" })).toBeHidden();
    });
  }
}
