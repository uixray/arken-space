import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { betaPlayers } from "../packages/contracts/src/beta-players.js";
import { players } from "../infra/static/players/player-pages.data.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const playersDir = join(root, "infra", "static", "players");
const nginxConfPath = join(root, "infra", "nginx", "arken-khar.space.conf");

describe("UIX-364 — Персональные страницы игроков (player pages)", () => {
  describe("целостность данных в player-pages.data.mjs", () => {
    it("содержит обязательные поля для каждого игрока", () => {
      expect(players.length).toBeGreaterThanOrEqual(7);

      for (const player of players) {
        expect(player.slug).toMatch(/^[a-z0-9_-]+$/);
        expect(player.name.trim().length).toBeGreaterThan(0);
        expect(player.handle).toMatch(/^@[A-Za-z0-9_-]+$/);
        expect(player.role.trim().length).toBeGreaterThan(0);
        expect(player.theme.trim().length).toBeGreaterThan(0);
        expect(player.intro.trim().length).toBeGreaterThan(0);
        expect(player.signal.trim().length).toBeGreaterThan(0);
        expect(player.facts.length).toBeGreaterThanOrEqual(3);
        expect(player.chapters.length).toBe(3);
        expect(player.collection.length).toBe(3);
      }
    });

    it("не содержит дубликатов slug и handle", () => {
      const slugs = players.map((p) => p.slug);
      const handles = players.map((p) => p.handle.toLowerCase());

      expect(new Set(slugs).size).toBe(slugs.length);
      expect(new Set(handles).size).toBe(handles.length);
    });

    it("все основные игроки из betaPlayers зарегистрированы", () => {
      const playerHandles = new Set(
        players.map((p) => p.handle.replace(/^@/, "").toLowerCase()),
      );

      for (const beta of betaPlayers) {
        expect(playerHandles).toContain(beta.handle.toLowerCase());
      }
    });
  });

  describe("сгенерированные HTML страницы и доступность", () => {
    for (const player of players) {
      it(`страница игрока ${player.slug} существует и содержит обязательные теги`, () => {
        const filePath = join(playersDir, player.slug, "index.html");
        expect(existsSync(filePath)).toBe(true);

        const content = readFileSync(filePath, "utf8");

        // Базовая разметка и кодировка
        expect(content).toContain("<!doctype html>");
        expect(content).toContain('<html lang="ru"');
        expect(content).toContain('<meta charset="utf-8"');
        expect(content).toContain(
          '<meta name="viewport" content="width=device-width, initial-scale=1"',
        );

        // Приватность (noindex для персональных черновых страниц)
        expect(content).toContain(
          '<meta name="robots" content="noindex, nofollow, noarchive"',
        );

        // Доступность
        expect(content).toContain('<a class="skip-link" href="#content">');
        expect(content).toContain(`>${player.name} — Arken-Khar</title>`);
        expect(content).toContain(player.name);
        expect(content).toContain(player.handle);
      });
    }
  });

  describe("специальные интерактивные страницы (Миша, Ираклий, Таисия, Лев)", () => {
    it("Миша (zheludock): модуль диспетчерской скомпонован и содержит движки", () => {
      const dispatchDir = join(playersDir, "zheludock", "dispatch");
      expect(existsSync(join(dispatchDir, "index.html"))).toBe(true);
      expect(existsSync(join(dispatchDir, "live-engine.js"))).toBe(true);
      expect(existsSync(join(dispatchDir, "live-ui.js"))).toBe(true);
      expect(existsSync(join(dispatchDir, "game-engine.js"))).toBe(true);
      expect(existsSync(join(dispatchDir, "game-data.js"))).toBe(true);
      expect(existsSync(join(dispatchDir, "styles.css"))).toBe(true);
      expect(existsSync(join(dispatchDir, "assets", "world-map.webp"))).toBe(
        true,
      );
      expect(existsSync(join(dispatchDir, "assets", "leonard.webp"))).toBe(
        true,
      );

      const html = readFileSync(join(dispatchDir, "index.html"), "utf8");
      expect(html).toContain("Магическая диспетчерская");
      expect(html).toContain("live-ui.js");

      const liveUi = readFileSync(join(dispatchDir, "live-ui.js"), "utf8");
      expect(liveUi).toContain("live-engine.js");
    });

    it("Ираклий (irakly123): мини-игра раннер и архивные ассеты на месте", () => {
      const irakliDir = join(playersDir, "irakly123");
      const assetsDir = join(irakliDir, "assets");
      const assets = [
        "irakli-character.png",
        "irakli-coin.png",
        "irakli-knight-river.png",
        "irakli-knight-rose.png",
        "irakli-knight-winter.png",
        "irakli-token.webp",
      ];

      for (const asset of assets) {
        expect(existsSync(join(assetsDir, asset))).toBe(true);
      }

      const html = readFileSync(join(irakliDir, "index.html"), "utf8");
      expect(html).toContain("data-runner-stage");
      expect(html).toContain("Рыцарский рывок");
    });

    it("Таисия (taisiya): автономная страница с игрой и защитным CSP", () => {
      const taisiyaDir = join(playersDir, "taisiya");
      expect(existsSync(join(taisiyaDir, "index.html"))).toBe(true);
      expect(existsSync(join(taisiyaDir, "game.js"))).toBe(true);

      const html = readFileSync(join(taisiyaDir, "index.html"), "utf8");
      expect(html).toContain("noindex, nofollow");
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain("Таисия — хранительница удачи");
      expect(html).toContain("game.js");
    });

    it("Лев (lev): автономная страница с игрой и защитным CSP", () => {
      const levDir = join(playersDir, "lev");
      expect(existsSync(join(levDir, "index.html"))).toBe(true);
      expect(existsSync(join(levDir, "game.js"))).toBe(true);

      const html = readFileSync(join(levDir, "index.html"), "utf8");
      expect(html).toContain("noindex, nofollow");
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain("Лев — ночной супер-кот");
      expect(html).toContain("game.js");
    });
  });

  describe("маршрутизация nginx (arken-khar.space.conf)", () => {
    it("все субдомены из nginx-конфигурации имеют соответствующие директории", () => {
      expect(existsSync(nginxConfPath)).toBe(true);
      const conf = readFileSync(nginxConfPath, "utf8");

      // Извлекаем все субдомены вида <subdomain>.arken-khar.space
      const matches = [
        ...conf.matchAll(/([a-z0-9_-]+)\.arken-khar\.space/g),
      ].map((m) => m[1]);

      const subdomains = [...new Set(matches)];
      expect(subdomains.length).toBeGreaterThanOrEqual(9);

      for (const subdomain of subdomains) {
        const playerDir = join(playersDir, subdomain);
        expect(existsSync(playerDir)).toBe(true);
        expect(existsSync(join(playerDir, "index.html"))).toBe(true);
      }
    });
  });
});
