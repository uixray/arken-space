import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { players } from "./player-pages.data.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const css = await readFile(join(here, "player-page.css"), "utf8");
const js = await readFile(join(here, "player-page.js"), "utf8");

const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function render(player) {
  const chapters = player.chapters
    .map(
      ([number, title, text]) => `
        <article class="chapter">
          <span class="chapter__number">${escape(number)}</span>
          <h3>${escape(title)}</h3>
          <p>${escape(text)}</p>
        </article>`,
    )
    .join("");

  const collection = player.collection
    .map(
      ([title, text, color], index) => `
        <button class="artifact" type="button" data-reveal="${index}" style="--artifact: ${color}">
          <span class="artifact__index">0${index + 1}</span>
          <span class="artifact__title">${escape(title)}</span>
          <span class="artifact__text">${escape(text)}</span>
        </button>`,
    )
    .join("");

  const gallery = player.gallery
    ? `<section class="gallery" aria-labelledby="gallery-title">
        <div class="section-head"><p class="eyebrow">Личный архив</p><h2 id="gallery-title">Ираклий в кадре</h2><p>Фотографии героя и его рыцарских образов.</p></div>
        <div class="gallery__grid">${player.gallery.map(([src, alt]) => `<figure><img src="assets/${escape(src)}" alt="${escape(alt)}" loading="lazy" /><figcaption>${escape(alt)}</figcaption></figure>`).join("")}</div>
      </section>`
    : "";

  const archive = player.archive
    ? `<section class="archive" aria-labelledby="archive-title">
        <div class="section-head"><p class="eyebrow">Авторские материалы</p><h2 id="archive-title">${escape(player.archive.title)}</h2><p>${escape(player.archive.intro)}</p></div>
        <div class="archive__chapters">${player.archive.chapters.map(([label, title, entries], index) => `<details ${index === 0 ? "open" : ""}><summary><span>${escape(label)}</span><strong>${escape(title)}</strong></summary><div class="archive__entries">${entries.map(([entryTitle, text]) => `<article><h3>${escape(entryTitle)}</h3><p>${escape(text)}</p></article>`).join("")}</div></details>`).join("")}</div>
      </section>`
    : "";

  return `<!doctype html>
<html lang="ru" data-theme="${player.theme}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <meta name="description" content="Черновая персональная страница ${escape(player.name)} в Аркен-Харе." />
    <meta name="theme-color" content="#171411" />
    <title>${escape(player.name)} — Arken-Khar</title>
    <style>${css}</style>
  </head>
  <body>
    <a class="skip-link" href="#content">К содержанию</a>
    <div class="ambient" aria-hidden="true"><i></i><i></i><i></i></div>
    <header class="site-head">
      <a class="wordmark" href="https://arken-khar.space" aria-label="Arken-Khar, главная">
        <span class="wordmark__mark" aria-hidden="true">AK</span>
        <span>Arken-Khar</span>
      </a>
      <span class="draft-mark">Черновик · noindex</span>
    </header>

    <main id="content">
      <section class="hero" aria-labelledby="page-title">
        <div class="hero__copy">
          <p class="eyebrow">${escape(player.eyebrow)}</p>
          <h1 id="page-title">${escape(player.name)}</h1>
          <p class="role">${escape(player.role)}</p>
          <p class="intro">${escape(player.intro)}</p>
          <div class="facts" aria-label="Темы страницы">
            ${player.facts.map((fact) => `<span>${escape(fact)}</span>`).join("")}
          </div>
          <div class="hero__actions">
            <a class="button button--primary" href="https://arken-khar.space">Войти в игру</a>
            <a class="button button--quiet" href="#story">Смотреть страницу</a>
          </div>
        </div>
        <div class="sigil" aria-hidden="true">
          <div class="sigil__core"><span></span></div>
          <p>${escape(player.handle)}</p>
        </div>
      </section>

      <blockquote class="signal"><p>${escape(player.signal)}</p></blockquote>

      <section class="feature" id="story" aria-labelledby="feature-title">
        <div class="feature__copy">
          <p class="eyebrow">${escape(player.feature.kicker)}</p>
          <h2 id="feature-title">${escape(player.feature.title)}</h2>
          <p>${escape(player.feature.text)}</p>
          <button class="text-action" type="button" data-feature-toggle aria-expanded="false">
            ${escape(player.feature.label)} <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div class="feature__stage" data-feature-stage aria-live="polite">
          <div class="stage-grid" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
          <p>Интерактивный прототип</p>
          <strong>Материалы появятся после согласования</strong>
        </div>
      </section>

      <section class="chronicle" aria-labelledby="chronicle-title">
        <div class="section-head">
          <p class="eyebrow">Структура истории</p>
          <h2 id="chronicle-title">Три главы</h2>
        </div>
        <div class="chapter-list">${chapters}</div>
      </section>

      <section class="collection" aria-labelledby="collection-title">
        <div class="section-head">
          <p class="eyebrow">Персональная коллекция</p>
          <h2 id="collection-title">${escape(player.collectionTitle)}</h2>
          <p>Нажмите на карточку, чтобы отметить выбранный объект.</p>
        </div>
        <div class="artifact-list">${collection}</div>
        <p class="selection-status" data-selection-status aria-live="polite">Ничего не выбрано</p>
      </section>
${gallery}${archive}
    </main>

    <footer>
      <p>Персональная страница в общей системе Аркен-Хара.</p>
      <a href="https://arken-khar.space">arken-khar.space</a>
    </footer>
    <script>${js}</script>
  </body>
</html>`;
}

for (const player of players) {
  const target = join(here, player.slug, "index.html");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, render(player), "utf8");
  process.stdout.write(`generated ${player.slug}/index.html\n`);
}
