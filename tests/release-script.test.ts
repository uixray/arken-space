import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * UIX-465 — свойства скрипта выкладки.
 *
 * Проверяется текст скрипта, а не его выполнение: выполнение трогает боевой
 * контур, а свойства, ради которых он написан, статические. Так же устроены
 * проверки `backup.sh` и `restore.sh` в `backup-safety.test.ts`.
 *
 * Ловятся здесь не опечатки, а исчезновение гейта: строка, которую удалили,
 * «чтобы быстрее выложить», не должна пережить прогон.
 */
const script = readFileSync(
  path.join(process.cwd(), "infra/deploy/release.sh"),
  "utf8",
);

describe("скрипт выкладки", () => {
  it("останавливается на первой же ошибке", () => {
    // Без `set -e` провалившийся гейт становится строчкой в логе, которую
    // никто не читает, а скрипт идёт выкладывать дальше.
    expect(script).toMatch(/^set -eu$/m);
  });

  /**
   * Позиция ищется по самому условию, а не по имени переменной: имя впервые
   * встречается в шапке-комментарии, и проверка порядка сверяла бы
   * документацию с кодом вместо кода с кодом. Первая версия этого теста именно
   * так и прошла — по неверной причине.
   */
  const guard = '"${RELEASE_CONFIRM:-}" != "deploy-now"';

  it("не выкладывает без явного подтверждения", () => {
    expect(script).toContain(guard);
    expect(script.indexOf(guard)).toBeLessThan(
      script.indexOf("build-and-start.sh"),
    );
  });

  it("делает настоящий бэкап и репетицию до остановки", () => {
    // Иначе «гейты пройдены» означало бы «гейты пропущены»: остановка перед
    // выкладкой не должна превращать проверку в её имитацию.
    const stop = script.indexOf(guard);
    expect(script.indexOf("backup.sh")).toBeLessThan(stop);
    expect(script.indexOf("restore:rehearse")).toBeLessThan(stop);
  });

  it("берёт идентификатор снапшота из артефакта, а не из вывода", () => {
    // Ради этого всё и затевалось: значение проходит по цепочке переменной,
    // и переписать его неверно негде.
    expect(script).toContain("BACKUP_SNAPSHOT_ARTIFACT=");
    expect(script).toContain('SNAPSHOT_ID="$(cat "$SNAPSHOT_ARTIFACT")"');
    expect(script).not.toMatch(/SNAPSHOT_ID=[0-9a-f]{16,}/);
  });

  it("отказывается принимать `latest` вместо снапшота", () => {
    // `latest` — не доказательство: чеклист требует точный идентификатор
    // именно потому, что «последний» меняется между шагами.
    expect(script).toMatch(/latest \| ""\)/);
  });

  it("требует ровно сорокасимвольную ревизию", () => {
    expect(script).toContain("[0-9a-f][0-9a-f][0-9a-f]");
    expect(script).toContain("40 строчных шестнадцатеричных символов");
  });

  it("выкладывает ту же ревизию, что репетировал", () => {
    // Обе переменные получают одно значение из одного места. Разойтись им
    // негде — а именно на их расхождении ручная выкладка и ломается.
    expect(script).toContain('EXPECTED_BUILD_REVISION="$TARGET_REVISION"');
    expect(script).toContain('RESTORE_REHEARSAL_REVISION="$TARGET_REVISION"');
    expect(script).toContain('RESTORE_BUILD_REVISION="$TARGET_REVISION"');
  });

  it("записывает точку отката до первого изменения", () => {
    const rollback = script.indexOf("ROLLBACK_REVISION=\"$(printf");
    expect(rollback).toBeGreaterThan(0);
    expect(rollback).toBeLessThan(script.indexOf("backup.sh"));
    expect(rollback).toBeLessThan(script.indexOf("git checkout"));
  });

  it("напоминает точку отката при любом провале", () => {
    expect(script).toContain("trap on_failure EXIT");
    expect(script).toContain("Точка отката: ревизия");
  });

  it("разбирает отчёт репетиции программой", () => {
    // Человек подтверждает «22 шага, все зелёные» кивком; несовпадение
    // ревизии внутри одного из них он не заметит.
    expect(script).toContain("runSucceeded");
    expect(script).toContain("restored-application-health");
    expect(script).toContain("leftovers");
  });

  it("проверяет после выкладки и ревизию, и схему, и realtime", () => {
    expect(script).toContain("На проде не выкладываемая ревизия");
    expect(script).toContain("Схема на проде не");
    expect(script).toContain("WebSocket не поднялся");
    expect(script).toContain("smoke-auth.sh");
  });

  it("отказывается выкладывать то, что уже выложено", () => {
    expect(script).toContain("Целевая ревизия уже выложена");
  });

  it("не трогает боевой чекаут с несохранёнными правками", () => {
    expect(script).toContain("Боевой чекаут не чист");
  });

  it("не содержит команды сброса игры", () => {
    // Чеклист прямо запрещает мешать сброс с выкладкой; здесь это закреплено.
    expect(script).not.toContain("gameplay-reset");
  });
});
