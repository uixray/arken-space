import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * UIX-465 / UIX-574 — свойства скрипта выкладки.
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
const authScript = readFileSync(
  path.join(process.cwd(), "infra/deploy/smoke-auth.sh"),
  "utf8",
);
const buildScript = readFileSync(
  path.join(process.cwd(), "infra/deploy/build-and-start.sh"),
  "utf8",
);
const checksWorkflow = readFileSync(
  path.join(process.cwd(), ".github/workflows/checks.yml"),
  "utf8",
);

function markerIndex(source: string, marker: string) {
  const index = source.indexOf(marker);
  expect(index, `Маркер не найден: ${marker}`).toBeGreaterThanOrEqual(0);
  return index;
}

function exactLineIndices(source: string, line: string) {
  const indices: number[] = [];
  let offset = 0;
  for (const currentLine of source.split("\n")) {
    if (currentLine === line) indices.push(offset);
    offset += currentLine.length + 1;
  }
  return indices;
}

function shellFunctionBody(source: string, name: string) {
  const start = markerIndex(source, `${name}() {`);
  const end = source.indexOf("\n}", start);
  expect(end, `Конец функции ${name} не найден`).toBeGreaterThan(start);
  return source.slice(start, end + 2);
}

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
  const guard = '"${RELEASE_CONFIRM:-}" != deploy-now';

  it("не выкладывает без явного подтверждения", () => {
    expect(script).toContain(guard);
    expect(markerIndex(script, guard)).toBeLessThan(
      markerIndex(script, 'run_logged "$BUILD_LOG"'),
    );
  });

  it("делает настоящий бэкап и репетицию до остановки", () => {
    // Иначе «гейты пройдены» означало бы «гейты пропущены»: остановка перед
    // выкладкой не должна превращать проверку в её имитацию.
    const stop = markerIndex(script, guard);
    expect(markerIndex(script, 'run_logged "$BACKUP_LOG"')).toBeLessThan(stop);
    expect(markerIndex(script, 'run_logged "$RESTORE_LOG"')).toBeLessThan(stop);
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
    expect(script).toMatch(/latest \| ''\)/);
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
    const rollback = markerIndex(
      script,
      'ROLLBACK_REVISION="$(production_revision rollback)"',
    );
    expect(rollback).toBeGreaterThan(0);
    expect(rollback).toBeLessThan(
      markerIndex(script, 'run_logged "$BACKUP_LOG"'),
    );
    expect(rollback).toBeLessThan(markerIndex(script, "git checkout --quiet"));
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

  it("не маскирует exit code обязательных gates конвейерами", () => {
    for (const log of [
      "RESTIC_CHECK_LOG",
      "BACKUP_LOG",
      "RESTORE_LOG",
      "BUILD_LOG",
      "AUTH_LOG",
    ])
      expect(script).toContain(`run_logged "$${log}"`);

    for (const gate of [
      "restic check",
      "backup.sh",
      "restore:rehearse",
      "build-and-start.sh",
      "smoke-auth.sh",
    ]) {
      const escaped = gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(script).not.toMatch(
        new RegExp(`${escaped}[^\\n]*\\|\\s*(?:tail|grep|head)`),
      );
    }
  });

  it("run_logged возвращает исходный код обязательной команды", () => {
    const body = shellFunctionBody(script, "run_logged");
    expect(body).toContain('if "$@" >"$run_logged_path" 2>&1; then');
    expect(body).toContain("else");
    expect(body).toContain("run_logged_status=$?");
    expect(body).toContain('return "$run_logged_status"');
    expect(body).not.toMatch(/"\$@"[^\n]*\|/);
  });

  it("проверяет production env и приватные root-owned credentials", () => {
    const checkout = markerIndex(
      script,
      'git checkout --quiet "$TARGET_REVISION"',
    );
    const backup = markerIndex(script, 'run_logged "$BACKUP_LOG"');
    const envChecks = exactLineIndices(script, "check_operator_env_file");
    expect(envChecks).toHaveLength(2);
    expect(envChecks[0]).toBeLessThan(checkout);
    expect(envChecks[1]).toBeGreaterThan(checkout);
    expect(envChecks[1]).toBeLessThan(backup);
    expect(script).toContain('env_mode" = 600');
    expect(script).toContain("Production .env не должен быть tracked");
    expect(script).toContain("Production .env должен оставаться ignored");
    expect(script).toContain('git cat-file -e "${TARGET_REVISION}^{commit}"');
    expect(script).toContain(
      'TARGET_ENV_ENTRY="$(git ls-tree --name-only "$TARGET_REVISION" -- .env)"',
    );
    expect(markerIndex(script, 'TARGET_ENV_ENTRY="$(git ls-tree')).toBeLessThan(
      checkout,
    );
    expect(script).toContain(
      '[ "$OPERATOR_ENV_DIGEST_AFTER" = "$OPERATOR_ENV_DIGEST_BEFORE" ]',
    );
    const validators = [
      markerIndex(script, 'run_logged "$PRECHECK_ENV_LOG"'),
      markerIndex(script, 'run_logged "$ENV_LOG"'),
    ];
    expect(validators[0]).toBeLessThan(checkout);
    expect(validators[1]).toBeGreaterThan(checkout);
    expect(validators[1]).toBeLessThan(backup);
    expect(script).toContain('check_root_private_file "Restic env"');
    expect(script).toContain('check_root_private_file "Restic password file"');
    expect(script).not.toContain("AWS_SECRET_ACCESS_KEY=");
  });

  it("удерживает один host release lock до любых production gates", () => {
    const calls = exactLineIndices(script, "acquire_release_lock");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(script).toContain(
      "RELEASE_LOCK_FILE=/home/uixray/apps/.arken-space-release.lock",
    );
    const body = shellFunctionBody(script, "acquire_release_lock");
    expect(body).toContain("command -v flock");
    expect(body).toContain('exec 9>"$RELEASE_LOCK_FILE"');
    expect(body).toContain("flock -n 9");
    for (const later of [
      "sudo -n nginx -t",
      'ROLLBACK_REVISION="$(production_revision rollback)"',
      "git fetch --quiet origin",
      'run_logged "$BACKUP_LOG"',
      'CAPTURED_SERVER_IMAGE_ID="$(running_image_id server',
    ])
      expect(call, later).toBeLessThan(markerIndex(script, later));
  });

  it("confirmed pass начинается только из уже выбранной целевой ревизии", () => {
    const startRevision = markerIndex(
      script,
      'START_REVISION="$(git rev-parse HEAD)"',
    );
    const guard = markerIndex(
      script,
      '[ "${RELEASE_CONFIRM:-}" = deploy-now ] && [ "$START_REVISION" != "$TARGET_REVISION" ]',
    );
    expect(startRevision).toBeLessThan(guard);
    expect(guard).toBeLessThan(markerIndex(script, "sudo -n nginx -t"));
    expect(script).toContain("сначала выполните unconfirmed pass");
  });

  it("принимает target только из fetched origin/main до checkout", () => {
    const fetch = markerIndex(script, "git fetch --quiet origin");
    const commit = markerIndex(
      script,
      'git cat-file -e "${TARGET_REVISION}^{commit}"',
    );
    const ancestry = markerIndex(
      script,
      'git merge-base --is-ancestor "$TARGET_REVISION" origin/main',
    );
    const checkout = markerIndex(
      script,
      'git checkout --quiet "$TARGET_REVISION"',
    );
    expect(fetch).toBeLessThan(commit);
    expect(commit).toBeLessThan(ancestry);
    expect(ancestry).toBeLessThan(checkout);
    expect(script).toContain("не входит в историю origin/main");
  });

  it("закрепляет оба running image до build и повторно проверяет после", () => {
    const build = markerIndex(script, 'run_logged "$BUILD_LOG"');
    const beforeCapture = markerIndex(
      script,
      'assert_production_revision before-image-capture "$ROLLBACK_REVISION"',
    );
    const serverCapture = markerIndex(
      script,
      'CAPTURED_SERVER_IMAGE_ID="$(running_image_id server',
    );
    const webCapture = markerIndex(
      script,
      'CAPTURED_WEB_IMAGE_ID="$(running_image_id web',
    );
    const afterCapture = markerIndex(
      script,
      'assert_production_revision after-image-capture "$ROLLBACK_REVISION"',
    );
    const preserveServer = markerIndex(
      script,
      'preserve_rollback_tag server "$ROLLBACK_SERVER_TAG" "$CAPTURED_SERVER_IMAGE_ID"',
    );
    const preserveWeb = markerIndex(
      script,
      'preserve_rollback_tag web "$ROLLBACK_WEB_TAG" "$CAPTURED_WEB_IMAGE_ID"',
    );
    const afterPreserve = markerIndex(
      script,
      'assert_production_revision after-rollback-preserve "$ROLLBACK_REVISION"',
    );
    expect(beforeCapture).toBeLessThan(serverCapture);
    expect(serverCapture).toBeLessThan(webCapture);
    expect(webCapture).toBeLessThan(afterCapture);
    expect(afterCapture).toBeLessThan(preserveServer);
    expect(preserveServer).toBeLessThan(preserveWeb);
    expect(preserveWeb).toBeLessThan(afterPreserve);
    expect(afterPreserve).toBeLessThan(build);

    for (const [service, variable] of [
      ["server", "SERVER"],
      ["web", "WEB"],
    ] as const) {
      expect(script).toContain(`rollback-tag ${service} "$ROLLBACK_REVISION"`);
      const postBuildVerifications = exactLineIndices(
        script,
        `verify_rollback_tag ${service} "$ROLLBACK_${variable}_TAG" "$ROLLBACK_${variable}_IMAGE_ID"`,
      );
      expect(postBuildVerifications).toHaveLength(2);
      expect(postBuildVerifications[0]).toBeGreaterThan(build);
      expect(postBuildVerifications[0]).toBeLessThan(
        markerIndex(script, "check_disk_reserve after-build"),
      );
      expect(postBuildVerifications[1]).toBeGreaterThan(
        markerIndex(script, 'run_logged "$AUTH_LOG"'),
      );
    }
    expect(script).toContain("Rollback server:");
    expect(script).toContain("Rollback web:");
    expect(script).toContain("Deployed server ID:");
    expect(script).toContain("Deployed web ID:");
    expect(script).toContain("image-evidence server");
    expect(script).toContain("image-evidence web");
  });

  it("печатает failure rollback mapping только после успешной проверки tag", () => {
    const failureBody = shellFunctionBody(script, "on_failure");
    expect(script).toContain("ROLLBACK_SERVER_VERIFIED=0");
    expect(script).toContain("ROLLBACK_WEB_VERIFIED=0");
    expect(failureBody).toContain('[ "$ROLLBACK_SERVER_VERIFIED" = 1 ]');
    expect(failureBody).toContain('[ "$ROLLBACK_WEB_VERIFIED" = 1 ]');
    expect(failureBody).not.toContain('[ -n "$ROLLBACK_SERVER_IMAGE_ID" ]');
    expect(failureBody).not.toContain('[ -n "$ROLLBACK_WEB_IMAGE_ID" ]');

    for (const [service, variable] of [
      ["server", "SERVER"],
      ["web", "WEB"],
    ] as const) {
      const preBuildVerify = markerIndex(
        script,
        `verify_rollback_tag ${service} "$ROLLBACK_${variable}_TAG" "$CAPTURED_${variable}_IMAGE_ID"`,
      );
      const verifiedAssignments = exactLineIndices(
        script,
        `ROLLBACK_${variable}_VERIFIED=1`,
      );
      expect(verifiedAssignments).toHaveLength(3);
      expect(verifiedAssignments[0]).toBeGreaterThan(preBuildVerify);
    }
  });

  it("проверяет byte-accurate reserve непосредственно до и после build", () => {
    const before = markerIndex(script, "check_disk_reserve before-build");
    const build = markerIndex(script, 'run_logged "$BUILD_LOG"');
    const after = markerIndex(script, "check_disk_reserve after-build");
    expect(before).toBeLessThan(build);
    expect(after).toBeGreaterThan(build);
    expect(script).toContain("check-disk-kib");
    expect(script).toContain('env-value "$APP_ROOT/.env" MIN_FREE_DISK_BYTES');
  });

  it("передаёт auth smoke точные revision/schema и не ставит его в pipe", () => {
    expect(script).toContain('EXPECTED_BUILD_REVISION="$TARGET_REVISION"');
    expect(script).toContain(
      'EXPECTED_SCHEMA_VERSION="$EXPECTED_SCHEMA_VERSION"',
    );
    expect(script).toContain('run_logged "$AUTH_LOG" env');
    expect(script).not.toContain('run_logged "$AUTH_LOG" sudo -n env');
    expect(script).not.toMatch(/smoke-auth\.sh[^\n]*\|/);
    expect(authScript).toContain("EXPECTED_BUILD_REVISION");
    expect(authScript).toContain("EXPECTED_SCHEMA_VERSION");
  });

  it("запускает git-проверки build wrapper от оператора, а Docker — через sudo внутри", () => {
    expect(script).toContain('run_logged "$BUILD_LOG" env');
    expect(script).not.toContain('run_logged "$BUILD_LOG" sudo -n env');
    expect(buildScript).toContain("git rev-parse HEAD");
    expect(buildScript).toContain("sudo -n env");
  });

  it("требует явное подтверждение non-live media gate", () => {
    const approval = markerIndex(
      script,
      '"${MEDIA_SMOKE_APPROVAL:-}" = non-live-candidate-passed',
    );
    expect(approval).toBeLessThan(
      markerIndex(script, 'run_logged "$BUILD_LOG"'),
    );
    expect(script).toContain("disposable non-live candidate");
    expect(script).toContain("Ручная production acceptance");
  });

  it("capture и build используют один явный Compose project", () => {
    for (const source of [script, buildScript]) {
      expect(source).toContain('--project-name "$COMPOSE_PROJECT_NAME"');
      expect(source).toContain('--project-directory "$APP_ROOT"');
      expect(source).toContain('--file "$APP_ROOT/docker-compose.yml"');
    }
  });

  it("проверяет синтаксис production shell в Ubuntu CI", () => {
    expect(checksWorkflow).toContain("Check deploy shell syntax");
    for (const file of ["release.sh", "build-and-start.sh", "smoke-auth.sh"])
      expect(checksWorkflow).toContain(`sh -n infra/deploy/${file}`);
  });
});
