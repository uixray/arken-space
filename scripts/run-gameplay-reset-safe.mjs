import { readFileSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { assertVerifiedRehearsal } from "./gameplay-reset-core.mjs";

const snapshotId = process.env.SNAPSHOT_ID;
const campaignId = process.env.ARKEN_RESET_CAMPAIGN_ID;
if (!snapshotId || snapshotId === "latest")
  throw new Error("SNAPSHOT_ID must be an exact snapshot ID");
if (!campaignId) throw new Error("ARKEN_RESET_CAMPAIGN_ID is required");
if (process.env.ARKEN_RESET_CONFIRM !== `${campaignId}:${snapshotId}`)
  throw new Error("ARKEN_RESET_CONFIRM must equal campaignId:snapshotId");
const report = JSON.parse(
  readFileSync(resolve("test-results/restore/runner.json"), "utf8"),
);
assertVerifiedRehearsal(report, snapshotId);
if (process.env.ARKEN_RESET_EXECUTE !== "operator-approved")
  throw new Error(
    "Reset preflight passed; set ARKEN_RESET_EXECUTE=operator-approved only after go/no-go",
  );
throw new Error(
  "Production reset execution is outside the Pool A stop boundary",
);
