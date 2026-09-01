import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * UIX-523: каталог отчёта обязан существовать до первой команды docker.
 *
 * `docker-compose.e2e.yml` монтирует `./test-results/multiplayer` в контейнер
 * Playwright. Если каталога нет, Docker создаёт его сам, и на нативном Linux
 * владельцем становится root: прогон проходит целиком, а падает последняя
 * строка — хостовый процесс не может положить рядом `runner.json`.
 *
 * Проверяется порядок в исходнике, а не поведение: воспроизвести это можно
 * только на нативном Docker с непривилегированным пользователем, то есть в CI
 * и нигде больше. Приём тот же, что в `backup-safety.test.ts`, где порядок
 * шагов тоже закреплён по тексту скрипта.
 */
const script = await readFile(
  new URL("../scripts/run-multiplayer-e2e.mjs", import.meta.url),
  "utf8",
);

describe("порядок в run-multiplayer-e2e", () => {
  it("создаёт каталог отчёта до первой команды docker", () => {
    const created = script.indexOf("mkdirSync(reportDirectory");
    const firstDockerCall = script.indexOf("[...compose");

    expect(
      created,
      "mkdirSync(reportDirectory) исчез из скрипта",
    ).toBeGreaterThan(-1);
    expect(firstDockerCall, "вызовы docker исчезли из скрипта").toBeGreaterThan(
      -1,
    );
    expect(
      created,
      "Каталог отчёта создаётся после docker: bind-mount успеет создать его " +
        "от root, и запись runner.json упадёт с EACCES на нативном Linux.",
    ).toBeLessThan(firstDockerCall);
  });

  it("монтирует тот же каталог, который создаёт", async () => {
    // Если пути разойдутся, проверка выше останется зелёной, а дефект
    // вернётся: создаваться будет один каталог, монтироваться другой.
    const compose = await readFile(
      new URL("../docker-compose.e2e.yml", import.meta.url),
      "utf8",
    );
    expect(script).toContain("../test-results/multiplayer/");
    expect(compose).toContain("./test-results/multiplayer:");
  });

  it("запускает PostgreSQL-пробу spell pack до браузерного сценария", async () => {
    const compose = await readFile(
      new URL("../docker-compose.e2e.yml", import.meta.url),
      "utf8",
    );
    const probe = script.indexOf('record("spell-pack-postgresql-probe"');
    const playwright = script.indexOf(
      "const playwright = await runPlaywrightWithRestart(environment)",
      probe,
    );
    expect(probe).toBeGreaterThan(-1);
    expect(playwright).toBeGreaterThan(probe);
    expect(compose).toContain(
      "./tests/multiplayer/spell-pack-storage.pg-probe.ts:/app/tests/multiplayer/spell-pack-storage.pg-probe.ts:ro",
    );
  });
});
