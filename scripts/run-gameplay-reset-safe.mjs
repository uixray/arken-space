/* global fetch */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import {
  gameplayResetStatements,
  orchestrateGameplayReset,
} from "./gameplay-reset-core.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const reportPath = resolve(root, "test-results/restore/runner.json");
const receiptDirectory = resolve(root, "test-results/gameplay-reset");
export function buildComposeArgs(environment = process.env) {
  const appRoot = environment.APP_ROOT ?? root;
  return [
    "compose",
    "--project-name",
    environment.PRODUCTION_COMPOSE_PROJECT ?? "arken-space",
    "--project-directory",
    appRoot,
    "--file",
    resolve(appRoot, "docker-compose.yml"),
  ];
}
const compose = buildComposeArgs();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  return result.stdout.trim();
}

function docker(args, options) {
  return run("docker", [...compose, ...args], options);
}

function sqlLiteral(value) {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Expected UUID");
  return `'${value}'`;
}

export function resetSql(campaignId, gmMembershipId) {
  const campaign = sqlLiteral(campaignId);
  const gm = sqlLiteral(gmMembershipId);
  const statements = gameplayResetStatements(campaignId, gmMembershipId).map(
    ([statement]) =>
      statement.replaceAll("$1", campaign).replaceAll("$2", gm) + ";",
  );
  statements[0] = `do $$ begin if not exists (${statements[0].replace(/;$/, "")}) then raise exception 'RETAINED_GM_INVALID'; end if; end $$;`;
  return ["begin;", ...statements, "commit;"].join("\n");
}

