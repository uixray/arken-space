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
    const serverDockerfile = await readFile(
      new URL("../Dockerfile.server", import.meta.url),
      "utf8",
    );
    const spellPackProbeSource = await readFile(
      new URL(
        "../apps/server/src/spell-pack-storage.pg-probe.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const probe = script.indexOf('record("spell-pack-postgresql-probe"');
    const playwright = script.indexOf(
      "const playwright = await runPlaywrightWithRestart(environment)",
      probe,
    );
    expect(probe).toBeGreaterThan(-1);
    expect(playwright).toBeGreaterThan(probe);
    expect(script).toContain(
      '"apps/server/src/spell-pack-storage.pg-probe.ts"',
    );
    expect(serverDockerfile).toContain("COPY apps/server apps/server");
    expect(spellPackProbeSource).toContain("registerSpellPackRoutes");
    expect(spellPackProbeSource).toContain("PostgreSQL API CAS race");
  });

  it("запускает PostgreSQL-пробу назначений до браузерного сценария", async () => {
    const source = await readFile(
      new URL(
        "../apps/server/src/spell-assignment-storage.pg-probe.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const spellPackProbe = script.indexOf(
      'record("spell-pack-postgresql-probe"',
    );
    const assignmentProbe = script.indexOf(
      'record("spell-assignment-postgresql-probe"',
    );
    const playwright = script.indexOf(
      "const playwright = await runPlaywrightWithRestart(environment)",
      assignmentProbe,
    );
    expect(assignmentProbe).toBeGreaterThan(spellPackProbe);
    expect(playwright).toBeGreaterThan(assignmentProbe);
    expect(script).toContain(
      '"apps/server/src/spell-assignment-storage.pg-probe.ts"',
    );
    expect(source).toContain("registerSpellAssignmentRoutes");
    expect(source).toContain("assignment CAS race");
    expect(source).toContain("audit actor deletion");
  });

  it("запускает PostgreSQL-пробу безопасных проекций после назначений", async () => {
    const source = await readFile(
      new URL(
        "../apps/server/src/spell-projection.pg-probe.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const assignmentProbe = script.indexOf(
      'record("spell-assignment-postgresql-probe"',
    );
    const projectionProbe = script.indexOf(
      'record("spell-projection-postgresql-probe"',
    );
    const playwright = script.indexOf(
      "const playwright = await runPlaywrightWithRestart(environment)",
      projectionProbe,
    );
    expect(projectionProbe).toBeGreaterThan(assignmentProbe);
    expect(playwright).toBeGreaterThan(projectionProbe);
    expect(script).toContain('"apps/server/src/spell-projection.pg-probe.ts"');
    expect(script).toContain("report.spellProjectionProbeExitCode");
    expect(source).toContain("registerSpellProjectionRoutes");
    expect(source).toContain("safe projection leaked");
    expect(source).toContain("OPEN import warning reached ACTIVE lifecycle");
  });
});
