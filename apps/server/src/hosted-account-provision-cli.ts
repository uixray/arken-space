import { createDatabase } from "@arken/db";
import { provisionHostedAccounts } from "./hosted-account-provisioning.js";

/** Offline operator entry point; never register as an HTTP route.
 * Feed reviewed input over a confidential pipe, not command-line arguments or
 * shell history. This is deliberately guarded; it does not create credentials. */
async function main() {
  if (
    process.argv.length !== 2 ||
    process.env.DEPLOYMENT_MODE !== "HOSTED" ||
    process.env.ARKEN_HOSTED_PROVISION_CONFIRM !==
      "reviewed-memberships-and-private-input" ||
    !process.env.DATABASE_URL ||
    !process.env.ARKEN_PROVISION_EXPECTED_HOST ||
    !process.env.ARKEN_PROVISION_EXPECTED_DATABASE ||
    process.stdin.isTTY
  )
    throw new Error("PROVISION_GUARD_REJECTED");
  const target = new URL(process.env.DATABASE_URL);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== process.env.ARKEN_PROVISION_EXPECTED_HOST ||
    decodeURIComponent(target.pathname.slice(1)) !==
      process.env.ARKEN_PROVISION_EXPECTED_DATABASE
  )
    throw new Error("PROVISION_GUARD_REJECTED");
  const chunks: Buffer[] = [];
  let bytes = 0;
  let input: unknown;
  try {
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      bytes += buffer.length;
      if (bytes > 65536) throw new Error("PROVISION_INPUT_TOO_LARGE");
    }
    const raw = Buffer.concat(chunks);
    try {
      input = JSON.parse(raw.toString("utf8"));
    } finally {
      raw.fill(0);
    }
  } finally {
    // Also clear accumulated input if the pipe fails or exceeds the limit.
    // Parsed JavaScript strings cannot be reliably erased from process memory.
    for (const chunk of chunks) chunk.fill(0);
  }
  const resource = createDatabase(process.env.DATABASE_URL);
  try {
    const [actual] = await resource.client`select current_database() as name`;
    if (actual?.name !== process.env.ARKEN_PROVISION_EXPECTED_DATABASE)
      throw new Error("PROVISION_GUARD_REJECTED");
    const receipt = await provisionHostedAccounts(resource.db, input);
    // Deliberately omit names, IDs, hashes and secrets from logs/output.
    process.stdout.write(`Provisioned ${receipt.accounts.length} accounts.\n`);
  } finally {
    await resource.client.end({ timeout: 5 });
  }
}

main().catch(() => {
  // Database, validation and input errors may contain private values. Never
  // emit their raw text or stack; an operator must investigate locally.
  process.stderr.write(
    "Provisioning result is unknown; do not retry until an operator verifies the database.\n",
  );
  process.exitCode = 1;
});