export function writeAuditReceipt(path, receipt) {
  writeFileSync(path, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
}

async function health() {
  const response = await fetch(
    process.env.ARKEN_PRODUCTION_HEALTH_URL ??
      "https://arken.uixray.tech/healthz",
  );
  if (!response.ok)
    throw new Error(`Production health returned ${response.status}`);
  const body = await response.json();
  if (body.status !== "ok" || body.database !== "ok")
    throw new Error("Production is unhealthy");
  return body;
}

export const productionDependencies = {
  async readCheckoutRevision() {
    return run("git", ["rev-parse", "HEAD"]);
  },
  async verifyBuild(expected) {
    const result = await health();
    if (result.buildRevision !== expected)
      throw new Error("Production build revision does not match checkout");
    return result;
  },
  async createBackup() {
    const backupRoot =
      process.env.BACKUP_ROOT ?? "/srv/arken-space-data/backups";
    const artifact = resolve(
      backupRoot,
      `.reset-backup-${process.pid}-${Date.now()}.snapshot-id`,
    );
    try {
      run("sh", [resolve(root, "infra/backup/backup.sh")], {
        stdio: "inherit",
        env: { ...process.env, BACKUP_SNAPSHOT_ARTIFACT: artifact },
      });
      const snapshotId = readFileSync(artifact, "utf8").trim();
      if (!/^[0-9a-f]{8,64}$/i.test(snapshotId))
        throw new Error("Backup did not produce an exact snapshot ID artifact");
      return snapshotId;
    } finally {
      rmSync(artifact, { force: true });
    }
  },
  async rehearse(snapshotId) {
    run(
      process.execPath,
      [resolve(root, "scripts/run-restore-rehearsal.mjs")],
      {
        stdio: "inherit",
        env: { ...process.env, SNAPSHOT_ID: snapshotId },
      },
    );
  },
  async readRehearsalEvidence() {
    const bytes = readFileSync(reportPath);
    return {
      report: JSON.parse(bytes.toString("utf8")),
      hash: createHash("sha256").update(bytes).digest("hex"),
    };
  },
  async approveExecution({ campaignId, snapshotId }) {
    return (
      process.env.ARKEN_RESET_EXECUTE === "operator-approved" &&
      Boolean(campaignId && snapshotId)
    );
  },
  async requestConfirmation({ campaignId, snapshotId }) {
    if (process.env.ARKEN_RESET_CONFIRM) return process.env.ARKEN_RESET_CONFIRM;
    if (!process.stdin.isTTY)
      throw new Error(
        "Typed reset confirmation requires an interactive terminal",
      );
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await terminal.question(
        `Type ${campaignId}:${snapshotId} to confirm the reset: `,
      );
    } finally {
      terminal.close();
    }
  },
  async countState(campaignId) {
    const c = sqlLiteral(campaignId);
    const output = docker([
      "exec",
      "-T",
      "postgres",
      "psql",
      "--username",
      "arken",
      "--dbname",
      "arken",
      "--tuples-only",
      "--no-align",
      "--command",
      `select json_build_object(
        'campaigns',(select count(*) from campaigns where id=${c}),
        'assets',(select count(*) from assets where campaign_id=${c}),
        'assetOwnershipValid',(select count(*) from assets a join memberships m on m.id=a.uploaded_by_membership_id where a.campaign_id=${c} and m.campaign_id=${c}),
        'gmMemberships',(select count(*) from memberships where campaign_id=${c} and role='GM'),
        'playerMemberships',(select count(*) from memberships where campaign_id=${c} and role='PLAYER'),
        'scenes',(select count(*) from scenes where campaign_id=${c}),
        'characters',(select count(*) from characters where campaign_id=${c}),
        'playerSessions',(select count(*) from sessions s join memberships m on m.id=s.membership_id where m.campaign_id=${c} and m.role='PLAYER'),
        'gmSessions',(select count(*) from sessions s join memberships m on m.id=s.membership_id where m.campaign_id=${c} and m.role='GM'),
        'playerAccessGrants',(select count(*) from player_access_grants where campaign_id=${c}),
        'invites',(select count(*) from invites where campaign_id=${c}),
        'chatMessages',(select count(*) from chat_messages where campaign_id=${c}),
        'audioStates',(select count(*) from audio_states where campaign_id=${c}),
        'actionJournal',(select count(*) from action_journal where campaign_id=${c}),
        'drawings',(select count(*) from drawings d join scenes s on s.id=d.scene_id where s.campaign_id=${c}),
        'gameEvents',(select count(*) from game_events where campaign_id=${c}),
        'tokens',(select count(*) from tokens t join scenes s on s.id=t.scene_id where s.campaign_id=${c}),
        'fogReveals',(select count(*) from fog_reveals f join scenes s on s.id=f.scene_id where s.campaign_id=${c}),
        'activeSceneId',(select active_scene_id from campaigns where id=${c}),
        'campaignDay',(select day from campaigns where id=${c}),
        'battleActive',(select battle_active from campaigns where id=${c}),
        'battleCounter',(select battle_counter from campaigns where id=${c}),
        'campaignRevision',(select revision from campaigns where id=${c}),
        'foreignCampaigns',(select count(*) from campaigns where id<>${c}),
        'foreignAssets',(select count(*) from assets where campaign_id<>${c}),
        'foreignMemberships',(select count(*) from memberships where campaign_id<>${c}),
        'foreignScenes',(select count(*) from scenes where campaign_id<>${c}),
        'foreignCharacters',(select count(*) from characters where campaign_id<>${c}),
        'foreignAccessGrants',(select count(*) from player_access_grants where campaign_id<>${c}),
        'foreignInvites',(select count(*) from invites where campaign_id<>${c}),
        'foreignChatMessages',(select count(*) from chat_messages where campaign_id<>${c}),
        'foreignAudioStates',(select count(*) from audio_states where campaign_id<>${c}),
        'foreignGameEvents',(select count(*) from game_events where campaign_id<>${c})
      );`,
    ]);
    return JSON.parse(output);
  },
  async enterMaintenance() {
    this.maintenanceHealth = await health();
    docker(["stop", "server"]);
  },
  async verifyMaintenanceBuild(expectedBuildRevision, expectedSchemaVersion) {
    const result = this.maintenanceHealth;
    if (!result) throw new Error("Maintenance health evidence is missing");
    if (
      result.buildRevision !== expectedBuildRevision ||
      result.schemaVersion !== expectedSchemaVersion
    )
      throw new Error("Maintenance health build/schema mismatch");
    return result;
  },
  async leaveMaintenance() {
    docker(["start", "server"]);
  },
  async resetTransaction(campaignId, gmMembershipId) {
    docker(
      [
        "exec",
        "-T",
        "postgres",
        "psql",
        "--username",
        "arken",
        "--dbname",
        "arken",
        "--set",
        "ON_ERROR_STOP=1",
      ],
      { input: resetSql(campaignId, gmMembershipId) },
    );
  },
  async restartApplication() {
    docker(["start", "server"]);
  },
  async verifyAfter({
    campaignId,
    gmMembershipId,
    expectedBuildRevision,
    expectedSchemaVersion,
    before,
  }) {
    const afterHealth = await health();
    if (afterHealth.buildRevision !== expectedBuildRevision)
      throw new Error("Post-reset build revision changed");
    if (afterHealth.schemaVersion !== expectedSchemaVersion)
      throw new Error("Post-reset schema version changed");
    const counts = await productionDependencies.countState(campaignId);
    const cleared = [
      "playerMemberships",
      "scenes",
      "characters",
      "playerSessions",
      "playerAccessGrants",
      "invites",
      "chatMessages",
      "audioStates",
      "actionJournal",
      "drawings",
      "gameEvents",
      "tokens",
      "fogReveals",
    ];
    const foreign = Object.keys(before).filter((key) =>
      key.startsWith("foreign"),
    );
    if (
      counts.campaigns !== 1 ||
      counts.gmMemberships !== 1 ||
      counts.gmSessions !== before.gmSessions ||
      counts.assets !== before.assets ||
      counts.assetOwnershipValid !== counts.assets ||
      counts.activeSceneId !== null ||
      counts.campaignDay !== 1 ||
      counts.battleActive !== false ||
      counts.battleCounter !== 0 ||
      counts.campaignRevision !== 0 ||
      cleared.some((key) => counts[key] !== 0) ||
      foreign.some((key) => counts[key] !== before[key])
    )
      throw new Error("Post-reset database boundary verification failed");
    const gm = docker([
      "exec",
      "-T",
      "postgres",
      "psql",
      "--username",
      "arken",
      "--dbname",
      "arken",
      "--tuples-only",
      "--no-align",
      "--command",
      `select count(*) from memberships where id=${sqlLiteral(gmMembershipId)} and campaign_id=${sqlLiteral(campaignId)} and role='GM';`,
    ]);
    if (Number(gm) !== 1) throw new Error("Retained GM verification failed");
    return { ...counts, health: afterHealth.status };
  },
  now: () => new Date(),
  async writeReceipt(receipt) {
    mkdirSync(receiptDirectory, { recursive: true });
    const path = resolve(receiptDirectory, `receipt-${Date.now()}.json`);
    writeAuditReceipt(path, receipt);
  },
};

