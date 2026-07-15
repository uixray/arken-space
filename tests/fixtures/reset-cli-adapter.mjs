import { appendFileSync, chmodSync, writeFileSync } from "node:fs";
import process from "node:process";

const calls = process.env.ARKEN_RESET_TEST_CALLS;
const receiptPath = process.env.ARKEN_RESET_TEST_RECEIPT;
const record = (name) => appendFileSync(calls, name + "\n");
const cleared = {
  campaigns: 1,
  assets: 1,
  assetOwnershipValid: 1,
  gmMemberships: 1,
  playerMemberships: 0,
  scenes: 0,
  characters: 0,
  playerSessions: 0,
  gmSessions: 1,
  playerAccessGrants: 0,
  invites: 0,
  chatMessages: 0,
  audioStates: 0,
  actionJournal: 0,
  drawings: 0,
  gameEvents: 0,
  tokens: 0,
  fogReveals: 0,
  activeSceneId: null,
  campaignDay: 1,
  battleActive: false,
  battleCounter: 0,
  campaignRevision: 0,
  foreignCampaigns: 1,
  foreignAssets: 2,
  foreignMemberships: 1,
};

export default {
  readCheckoutRevision: async () => "test-revision",
  verifyBuild: async () => ({
    buildRevision: "test-revision",
    schemaVersion: 2,
  }),
  createBackup: async () => {
    record("backup:exact-snapshot");
    return "abcdef1234567890";
  },
  rehearse: async (snapshot) => record("rehearse:" + snapshot),
  readRehearsalEvidence: async () => ({
    hash: "report-hash",
    report: {
      runSucceeded: true,
      snapshot: { id: "abcdef1234567890" },
      productionBefore: { buildRevision: "test-revision", schemaVersion: 2 },
      steps: [
        "database-dump-checksum",
        "media-checksums",
        "database-counts",
        "compose-cleanup",
        "resource-leak-check",
        "restored-data-cleanup",
        "production-health-after",
      ]
        .map((name) => ({ name, status: "passed" }))
        .concat({
          name: "restored-application-health",
          status: "passed",
          buildRevision: "test-revision",
          schemaVersion: 2,
        }),
    },
  }),
  requestConfirmation: async ({ campaignId, snapshotId }) =>
    `${campaignId}:${snapshotId}`,
  approveExecution: async () => true,
  countState: async () => ({ ...cleared, playerMemberships: 1, scenes: 1 }),
  enterMaintenance: async () => record("maintenance"),
  verifyMaintenanceBuild: async () => {
    record("maintenance-health");
    return { buildRevision: "test-revision", schemaVersion: 2 };
  },
  leaveMaintenance: async () => record("maintenance-recovered"),
  resetTransaction: async () => record("transaction"),
  restartApplication: async () => record("restart"),
  verifyAfter: async () => {
    record("postverify");
    return cleared;
  },
  now: () => new Date("2026-07-14T00:00:00.000Z"),
  writeReceipt: async (receipt) => {
    writeFileSync(receiptPath, JSON.stringify(receipt));
    chmodSync(receiptPath, 0o600);
    record("receipt");
  },
};