export async function runOperatorReset(
  selectedDependencies = productionDependencies,
  environment = process.env,
) {
  const campaignId = environment.ARKEN_RESET_CAMPAIGN_ID;
  const gmMembershipId = environment.ARKEN_RESET_GM_MEMBERSHIP_ID;
  const expectedBuildRevision = environment.ARKEN_RESET_BUILD_REVISION;
  const expectedSchemaVersion = Number(environment.ARKEN_RESET_SCHEMA_VERSION);
  if (
    !campaignId ||
    !gmMembershipId ||
    !expectedBuildRevision ||
    !Number.isInteger(expectedSchemaVersion)
  )
    throw new Error(
      "ARKEN_RESET_CAMPAIGN_ID, ARKEN_RESET_GM_MEMBERSHIP_ID, ARKEN_RESET_BUILD_REVISION and ARKEN_RESET_SCHEMA_VERSION are required",
    );
  return orchestrateGameplayReset(
    {
      campaignId,
      gmMembershipId,
      expectedBuildRevision,
      expectedSchemaVersion,
    },
    selectedDependencies,
  );
}

const isDirect =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  let selectedDependencies = productionDependencies;
  if (process.env.ARKEN_RESET_TEST_ADAPTER) {
    if (
      process.env.NODE_ENV !== "test" ||
      process.env.ARKEN_RESET_ISOLATED !== "true"
    )
      throw new Error(
        "Reset test adapter requires NODE_ENV=test and ARKEN_RESET_ISOLATED=true",
      );
    selectedDependencies = (
      await import(
        pathToFileURL(resolve(process.env.ARKEN_RESET_TEST_ADAPTER)).href
      )
    ).default;
  }
  await runOperatorReset(selectedDependencies);
}
